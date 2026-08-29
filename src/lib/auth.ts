import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { one, q } from "./db";

const COOKIE = "as_session";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret-change-me");

export type Membership = {
  orgId: string;
  orgName: string;
  role: string;
  isOwner: boolean;
};

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  /** Role in the workspace currently being viewed. */
  role: string;
  /** The workspace being viewed. Every org-scoped query uses this. */
  orgId: string;
  orgName: string;
  /** True only for the account that created the workspace being viewed. */
  isOwner: boolean;
  /** Every workspace this person belongs to, for the switcher. */
  memberships: Membership[];
  /** May invite people and open the members page. */
  canManageMembers: boolean;
  /** May put an agent live. Deciding what runs in production is a governance act. */
  canPublish: boolean;
  /** Workspace timezone. Schedules fire in it, and dates are rendered in it. */
  timezone: string;
};

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
  cookies().set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function destroySession() {
  cookies().set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function getUser(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    const userId = String(payload.sub);

    const row = await one<any>(`select id, email, name, active_org_id from users where id = $1`, [userId]);
    if (!row) return null;

    const rows = await q<any>(
      `select m.org_id, m.role, o.name as org_name, o.owner_id, o.timezone
         from memberships m join orgs o on o.id = m.org_id
        where m.user_id = $1
        order by (o.owner_id = $1) desc, o.name`,
      [userId],
    );
    if (!rows.length) return null;

    const memberships: Membership[] = rows.map((r) => ({
      orgId: r.org_id,
      orgName: r.org_name,
      role: r.role,
      isOwner: r.owner_id === userId,
    }));
    const activeRow = rows.find((r) => r.org_id === row.active_org_id) ?? rows[0];

    // Fall back to the first workspace when the active one is gone — the person
    // may have been removed from it since they last looked.
    const active = memberships.find((m) => m.orgId === row.active_org_id) ?? memberships[0];

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: active.role,
      orgId: active.orgId,
      orgName: active.orgName,
      isOwner: active.isOwner,
      memberships,
      canManageMembers: active.isOwner || active.role === "admin",
      canPublish: active.isOwner || active.role === "admin",
      timezone: activeRow.timezone || "UTC",
    };
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) {
    const err: any = new Error("UNAUTHORIZED");
    err.status = 401;
    throw err;
  }
  return u;
}
