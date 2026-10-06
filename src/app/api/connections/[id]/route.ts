import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { decrypt, encrypt } from "@/lib/crypto";
import { audit } from "@/lib/ai";
import { missingFor } from "@/lib/connection-types";
import { anthropicUsage, recordUsage } from "@/lib/metering";

export const runtime = "nodejs";

/**
 * Edits a connection in place, so a wrong URL or an expired token is fixed
 * without breaking the agents attached to it. An empty secret keeps the stored one.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const c = await one<any>(`select id, kind, config, secret_enc from connections where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { name, config, secret } = await req.json().catch(() => ({}));
  // Settings not on the form (a REST connection's extra headers) are kept; only the old health cache goes.
  const { health: _health, ...next }: Record<string, any> = { ...(c.config || {}), ...(config || {}) };
  const newSecret = typeof secret === "string" && secret.trim() ? secret.trim() : null;
  const missing = missingFor(c.kind, next, !!newSecret || !!c.secret_enc);
  if (missing) return NextResponse.json({ error: missing }, { status: 400 });

  const row = await one<any>(
    `update connections set name = coalesce(nullif($3, ''), name), config = $4, secret_enc = coalesce($5, secret_enc)
      where id = $1 and org_id = $2 returning id, name, kind, config, created_at`,
    [id, u.orgId, String(name ?? "").trim(), JSON.stringify(next), newSecret ? encrypt(newSecret) : null],
  );
  await audit(u.orgId, u, "Edited connection", "connection", id, { name: row.name, kind: row.kind, secretReplaced: !!newSecret });
  return NextResponse.json({ connection: row });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const gone = await one<any>(`delete from connections where id = $1 and org_id = $2 returning name, kind`, [id, u.orgId]);
  await audit(u.orgId, u, "Removed connection", "connection", id, gone ? { name: gone.name, kind: gone.kind } : {});
  return NextResponse.json({ ok: true });
}

/** A connection's history from the audit trail: who added, edited, tested it and when. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const c = await one<any>(`select id from connections where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const activity = await q<any>(
    `select action, actor_name, detail, at from audit_events
      where org_id = $1 and entity = 'connection' and entity_id = $2
      order by at desc limit 25`,
    [u.orgId, id],
  );
  return NextResponse.json({ activity });
}

/**
 * Proves the credential works before an agent depends on it. The result is kept
 * on the connection (config.lastTest) and in the audit trail, so "last tested"
 * survives a reload and shows who tested it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const res = await testConnection(req, ctx);
  try {
    const j = await res.clone().json();
    if (typeof j.ok === "boolean") {
      const u = await requireUser();
      const { id } = await ctx.params;
      const lastTest = { ok: j.ok, detail: String(j.detail ?? "").slice(0, 300), at: new Date().toISOString(), by: u.name };
      await q(`update connections set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('lastTest', $3::jsonb) where id = $1 and org_id = $2`, [
        id,
        u.orgId,
        JSON.stringify(lastTest),
      ]);
      await audit(u.orgId, u, j.ok ? "Tested connection: working" : "Tested connection: failed", "connection", id, { detail: lastTest.detail });
    }
  } catch {
    /* the answer still goes back even if it could not be recorded */
  }
  return res;
}

async function testConnection(_: Request, { params }: { params: Promise<{ id: string }> }) {
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
    if (c.kind === "gemini") {
      // Listing models proves the key without spending anything.
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(secret)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return NextResponse.json({ ok: true, detail: "Key accepted by Google Gemini" });
      return NextResponse.json({ ok: false, detail: res.status === 400 || res.status === 403 ? "The API key was rejected." : `Gemini returned HTTP ${res.status}` });
    }
    if (c.kind === "anthropic") {
      const model = c.config?.model?.trim() || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": secret, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 4, messages: [{ role: "user", content: "Reply with: ok" }] }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        // A real (tiny) call, so it is recorded; it is not blocked at a limit, since checking a key must always work.
        const body = await res.json().catch(() => ({}));
        await recordUsage({ orgId: u.orgId, feature: "key_test", userId: u.id }, "anthropic", model, anthropicUsage(body));
        return NextResponse.json({ ok: true, detail: `Key accepted · ${model} responded` });
      }
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
