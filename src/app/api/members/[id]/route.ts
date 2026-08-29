import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";

export const runtime = "nodejs";
const ROLES = ["admin", "builder", "approver"];

/** Change someone's role in this workspace. Owner only. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  if (!u.isOwner) return NextResponse.json({ error: "Only the workspace owner can change roles." }, { status: 403 });

  const { role } = await req.json().catch(() => ({}));
  if (!ROLES.includes(role)) return NextResponse.json({ error: "Choose a role." }, { status: 400 });

  const owner = await one<any>(`select owner_id from orgs where id = $1`, [u.orgId]);
  if (owner?.owner_id === id) {
    return NextResponse.json({ error: "The workspace owner's role cannot be changed." }, { status: 400 });
  }

  const row = await one<any>(
    `update memberships set role = $3 where user_id = $1 and org_id = $2 returning role`,
    [id, u.orgId, role],
  );
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const who = await one<any>(`select name, email from users where id = $1`, [id]);
  await audit(u.orgId, u, "Changed a member's role", "user", id, { member: who?.email, role });
  return NextResponse.json({ ok: true, role });
}

/** Remove someone from this workspace. Owner only. Their own workspace is untouched. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  if (!u.isOwner) return NextResponse.json({ error: "Only the workspace owner can remove members." }, { status: 403 });

  const owner = await one<any>(`select owner_id from orgs where id = $1`, [u.orgId]);
  if (owner?.owner_id === id) {
    return NextResponse.json({ error: "The workspace owner cannot be removed." }, { status: 400 });
  }

  const who = await one<any>(`select name, email from users where id = $1`, [id]);
  const gone = await one<any>(
    `delete from memberships where user_id = $1 and org_id = $2 returning id`,
    [id, u.orgId],
  );
  if (!gone) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Send them somewhere they still belong on their next request.
  await q(
    `update users set active_org_id = (select org_id from memberships where user_id = $1 limit 1)
      where id = $1 and active_org_id = $2`,
    [id, u.orgId],
  );
  await audit(u.orgId, u, "Removed a member", "user", id, { member: who?.email });
  return NextResponse.json({ ok: true });
}
