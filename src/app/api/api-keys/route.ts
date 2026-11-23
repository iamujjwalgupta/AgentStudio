import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { generateKey } from "@/lib/api-keys";

export const runtime = "nodejs";

const isAdmin = (u: SessionUser) => u.isOwner || u.role === "admin";
const ADMINS_ONLY = "Only workspace admins can manage API keys.";

/** The workspace's keys (never the keys themselves), and its agents for choosing what a key may run. */
export async function GET() {
  const u = await requireUser();
  if (!isAdmin(u)) return NextResponse.json({ error: ADMINS_ONLY }, { status: 403 });
  const keys = await q(
    `select k.id, k.name, k.prefix, k.agent_ids, k.created_by_name, k.created_at, k.last_used_at, k.revoked_at,
            (select count(*)::int from runs r where r.api_key_id = k.id) as runs
       from api_keys k where k.org_id = $1
      order by k.revoked_at is not null, k.created_at desc`,
    [u.orgId],
  );
  const agents = await q(
    `select id, name, status, published_ver from agents where org_id = $1 and status <> 'retired' order by name`,
    [u.orgId],
  );
  return NextResponse.json({ keys, agents });
}

/** Create a key: { name, agentIds? }. The key is in this response and nowhere else, ever. */
export async function POST(req: Request) {
  const u = await requireUser();
  if (!isAdmin(u)) return NextResponse.json({ error: ADMINS_ONLY }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: "Give the key a name, such as the application that will use it." }, { status: 400 });

  // null: every agent in the workspace. Otherwise only these, and only this workspace's.
  let agentIds: string[] | null = null;
  if (Array.isArray(body.agentIds)) {
    const wanted = body.agentIds.filter((x: unknown) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x));
    const rows = wanted.length
      ? await q<any>(`select id from agents where org_id = $1 and id = any($2::uuid[])`, [u.orgId, wanted])
      : [];
    if (!rows.length) return NextResponse.json({ error: "Choose at least one agent, or allow all agents." }, { status: 400 });
    agentIds = rows.map((r) => r.id);
  }

  const { key, prefix, hash } = generateKey();
  const row = await one<any>(
    `insert into api_keys (org_id, name, prefix, key_hash, agent_ids, created_by, created_by_name)
     values ($1,$2,$3,$4,$5,$6,$7) returning id, created_at`,
    [u.orgId, name, prefix, hash, agentIds, u.id, u.name],
  );
  await audit(u.orgId, u, "Created API key", "api_key", row.id, {
    name,
    prefix,
    agents: agentIds ? agentIds.length : "all",
  });
  return NextResponse.json({ id: row.id, name, prefix, key, agentIds });
}
