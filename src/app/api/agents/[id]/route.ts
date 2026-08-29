import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const agent = await one(`select * from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const versions = await q(
    `select v.version, v.note, v.created_at, us.name as by from agent_versions v
     left join users us on us.id = v.created_by where v.agent_id = $1 order by v.version desc`,
    [id],
  );
  const runs = await q(
    `select id, status, trigger, started_at, ended_at, input from runs where agent_id = $1 order by started_at desc limit 20`,
    [id],
  );
  return NextResponse.json({ agent, versions, runs });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const { spec } = await req.json();
  const row = await one<any>(
    `update agents set draft_spec = $3, name = $4, description = $5, archetype = $6, updated_at = now()
     where id = $1 and org_id = $2 returning *`,
    [id, u.orgId, JSON.stringify(spec), spec.name || "Untitled agent", spec.purpose || "", spec.archetype],
  );
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await audit(u.orgId, u, "Saved draft", "agent", id, { name: row.name });
  return NextResponse.json({ agent: row });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  await q(`delete from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  await audit(u.orgId, u, "Deleted agent", "agent", id, {});
  return NextResponse.json({ ok: true });
}
