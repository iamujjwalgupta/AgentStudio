import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";

export const runtime = "nodejs";

/** Revoke a key. Calls with it fail from now on; runs it started stay in the record. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  if (!u.isOwner && u.role !== "admin") {
    return NextResponse.json({ error: "Only workspace admins can manage API keys." }, { status: 403 });
  }
  const { id } = await params;
  const key = await one<any>(
    `update api_keys set revoked_at = now()
      where id = $1 and org_id = $2 and revoked_at is null
      returning id, name, prefix`,
    [id, u.orgId],
  );
  if (!key) return NextResponse.json({ error: "That key was not found, or is already revoked." }, { status: 404 });
  await audit(u.orgId, u, "Revoked API key", "api_key", key.id, { name: key.name, prefix: key.prefix });
  return NextResponse.json({ ok: true });
}
