import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";

export const runtime = "nodejs";

/**
 * Retire a skill, or bring it back.
 *
 * Retiring is the safe counterpart to deleting: agents holding the skill stop
 * using it from their next run, but the skill, its instructions and every
 * agent's reference to it are kept, so restoring puts everything back as it was.
 * That is why it needs no password.
 *
 * As with agents, anyone may retire — a safety valve must never be harder to
 * reach than the risky action. Restoring changes how every agent holding the
 * skill behaves again, so it is gated like publishing.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const { action } = await req.json().catch(() => ({}));
  if (action !== "retire" && action !== "restore") {
    return NextResponse.json({ error: "Choose retire or restore." }, { status: 400 });
  }

  const skill = await one<any>(`select label, name, status from skills where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!skill) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Agents referring to it in their draft or in their live version: the ones that change.
  const held = await one<any>(
    `select count(*)::int as n from agents a
      where a.org_id = $1
        and (
          (jsonb_typeof(a.draft_spec -> 'skills') = 'array' and a.draft_spec -> 'skills' ? $2::text)
          or exists (
            select 1 from agent_versions v
             where v.agent_id = a.id and v.version = a.published_ver
               and jsonb_typeof(v.spec -> 'skills') = 'array' and v.spec -> 'skills' ? $2::text
          )
        )`,
    [u.orgId, id],
  );
  const agentsAffected = held?.n ?? 0;

  if (action === "retire") {
    if (skill.status === "retired") {
      return NextResponse.json({ error: "That skill is already retired." }, { status: 409 });
    }
    const updated = await one<any>(
      `update skills set status = 'retired', retired_at = now(), updated_at = now()
        where id = $1 and org_id = $2 returning id, label, status, retired_at`,
      [id, u.orgId],
    );
    await audit(u.orgId, u, "Retired skill", "skill", id, { label: skill.label, name: skill.name, agentsAffected });
    return NextResponse.json({ skill: updated, agentsAffected });
  }

  if (!u.canPublish) {
    return NextResponse.json(
      { error: "Only the workspace owner and admins can restore a skill, because every agent holding it starts using it again." },
      { status: 403 },
    );
  }
  if (skill.status !== "retired") {
    return NextResponse.json({ error: "That skill is not retired." }, { status: 409 });
  }
  const updated = await one<any>(
    `update skills set status = 'active', retired_at = null, updated_at = now()
      where id = $1 and org_id = $2 returning id, label, status, retired_at`,
    [id, u.orgId],
  );
  await audit(u.orgId, u, "Restored skill", "skill", id, { label: skill.label, name: skill.name, agentsAffected });
  return NextResponse.json({ skill: updated, agentsAffected });
}
