import { NextResponse } from "next/server";
import { pool, q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";

export const runtime = "nodejs";

/**
 * Switch which workspace the session is looking at: { orgId }.
 * Or start another one: { action: "create", name }, for admins of the current
 * workspace only. The creator owns it, is its admin, and lands in it, exactly as
 * when a workspace is made at sign-up.
 */
export async function POST(req: Request) {
  const u = await requireUser();
  const body = await req.json().catch(() => ({}));

  if (body.action === "create") {
    // Starting a workspace is an admin's call: you must be admin (or owner) where you are now.
    if (!u.isOwner && u.role !== "admin") {
      return NextResponse.json({ error: "Only workspace admins can create a workspace." }, { status: 403 });
    }
    const name = String(body.name ?? "").trim().slice(0, 80);
    if (!name) return NextResponse.json({ error: "Give the workspace a name." }, { status: 400 });

    const client = await pool.connect();
    let orgId: string;
    try {
      await client.query("begin");
      const org = await client.query(`insert into orgs (name, owner_id) values ($1,$2) returning id`, [name, u.id]);
      orgId = org.rows[0].id;
      await client.query(`insert into memberships (user_id, org_id, role) values ($1,$2,'admin')`, [u.id, orgId]);
      await client.query(`update users set active_org_id = $2 where id = $1`, [u.id, orgId]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      console.error("[Create workspace]", err);
      return NextResponse.json({ error: "Could not create the workspace. Please try again." }, { status: 500 });
    } finally {
      client.release();
    }

    await audit(orgId, u, "Created workspace", "org", orgId, { role: "admin", name });
    return NextResponse.json({ ok: true, orgId, name });
  }

  const { orgId } = body;
  const member = await one<any>(`select 1 from memberships where user_id = $1 and org_id = $2`, [u.id, orgId]);
  if (!member) return NextResponse.json({ error: "You are not a member of that workspace." }, { status: 403 });
  await q(`update users set active_org_id = $2 where id = $1`, [u.id, orgId]);
  return NextResponse.json({ ok: true });
}
