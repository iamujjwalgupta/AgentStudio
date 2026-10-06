import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { decideRequest } from "@/lib/skill-downloads";

export const runtime = "nodejs";

/** Approve or reject a skill download request. Owner and admins only. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  if (!u.canPublish) {
    return NextResponse.json({ error: "Only the workspace owner and admins decide skill downloads." }, { status: 403 });
  }
  const { decision, note } = await req.json().catch(() => ({}));
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: "Decision must be approved or rejected." }, { status: 400 });
  }
  const r = await decideRequest(u.orgId, u, id, decision, String(note ?? "").trim().slice(0, 500));
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
}
