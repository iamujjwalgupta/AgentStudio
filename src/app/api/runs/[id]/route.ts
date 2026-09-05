import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const run = await one<any>(
    `select r.*, a.name as agent_name from runs r join agents a on a.id = r.agent_id
     where r.id = $1 and r.org_id = $2`,
    [id, u.orgId],
  );
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  delete run.state;
  const steps = await q(`select * from run_steps where run_id = $1 order by idx asc`, [id]);
  const approvals = await q(
    `select a.*, us.name as decided_by_name from approvals a left join users us on us.id = a.decided_by
     where a.run_id = $1 order by a.created_at asc`,
    [id],
  );

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

  return NextResponse.json({ run, steps, approvals, parentRun, childRuns });
}
