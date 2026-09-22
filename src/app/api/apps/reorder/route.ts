import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { reorderApps } from "@/lib/apps";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  const u = await requireUser();
  const body = await req.json();
  const appIds = Array.isArray(body.appIds) ? body.appIds : [];

  if (!appIds.length) {
    return NextResponse.json({ error: "Missing appIds array." }, { status: 400 });
  }

  const ok = await reorderApps(u.orgId, appIds);
  if (!ok) {
    return NextResponse.json({ error: "Failed to update apps order." }, { status: 500 });
  }

  return NextResponse.json({ success: true, appIds });
}
