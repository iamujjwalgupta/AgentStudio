import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { getApp, updateApp, deleteApp } from "@/lib/apps";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const u = await requireUser();
  const { id } = await params;
  const app = await getApp(u.orgId, id);
  if (!app) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  return NextResponse.json({ app });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const u = await requireUser();
  const { id } = await params;

  const body = await req.json();
  const updated = await updateApp(u.orgId, id, body);
  if (!updated) {
    return NextResponse.json({ error: "Application not found or could not be updated." }, { status: 404 });
  }

  await audit(
    u.orgId,
    { id: u.id, name: u.name },
    "app.update",
    "app",
    id,
    { name: updated.name, url: updated.url }
  );

  return NextResponse.json({ app: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const u = await requireUser();
  const { id } = await params;

  const existing = await getApp(u.orgId, id);
  const ok = await deleteApp(u.orgId, id);
  if (!ok) {
    return NextResponse.json({ error: "Application not found or could not be removed." }, { status: 404 });
  }

  await audit(
    u.orgId,
    { id: u.id, name: u.name },
    "app.delete",
    "app",
    id,
    { name: existing?.name }
  );

  return NextResponse.json({ ok: true });
}
