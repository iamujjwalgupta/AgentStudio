import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canDecide, CANNOT_DECIDE, otherApproverCount } from "@/lib/approvals";
import { toolById } from "@/lib/tools";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const u = await requireUser();
  const { searchParams } = new URL(req.url);
  const filter = searchParams.get("status") || "pending";

  let whereClause = "ap.org_id = $1 and ap.status = 'pending' order by ap.created_at asc";
  if (filter === "decided") {
    whereClause = "ap.org_id = $1 and ap.status in ('approved', 'rejected') order by coalesce(ap.decided_at, ap.created_at) desc limit 50";
  } else if (filter === "all") {
    whereClause = "ap.org_id = $1 order by ap.created_at desc limit 100";
  }

  const rows = await q<any>(
    `select ap.*, r.agent_id, r.started_by, r.parent_run_id, a.name as agent_name, left(r.input, 1200) as run_input, r.status as run_status,
            us.name as started_by_name,
            ud.name as decided_by_name,
            pa.name as parent_agent_name
       from approvals ap
       join runs r on r.id = ap.run_id
       join agents a on a.id = r.agent_id
       left join runs pr on pr.id = r.parent_run_id
       left join agents pa on pa.id = pr.agent_id
       left join users us on us.id = r.started_by
       left join users ud on ud.id = ap.decided_by
      where ${whereClause}`,
    [u.orgId],
  );

  const eligible = canDecide(u);
  const others = eligible ? await otherApproverCount(u.orgId, u.id) : 0;

  // Everyone can see what is waiting; the reason they cannot act travels with it.
  const approvals = rows.map((r) => {
    const mine = r.started_by === u.id;
    let blocked: string | null = null;
    if (!eligible) blocked = CANNOT_DECIDE;
    else if (mine && others > 0)
      blocked =
        "You started this run, so someone else must decide what it does. " +
        `There ${others === 1 ? "is 1 other person" : `are ${others} other people`} in this workspace who can.`;
    const def = toolById(r.tool);
    return {
      ...r,
      tool_label: def?.label ?? r.tool,
      tool_risk: def?.risk ?? "medium",
      canDecide: !blocked,
      blocked,
      selfWouldApprove: eligible && mine && others === 0,
    };
  });

  return NextResponse.json({ approvals, canDecide: eligible });
}
