import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { emptySpec } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const u = await requireUser();
  const rows = await q(
    `select a.*, us.name as owner_name,
            (select count(*)::int from runs r where r.agent_id = a.id) as run_count
     from agents a left join users us on us.id = a.owner_id
     where a.org_id = $1 order by a.updated_at desc`,
    [u.orgId],
  );
  return NextResponse.json({ agents: rows });
}

export async function POST(req: Request) {
  const u = await requireUser();
  const { spec } = await req.json().catch(() => ({ spec: null }));
  const s = spec || emptySpec();
  const row = await one<any>(
    `insert into agents (org_id, name, description, archetype, owner_id, draft_spec)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [u.orgId, s.name || "Untitled agent", s.purpose || "", s.archetype || "analyst", u.id, JSON.stringify(s)],
  );
  await audit(u.orgId, u, "Created agent", "agent", row.id, { name: row.name });
  return NextResponse.json({ agent: row });
}
