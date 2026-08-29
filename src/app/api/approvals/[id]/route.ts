import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { decisionCheck } from "@/lib/approvals";
import { resumeAfterApprovals } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const { decision, comment } = await req.json();
  if (!["approved", "rejected"].includes(decision))
    return NextResponse.json({ error: "Decision must be approved or rejected." }, { status: 400 });

  // Read before writing: who may decide depends on who started the run.
  const pending = await one<any>(
    `select ap.id, ap.status, ap.tool, ap.run_id, r.started_by
       from approvals ap join runs r on r.id = ap.run_id
      where ap.id = $1 and ap.org_id = $2`,
    [id, u.orgId],
  );
  if (!pending) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (pending.status !== "pending") {
    return NextResponse.json({ error: "That approval has already been decided." }, { status: 409 });
  }

  const check = await decisionCheck(u, pending.started_by);
  if (!check.allowed) {
    await audit(u.orgId, u, "Approval decision refused", "approval", id, {
      tool: pending.tool,
      runId: pending.run_id,
      reason: check.reason,
    });
    return NextResponse.json({ error: check.reason }, { status: 403 });
  }

  const a = await one<any>(
    `update approvals set status = $3, comment = $4, decided_by = $5, decided_at = now(), self_approved = $6
     where id = $1 and org_id = $2 and status = 'pending' returning *`,
    [id, u.orgId, decision, comment || null, u.id, check.selfApproved],
  );
  if (!a) return NextResponse.json({ error: "That approval has already been decided." }, { status: 409 });

  await audit(u.orgId, u, decision === "approved" ? "Approved action" : "Rejected action", "approval", id, {
    tool: a.tool,
    runId: a.run_id,
    comment,
    // Visible in the trail precisely because nobody else could review it.
    ...(check.selfApproved ? { selfApproved: true } : {}),
  });
  // The decision is already recorded and must stand. Resuming the run is a
  // separate step: if it fails, report that without discarding the decision.
  let resumeError: string | null = null;
  try {
    await resumeAfterApprovals(a.run_id, { id: u.id, name: u.name });
  } catch (e: any) {
    resumeError = e?.message || String(e);
    await audit(u.orgId, u, "Run could not resume after a decision", "run", a.run_id, { error: resumeError });
  }
  return NextResponse.json({ ok: true, runId: a.run_id, selfApproved: check.selfApproved, resumeError });
}
