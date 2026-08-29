import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canDecide, CANNOT_DECIDE, otherApproverCount } from "@/lib/approvals";

export const runtime = "nodejs";

export async function GET() {
  const u = await requireUser();
  const rows = await q<any>(
    `select ap.*, r.agent_id, r.started_by, a.name as agent_name,
            us.name as started_by_name
       from approvals ap
       join runs r on r.id = ap.run_id
       join agents a on a.id = r.agent_id
       left join users us on us.id = r.started_by
      where ap.org_id = $1 and ap.status = 'pending' order by ap.created_at asc`,
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
    return { ...r, canDecide: !blocked, blocked, selfWouldApprove: eligible && mine && others === 0 };
  });

  return NextResponse.json({ approvals, canDecide: eligible });
}
