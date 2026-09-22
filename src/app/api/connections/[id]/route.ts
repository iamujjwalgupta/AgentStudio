import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { audit } from "@/lib/ai";

export const runtime = "nodejs";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  await q(`delete from connections where id = $1 and org_id = $2`, [id, u.orgId]);
  await audit(u.orgId, u, "Removed connection", "connection", id, {});
  return NextResponse.json({ ok: true });
}

/** Proves the credential works before an agent depends on it. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const c = await one<any>(`select * from connections where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const secret = c.secret_enc ? decrypt(c.secret_enc) : "";
  try {
    if (c.kind === "postgres") {
      const { Client } = await import("pg");
      const client = new Client({ connectionString: secret, connectionTimeoutMillis: 8000 });
      await client.connect();
      const r = await client.query(`select current_database() as db, count(*)::int as tables
        from information_schema.tables where table_schema not in ('pg_catalog','information_schema')`);
      await client.end();
      return NextResponse.json({ ok: true, detail: `Connected to ${r.rows[0].db} · ${r.rows[0].tables} tables visible` });
    }
    if (c.kind === "http") {
      const base = (c.config?.baseUrl || "").replace(/\/$/, "");
      const res = await fetch(base + (c.config?.testPath || "/"), {
        headers: secret ? { authorization: `${c.config?.authScheme || "Bearer"} ${secret}` } : {},
        signal: AbortSignal.timeout(10000),
      });
      return NextResponse.json({ ok: res.status < 500, detail: `${base} responded ${res.status}` });
    }
    if (c.kind === "slack") {
      const res = await fetch(secret, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Agent Studio connection test — you can ignore this." }),
      });
      const t = await res.text();
      return NextResponse.json({ ok: res.ok, detail: res.ok ? "Test message posted" : t });
    }
    if (c.kind === "smtp") {
      const nodemailer: any = await import("nodemailer");
      const t = (nodemailer.default ?? nodemailer).createTransport({
        host: c.config.host,
        port: Number(c.config.port || 587),
        secure: Boolean(c.config.secure),
        auth: c.config.user ? { user: c.config.user, pass: secret } : undefined,
      });
      await t.verify();
      return NextResponse.json({ ok: true, detail: `${c.config.host} accepted the credentials` });
    }
    if (c.kind === "anthropic") {
      const model = c.config?.model?.trim() || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": secret, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 4, messages: [{ role: "user", content: "Reply with: ok" }] }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return NextResponse.json({ ok: true, detail: `Key accepted · ${model} responded` });
      const body = await res.json().catch(() => ({}));
      const why = body?.error?.message || `HTTP ${res.status}`;
      return NextResponse.json({
        ok: false,
        detail: res.status === 401 ? "The API key was rejected." : res.status === 404 ? `No such model: ${model}` : why,
      });
    }
    if (c.kind === "msteams") {
      const res = await fetch(secret, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          "@type": "MessageCard",
          "@context": "http://schema.org/extensions",
          summary: "Agent Studio Connection Test",
          text: "Agent Studio connection test — you can ignore this.",
        }),
        signal: AbortSignal.timeout(10000),
      });
      const t = await res.text().catch(() => "");
      return NextResponse.json({ ok: res.ok, detail: res.ok ? "Test message posted to Teams" : (t || `HTTP ${res.status}`) });
    }
    if (c.kind === "s3") {
      const { testS3Connection } = await import("@/lib/aws-s3");
      const r = await testS3Connection(
        {
          bucket: c.config?.bucket || "",
          region: c.config?.region,
          accessKeyId: c.config?.accessKeyId || "",
          endpoint: c.config?.endpoint,
        },
        secret
      );
      return NextResponse.json(r);
    }
    if (c.kind === "jira") {
      const host = (c.config?.host || "").replace(/\/$/, "");
      const email = c.config?.email || "";
      const auth = Buffer.from(`${email}:${secret}`).toString("base64");
      const res = await fetch(`${host}/rest/api/3/myself`, {
        headers: {
          authorization: `Basic ${auth}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return NextResponse.json({ ok: true, detail: `Jira connected as ${data.displayName || email}` });
      }
      return NextResponse.json({ ok: false, detail: `Jira rejected credentials (HTTP ${res.status})` });
    }
    if (c.kind === "github") {
      const repo = c.config?.repo?.trim();
      const url = repo ? `https://api.github.com/repos/${repo}` : "https://api.github.com/user";
      const res = await fetch(url, {
        headers: {
          authorization: `Bearer ${secret}`,
          "user-agent": "Agent-Studio",
          accept: "application/vnd.github.v3+json",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const name = data.full_name || data.login || "Token valid";
        return NextResponse.json({ ok: true, detail: `GitHub connected · ${name}` });
      }
      const err = await res.json().catch(() => ({}));
      return NextResponse.json({ ok: false, detail: err.message || `GitHub returned HTTP ${res.status}` });
    }
    if (c.kind === "redis") {
      const { testRedisConnection } = await import("@/lib/redis-client");
      const r = await testRedisConnection(
        {
          host: c.config?.host,
          port: c.config?.port,
          tls: Boolean(c.config?.tls),
        },
        secret
      );
      return NextResponse.json(r);
    }
    return NextResponse.json({ ok: true, detail: "Nothing to test for this type." });
  } catch (e: any) {
    return NextResponse.json({ ok: false, detail: e?.message || String(e) });
  }
}
