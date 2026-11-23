import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { acceptInvitation } from "@/lib/invitations";

export const runtime = "nodejs";

/** Invitations waiting for the signed-in person, addressed by their email. */
export async function GET() {
  const u = await requireUser();
  const rows = await q(
    `select i.id, i.role, i.created_at, i.expires_at, i.invited_by_name, o.name as org_name
       from invitations i join orgs o on o.id = i.org_id
      where lower(i.email) = lower($1) and i.status = 'pending' and i.expires_at > now()
        and not exists (select 1 from memberships m where m.user_id = $2 and m.org_id = i.org_id)
      order by i.created_at desc`,
    [u.email, u.id],
  );
  return NextResponse.json({ invitations: rows });
}

/** Accept or decline an invitation addressed to you. */
export async function POST(req: Request) {
  const u = await requireUser();
  const { id, token, action } = await req.json().catch(() => ({}));
  if (action !== "accept" && action !== "decline") {
    return NextResponse.json({ error: "Choose accept or decline." }, { status: 400 });
  }

  const inv = await one<any>(
    `select i.*, o.name as org_name from invitations i join orgs o on o.id = i.org_id
      where ($1::uuid is null or i.id = $1) and ($2::text is null or i.token = $2)
        and lower(i.email) = lower($3) and i.status = 'pending' and i.expires_at > now()
      limit 1`,
    [id || null, token || null, u.email],
  );
  if (!inv) return NextResponse.json({ error: "That invitation is no longer valid." }, { status: 404 });

  if (action === "decline") {
    await q(`update invitations set status = 'revoked', accepted_at = now() where id = $1`, [inv.id]);
    return NextResponse.json({ ok: true, status: "declined" });
  }

  // Drops them straight into the workspace they just joined.
  await acceptInvitation(inv, u);
  return NextResponse.json({ ok: true, status: "accepted", orgName: inv.org_name });
}
