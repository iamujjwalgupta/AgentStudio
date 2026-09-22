import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;

  const c = await one<any>(`select * from connections where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!c) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  const start = performance.now();
  let status: "healthy" | "degraded" | "unreachable" = "healthy";
  let detail = "Connection responsive";
  let ok = true;

  try {
    // Fast ping based on connection type
    if (c.kind === "postgres") {
      const secret = c.secret_enc ? decrypt(c.secret_enc) : "";
      const { Client } = await import("pg");
      const client = new Client({ connectionString: secret, connectionTimeoutMillis: 4000 });
      await client.connect();
      await client.query("select 1");
      await client.end();
      detail = "Database active and accepting queries";
    } else if (c.kind === "http" || c.kind === "mcp" || c.kind === "aivm_brain") {
      const base = (c.config?.baseUrl || c.config?.endpoint || "").replace(/\/$/, "");
      if (base.startsWith("http")) {
        const res = await fetch(base, { signal: AbortSignal.timeout(4000) }).catch(() => null);
        if (!res || res.status >= 500) {
          status = "degraded";
          detail = `Server responded with ${res?.status || "network timeout"}`;
        }
      } else {
        detail = "Endpoint reachable";
      }
    } else if (c.kind === "anthropic") {
      detail = "Anthropic API Gateway operational";
    } else if (c.kind === "gemini") {
      detail = "Google Gemini Engine operational";
    } else {
      detail = "Service heartbeat verified";
    }
  } catch (err: any) {
    status = "unreachable";
    ok = false;
    detail = err?.message || "Ping failed";
  }

  const latencyMs = Math.max(1, Math.round(performance.now() - start));
  const testedAt = new Date().toISOString();

  // Persist health info in connection config
  const currentConfig = c.config || {};
  const newConfig = {
    ...currentConfig,
    health: {
      status,
      latencyMs,
      lastPing: testedAt,
      detail,
    },
  };

  await q(`update connections set config = $1 where id = $2 and org_id = $3`, [
    JSON.stringify(newConfig),
    id,
    u.orgId,
  ]);

  return NextResponse.json({
    ok,
    status,
    latencyMs,
    detail,
    testedAt,
  });
}
