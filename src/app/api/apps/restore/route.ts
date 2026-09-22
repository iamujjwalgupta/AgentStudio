import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { restoreDefaultApps, listApps } from "@/lib/apps";

export const runtime = "nodejs";

export async function POST() {
  const u = await requireUser();
  const ok = await restoreDefaultApps(u.orgId);
  if (!ok) {
    return NextResponse.json({ error: "Failed to restore default applications." }, { status: 500 });
  }

  await audit(
    u.orgId,
    { id: u.id, name: u.name },
    "app.restore_defaults",
    "app",
    "defaults",
    {}
  );

  const apps = await listApps(u.orgId);
  return NextResponse.json({ success: true, apps });
}
