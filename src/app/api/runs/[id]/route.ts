import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { toolById } from "@/lib/tools";
import { canDecide, CANNOT_DECIDE, otherApproverCount } from "@/lib/approvals";
import { STUCK_MINUTES } from "@/lib/run-list";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const run = await one<any>(
    `select r.*, a.name as agent_name, us.name as started_by_name,
            (r.status = 'running' and r.started_at < now() - interval '${STUCK_MINUTES} minutes') as stuck
       from runs r join agents a on a.id = r.agent_id left join users us on us.id = r.started_by
      where r.id = $1 and r.org_id = $2`,
    [id, u.orgId],
  );
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  delete run.state;
  const steps = await q(`select * from run_steps where run_id = $1 order by idx asc`, [id]);
  const rawApprovals = await q<any>(
    `select a.*, us.name as decided_by_name from approvals a left join users us on us.id = a.decided_by
     where a.run_id = $1 order by a.created_at asc`,
    [id],
  );
  // The same rule as the Approvals page: who may decide, and why not when they cannot.
  const eligible = canDecide(u);
  const others = eligible ? await otherApproverCount(u.orgId, u.id) : 0;
  const mine = run.started_by === u.id;
  const blocked = !eligible
    ? CANNOT_DECIDE
    : mine && others > 0
      ? `You started this run, so someone else must decide what it does. There ${others === 1 ? "is 1 other person" : `are ${others} other people`} in this workspace who can.`
      : null;
  const approvals = rawApprovals.map((a) => {
    const def = toolById(a.tool);
    return {
      ...a,
      tool_label: def?.label ?? a.tool,
      tool_risk: def?.risk ?? "medium",
      canDecide: !blocked,
      blocked,
      selfWouldApprove: eligible && mine && others === 0,
    };
  });

  let parentRun: any = null;
  if (run.parent_run_id) {
    parentRun = await one<any>(
      `select r.id, r.agent_id, a.name as agent_name from runs r
       join agents a on a.id = r.agent_id where r.id = $1`,
      [run.parent_run_id],
    );
  }

  const childRuns = await q<any>(
    `select r.id, r.agent_id, a.name as agent_name, r.status, r.started_at, r.ended_at, r.input, r.output
       from runs r
       join agents a on a.id = r.agent_id
      where r.parent_run_id = $1
      order by r.started_at asc`,
    [id],
  );

  // The run's presented result, the latest when it presented more than once.
  const deliverable = await one<any>(
    `select id, spec, created_at from deliverables where run_id = $1 order by created_at desc limit 1`,
    [id],
  );

  return NextResponse.json({ run, steps, approvals, parentRun, childRuns, deliverable });
}
