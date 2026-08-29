import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { one } from "./db";

const COOKIE = "as_session";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret-change-me");

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  orgId: string;
  orgName: string;
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
    const row = await one<any>(
      `select u.id, u.email, u.name, u.role, u.org_id, o.name as org_name
         from users u join orgs o on o.id = u.org_id
        where u.id = $1`,
      [String(payload.sub)]
    );
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      orgId: row.org_id,
      orgName: row.org_name,
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
