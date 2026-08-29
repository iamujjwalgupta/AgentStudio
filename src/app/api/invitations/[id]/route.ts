import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";

export const runtime = "nodejs";

/** Withdraw an invitation that has not been accepted. Owner and admins. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  if (!u.canManageMembers) {
    return NextResponse.json({ error: "Only the workspace owner and admins can withdraw invitations." }, { status: 403 });
  }
  const inv = await one<any>(
    `update invitations set status = 'revoked' where id = $1 and org_id = $2 and status = 'pending'
     returning email`,
    [id, u.orgId],
  );
  if (!inv) return NextResponse.json({ error: "Not found, or already decided." }, { status: 404 });
  await audit(u.orgId, u, "Withdrew an invitation", "user", null, { email: inv.email });
  return NextResponse.json({ ok: true });
}
