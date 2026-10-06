import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { syncAgentSchedule } from "@/lib/agent-schedule";
import { skillsFor } from "@/lib/skills";
import { specSkillIds } from "@/lib/types";
import { canDeleteAgent, deleteDeniedReason } from "@/lib/agent-perms";

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

  // A spec may only name skills this workspace owns. Anything else is dropped
  // rather than rejected: a spec arriving with a stale id — from a share, or a
  // skill deleted while the builder was open — should save cleanly and simply
  // lose the skill, which is what the run would do with it anyway.
  const granted = await skillsFor(u.orgId, specSkillIds(spec));
  spec.skills = granted.map((s) => s.id);

  const row = await one<any>(
    `update agents set draft_spec = $3, name = $4, description = $5, archetype = $6, updated_at = now()
     where id = $1 and org_id = $2 returning *`,
    [id, u.orgId, JSON.stringify(spec), spec.name || "Untitled agent", spec.purpose || "", spec.archetype],
  );
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await syncAgentSchedule(id);
  await audit(u.orgId, u, "Saved draft", "agent", id, { name: row.name });
  return NextResponse.json({ agent: row });
}

/**
 * Deleting an agent takes its versions, runs, run steps and approvals with it.
 * Two gates, both enforced here and not merely hidden in the UI: the caller must
 * be allowed to delete this agent (lib/agent-perms: an admin, or its creator
 * while it has never been published), and must re-enter their password.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;

  const target = await one<any>(`select name, owner_id, published_ver from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canDeleteAgent(u, target)) {
    return NextResponse.json({ error: deleteDeniedReason(u, target) }, { status: 403 });
  }

  const { password } = await req.json().catch(() => ({ password: "" }));
  if (!password) return NextResponse.json({ error: "Enter your password to confirm." }, { status: 400 });

  const me = await one<any>(`select password_hash from users where id = $1`, [u.id]);
  if (!me || !(await verifyPassword(password, me.password_hash))) {
    // A failed confirmation is itself worth recording.
    await audit(u.orgId, u, "Failed password confirmation on agent deletion", "agent", id, {});
    return NextResponse.json({ error: "That password is not correct." }, { status: 403 });
  }

  const runs = await one<any>(`select count(*)::int as n from runs where agent_id = $1`, [id]);
  await q(`delete from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  // Written after the delete so the audit trail outlives the agent it describes.
  await audit(u.orgId, u, "Deleted agent", "agent", id, {
    name: target.name,
    runsRemoved: runs?.n ?? 0,
    wasPublished: target.published_ver != null,
  });
  return NextResponse.json({ ok: true, name: target.name });
}
