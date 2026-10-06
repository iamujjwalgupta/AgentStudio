import { NextResponse } from "next/server";
import { pool, one, q } from "@/lib/db";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/ai";

export const runtime = "nodejs";

const loginAttempts = new Map<string, { count: number; lockUntil: number }>();

function checkLoginRateLimit(key: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record) return { allowed: true };

  if (record.lockUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((record.lockUntil - now) / 1000) };
  }

  return { allowed: true };
}

function recordLoginFailure(key: string) {
  const now = Date.now();
  const record = loginAttempts.get(key) || { count: 0, lockUntil: 0 };
  record.count++;
  if (record.count >= 5) {
    record.lockUntil = now + 5 * 60_000; // 5 minute lockout after 5 failures
  }
  loginAttempts.set(key, record);
}

function recordLoginSuccess(key: string) {
  loginAttempts.delete(key);
}

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

  const addr = String(email).trim().toLowerCase();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const rateLimitKey = `${ip}:${addr}`;

  if (action === "register") {
    const existing = await one(`select id from users where email = $1`, [addr]);
    if (existing) return NextResponse.json({ error: "That email is already registered. Sign in instead." }, { status: 409 });
    if (String(password).length < 8)
      return NextResponse.json({ error: "Use a password of at least 8 characters." }, { status: 400 });

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

    const client = await pool.connect();
    try {
      await client.query("begin");

      let orgId: string;
      if (inv) {
        orgId = inv.org_id;
      } else {
        const orgRes = await client.query(`insert into orgs (name) values ($1) returning id`, [org || `${name || addr}'s workspace`]);
        orgId = orgRes.rows[0].id;
      }

      const pwHash = await hashPassword(password);
      const userRes = await client.query(
        `insert into users (org_id, active_org_id, email, name, password_hash, role) values ($1,$1,$2,$3,$4,$5) returning id`,
        [orgId, addr, name || addr.split("@")[0], pwHash, inv ? inv.role : "admin"],
      );
      const userId = userRes.rows[0].id;

      await client.query(`insert into memberships (user_id, org_id, role) values ($1,$2,$3)`, [
        userId,
        orgId,
        inv ? inv.role : "admin",
      ]);

      if (inv) {
        await client.query(`update invitations set status='accepted', accepted_at=now(), accepted_by=$2 where id=$1`, [inv.id, userId]);
      } else {
        await client.query(`update orgs set owner_id = $2 where id = $1`, [orgId, userId]);
      }

      await client.query("commit");

      await createSession(userId);
      await audit(orgId, { id: userId, name: name || addr }, inv ? "Joined workspace" : "Created workspace", inv ? "user" : "org", inv ? userId : orgId, {
        role: inv ? inv.role : "admin",
        ...(inv ? { invitedBy: inv.invited_by_name } : {}),
      });

      return NextResponse.json({ ok: true, ...(inv ? { joined: inv.org_name } : {}) });
    } catch (err: any) {
      await client.query("rollback").catch(() => {});
      console.error("[Registration Error]", err);
      return NextResponse.json({ error: "Could not complete registration. Please try again." }, { status: 500 });
    } finally {
      client.release();
    }
  }

  // Login flow
  const rateLimit = checkLoginRateLimit(rateLimitKey);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: `Too many failed attempts. Please try again in ${rateLimit.retryAfter} seconds.` },
      { status: 429 },
    );
  }

  const user = await one<any>(`select id, password_hash, org_id, name from users where email = $1`, [addr]);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    recordLoginFailure(rateLimitKey);
    return NextResponse.json({ error: "That email and password do not match." }, { status: 401 });
  }

  recordLoginSuccess(rateLimitKey);
  await createSession(user.id);
  await audit(user.org_id, { id: user.id, name: user.name }, "Signed in", "user", user.id, {});
  return NextResponse.json({ ok: true });
}

/**
 * GET ?invite=<token>: who an invitation is from, so the sign-in page can say
 * which workspace you are joining. Holding the token is what proves you were
 * invited; an unknown or spent token says only that it is not valid.
 * Without a token: the database health check.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("invite");
  if (token) {
    const inv = await one<any>(
      `select i.email, i.invited_by_name, o.name as org_name from invitations i join orgs o on o.id = i.org_id
        where i.token = $1 and i.status = 'pending' and i.expires_at > now()`,
      [token],
    );
    if (!inv) return NextResponse.json({ valid: false });
    return NextResponse.json({ valid: true, email: inv.email, org: inv.org_name, invitedBy: inv.invited_by_name });
  }
  const rows = await q(`select 1 as ok`);
  return NextResponse.json({ db: rows.length === 1 });
}
