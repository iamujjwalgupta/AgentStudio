import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { emptySpec, type AgentSpec } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Accept or decline an offer. Only the person it was sent to may decide.
 * Accepting copies the snapshotted spec into their workspace as a draft with
 * its sources and skills stripped: those ids belong to the sending workspace and
 * mean nothing here, so the recipient grants their own before publishing.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const { action } = await req.json().catch(() => ({}));

  if (action !== "accept" && action !== "decline") {
    return NextResponse.json({ error: "Choose accept or decline." }, { status: 400 });
  }

  const share = await one<any>(`select * from agent_shares where id = $1 and to_user_id = $2`, [id, u.id]);
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (share.status !== "pending") {
    return NextResponse.json({ error: `This share was already ${share.status}.` }, { status: 409 });
  }

  if (action === "decline") {
    await one(`update agent_shares set status = 'declined', decided_at = now() where id = $1 returning id`, [id]);
    await audit(u.orgId, u, "Declined a shared agent", "agent", null, {
      agent: share.agent_name,
      from: share.from_user_name,
    });
    await audit(share.from_org_id, u, "Shared agent was declined", "agent", share.agent_id, {
      agent: share.agent_name,
      by: u.email,
    });
    return NextResponse.json({ ok: true, status: "declined" });
  }

  const incoming = share.spec as AgentSpec;
  const spec: AgentSpec = {
    ...emptySpec(),
    ...incoming,
    // The workspace-specific parts of a spec. Cleared so nothing points at a
    // connection or a skill this workspace does not own — a skill id from
    // another workspace resolves to nothing here, and might one day resolve to
    // something else entirely.
    sources: [],
    skills: [],
  };

  const copy = await one<any>(
    `insert into agents (org_id, name, description, archetype, owner_id, draft_spec, status)
     values ($1,$2,$3,$4,$5,$6,'draft') returning id, name`,
    [u.orgId, spec.name || share.agent_name, spec.purpose || "", spec.archetype || "analyst", u.id, JSON.stringify(spec)],
  );

  await one(
    `update agent_shares set status = 'accepted', decided_at = now(), accepted_agent_id = $2
      where id = $1 returning id`,
    [id, copy.id],
  );

  await audit(u.orgId, u, "Accepted a shared agent", "agent", copy.id, {
    agent: share.agent_name,
    from: share.from_user_name,
    fromWorkspace: share.from_org_name,
  });
  await audit(share.from_org_id, u, "Shared agent was accepted", "agent", share.agent_id, {
    agent: share.agent_name,
    by: u.email,
  });

  return NextResponse.json({ ok: true, status: "accepted", agentId: copy.id });
}

/** The sending workspace can withdraw an offer that has not been decided yet. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;

  const share = await one<any>(`select * from agent_shares where id = $1 and from_org_id = $2`, [id, u.orgId]);
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (share.status !== "pending") {
    return NextResponse.json(
      { error: `This share was already ${share.status} and cannot be withdrawn.` },
      { status: 409 },
    );
  }

  await one(`update agent_shares set status = 'revoked', decided_at = now() where id = $1 returning id`, [id]);
  await audit(u.orgId, u, "Withdrew a shared agent", "agent", share.agent_id, { agent: share.agent_name });
  return NextResponse.json({ ok: true });
}
