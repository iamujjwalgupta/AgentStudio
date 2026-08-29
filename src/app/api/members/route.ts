import { NextResponse } from "next/server";
import crypto from "crypto";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";

const ROLES = ["admin", "builder", "approver"];
const INVITE_DAYS = 14;

/** Members of the workspace being viewed, plus invitations still standing. */
export async function GET() {
  const u = await requireUser();
  const members = await q(
    `select us.id, us.email, us.name, m.role, m.created_at, (o.owner_id = us.id) as is_owner
       from memberships m
       join users us on us.id = m.user_id
       join orgs o on o.id = m.org_id
      where m.org_id = $1
      order by (o.owner_id = us.id) desc, us.name`,
    [u.orgId],
  );
  // Tokens are never listed; only the invite that was just created returns one.
  const invitations = u.canManageMembers
    ? await q(
        `select id, email, role, status, invited_by_name, created_at, expires_at,
                (expires_at < now()) as expired
           from invitations where org_id = $1 and status = 'pending' order by created_at desc`,
        [u.orgId],
      )
    : [];
  return NextResponse.json({ members, invitations, canManageMembers: u.canManageMembers });
}

/** Invite someone to this workspace. Owner and admins only. */
export async function POST(req: Request) {
  const u = await requireUser();
  if (!u.canManageMembers) {
    return NextResponse.json({ error: "Only the workspace owner and admins can invite people." }, { status: 403 });
  }

  const { email, role } = await req.json().catch(() => ({}));
  const addr = String(email || "").trim().toLowerCase();
  if (!addr || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!ROLES.includes(role)) return NextResponse.json({ error: "Choose a role." }, { status: 400 });

  const existing = await one<any>(`select id, name from users where lower(email) = $1`, [addr]);
  if (existing) {
    const already = await one<any>(`select 1 from memberships where user_id = $1 and org_id = $2`, [
      existing.id,
      u.orgId,
    ]);
    if (already) {
      return NextResponse.json({ error: `${existing.name} is already in this workspace.` }, { status: 409 });
    }
  }

  const pending = await one<any>(
    `select id from invitations where org_id = $1 and lower(email) = $2 and status = 'pending'`,
    [u.orgId, addr],
  );
  if (pending) {
    return NextResponse.json({ error: "That address already has an invitation waiting." }, { status: 409 });
  }

  const token = crypto.randomBytes(24).toString("base64url");
  const inv = await one<any>(
    `insert into invitations (org_id, email, role, token, invited_by, invited_by_name, expires_at)
     values ($1,$2,$3,$4,$5,$6, now() + ($7 || ' days')::interval)
     returning id, email, role, expires_at`,
    [u.orgId, addr, role, token, u.id, u.name, String(INVITE_DAYS)],
  );

  await audit(u.orgId, u, "Invited someone to the workspace", "user", null, { email: addr, role });

  const link = `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/login?invite=${token}`;
  await notify(u.orgId, {
    event: "invitation",
    entityId: inv.id,
    to: [addr],
    subject: `${u.name} invited you to ${u.orgName}`,
    body:
      `${u.name} invited you to join the workspace "${u.orgName}" as ${role}.\n\n` +
      `${existing ? "You already have an account — sign in and the invitation is waiting for you." : "Use this link to sign up and join:"}\n${link}\n\n` +
      `The invitation expires in ${INVITE_DAYS} days.`,
  });

  return NextResponse.json({
    invitation: inv,
    // Emailed when the workspace has an email connection; shown either way so
    // the inviter can always pass it on themselves.
    link: `/login?invite=${token}`,
    hasAccount: Boolean(existing),
  });
}
