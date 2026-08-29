import { NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/ai";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const { action, email, password, name, org } = body || {};

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

    const orgRow = await one<any>(`insert into orgs (name) values ($1) returning id`, [org || `${name || email}'s workspace`]);
    const user = await one<any>(
      `insert into users (org_id, email, name, password_hash, role) values ($1,$2,$3,$4,'admin') returning id`,
      [orgRow.id, email.toLowerCase(), name || email.split("@")[0], await hashPassword(password)],
    );
    // The account that creates the workspace owns it.
    await q(`update orgs set owner_id = $2 where id = $1`, [orgRow.id, user.id]);
    await createSession(user.id);
    await audit(orgRow.id, { id: user.id, name: name || email }, "Created workspace", "org", orgRow.id, {});
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
