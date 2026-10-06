import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { usageOverview } from "@/lib/usage-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything the Usage & limits page shows. Anyone in the workspace may look. */
export async function GET(req: Request) {
  const u = await requireUser();
  const days = Math.min(90, Math.max(7, Number(new URL(req.url).searchParams.get("days")) || 30));
  const overview = await usageOverview(u.orgId, days);
  return NextResponse.json({ ...overview, canManage: u.canPublish, timezone: u.timezone });
}
