import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

/** Switch which workspace the session is looking at. */
export async function POST(req: Request) {
  const u = await requireUser();
  const { orgId } = await req.json().catch(() => ({}));
  const member = await one<any>(`select 1 from memberships where user_id = $1 and org_id = $2`, [u.id, orgId]);
  if (!member) return NextResponse.json({ error: "You are not a member of that workspace." }, { status: 403 });
  await q(`update users set active_org_id = $2 where id = $1`, [u.id, orgId]);
  return NextResponse.json({ ok: true });
}
