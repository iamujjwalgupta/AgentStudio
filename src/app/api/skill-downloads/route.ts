import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listRequests } from "@/lib/skill-downloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The admin queue of skill download requests: ?status=pending (default) or ?status=decided. */
export async function GET(req: Request) {
  const u = await requireUser();
  if (!u.canPublish) {
    return NextResponse.json({ error: "Only the workspace owner and admins decide skill downloads." }, { status: 403 });
  }
  const which = new URL(req.url).searchParams.get("status") === "decided" ? "decided" : "pending";
  return NextResponse.json({ requests: await listRequests(u.orgId, which) });
}
