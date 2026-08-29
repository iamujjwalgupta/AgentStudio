import { NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/ai";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const { action, email, password, name, org, invite } = body || {};

  if (action === "logout") {
    await destroySession();
    return NextResponse.json({ ok: true });
  }

  if (!email || !password) {
    return NextResponse.json({ error: "Enter an email address and a password." }, { status: 400 });
  }

  if (action === "register") {
    const existing = await one(`select id from users where email = $1`, [email.toLowerCase()]);
    if (existing) return NextResponse.json({ error: "That email is already registered. Sign in instead." }, { status: 409 });
    if (String(password).length < 8)
      return NextResponse.json({ error: "Use a password of at least 8 characters." }, { status: 400 });

    const addr = email.toLowerCase();

    // An invitation means joining an existing workspace rather than starting one.
    const inv = invite
      ? await one<any>(
          `select i.*, o.name as org_name from invitations i join orgs o on o.id = i.org_id
            where i.token = $1 and i.status = 'pending' and i.expires_at > now()`,
          [invite],
        )
      : null;
    if (invite && !inv) {
      return NextResponse.json({ error: "That invitation is no longer valid. Ask for a new one." }, { status: 400 });
    }
    if (inv && inv.email.toLowerCase() !== addr) {
      return NextResponse.json(
        { error: `That invitation was sent to ${inv.email}. Sign up with that address.` },
        { status: 400 },
      );
    }

    const orgId = inv
      ? inv.org_id
      : (await one<any>(`insert into orgs (name) values ($1) returning id`, [org || `${name || email}'s workspace`])).id;

    const user = await one<any>(
      `insert into users (org_id, active_org_id, email, name, password_hash, role) values ($1,$1,$2,$3,$4,$5) returning id`,
      [orgId, addr, name || email.split("@")[0], await hashPassword(password), inv ? inv.role : "admin"],
    );
    await q(`insert into memberships (user_id, org_id, role) values ($1,$2,$3)`, [
      user.id,
      orgId,
      inv ? inv.role : "admin",
    ]);

    if (inv) {
      await q(`update invitations set status='accepted', accepted_at=now(), accepted_by=$2 where id=$1`, [inv.id, user.id]);
      await createSession(user.id);
      await audit(orgId, { id: user.id, name: name || email }, "Joined workspace", "user", user.id, {
        role: inv.role,
        invitedBy: inv.invited_by_name,
      });
      return NextResponse.json({ ok: true, joined: inv.org_name });
    }

    // The account that creates the workspace owns it.
    await q(`update orgs set owner_id = $2 where id = $1`, [orgId, user.id]);
    await createSession(user.id);
    await audit(orgId, { id: user.id, name: name || email }, "Created workspace", "org", orgId, {});
    return NextResponse.json({ ok: true });
  }

  const user = await one<any>(`select id, password_hash, org_id, name from users where email = $1`, [email.toLowerCase()]);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return NextResponse.json({ error: "That email and password do not match." }, { status: 401 });
  }
  await createSession(user.id);
  await audit(user.org_id, { id: user.id, name: user.name }, "Signed in", "user", user.id, {});
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const rows = await q(`select 1 as ok`);
  return NextResponse.json({ db: rows.length === 1 });
}
