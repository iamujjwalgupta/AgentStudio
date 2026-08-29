import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const u = await requireUser();
  const rows = await q(
    `select ap.*, r.agent_id, a.name as agent_name from approvals ap
     join runs r on r.id = ap.run_id join agents a on a.id = r.agent_id
     where ap.org_id = $1 and ap.status = 'pending' order by ap.created_at asc`,
    [u.orgId],
  );
  return NextResponse.json({ approvals: rows });
}
