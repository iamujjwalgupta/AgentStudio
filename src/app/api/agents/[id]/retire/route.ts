import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { syncAgentSchedule } from "@/lib/agent-schedule";

export const runtime = "nodejs";

/**
 * Retire an agent, or bring it back.
 *
 * Retiring is the safe counterpart to publishing: it stops the agent running,
 * on a schedule or by hand, while keeping every version, run, step and approval
 * it produced. Deleting destroys that evidence; retiring is what you almost
 * always want, which is why it needs no password and can be undone.
 *
 * Anyone may retire — a safety valve must never be harder to reach than the
 * risky action. Restoring is gated like publishing, because it goes live again.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const { action } = await req.json().catch(() => ({}));
  if (action !== "retire" && action !== "restore") {
    return NextResponse.json({ error: "Choose retire or restore." }, { status: 400 });
  }

  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "retire") {
    if (agent.status === "retired") {
      return NextResponse.json({ error: "That agent is already retired." }, { status: 409 });
    }
    const updated = await one<any>(
      `update agents set status = 'retired', updated_at = now() where id = $1 and org_id = $2 returning *`,
      [id, u.orgId],
    );
    // Clears schedule and next_run_at, because only a published agent is ever due.
    await syncAgentSchedule(id);
    const runs = await one<any>(`select count(*)::int as n from runs where agent_id = $1`, [id]);
    await audit(u.orgId, u, "Retired agent", "agent", id, {
      name: agent.name,
      wasVersion: agent.published_ver,
      runsKept: runs?.n ?? 0,
    });
    return NextResponse.json({ agent: updated });
  }

  // Restoring puts an agent back into production, so it needs the same authority
  // as publishing. Retiring stays open to everyone: taking something out of
  // production is a safety valve and must never be harder than putting it in.
  if (!u.canPublish) {
    return NextResponse.json(
      { error: "Only the workspace owner and admins can restore an agent, because it goes live again." },
      { status: 403 },
    );
  }

  if (agent.status !== "retired") {
    return NextResponse.json({ error: "That agent is not retired." }, { status: 409 });
  }
  // Back to whatever it was: live again if it had a published version, else a draft.
  const back = agent.published_ver ? "published" : "draft";
  const updated = await one<any>(
    `update agents set status = $3, updated_at = now() where id = $1 and org_id = $2 returning *`,
    [id, u.orgId, back],
  );
  const sched = await syncAgentSchedule(id);
  await audit(u.orgId, u, "Restored agent", "agent", id, {
    name: agent.name,
    status: back,
    ...(sched.next ? { nextRun: sched.next.toISOString() } : {}),
  });
  return NextResponse.json({ agent: updated, status: back, schedule: sched });
}
