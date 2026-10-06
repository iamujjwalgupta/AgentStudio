import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createRequest } from "@/lib/skill-downloads";

export const runtime = "nodejs";

/** Ask an admin for permission to download a skill as a file. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  if (u.canPublish) {
    return NextResponse.json({ error: "Admins can download skills directly; no request is needed." }, { status: 400 });
  }
  const { reason } = await req.json().catch(() => ({}));
  const r = await createRequest(u.orgId, u, id, reason);
  return r.ok ? NextResponse.json({ request: r.request }) : NextResponse.json({ error: r.error }, { status: r.status });
}
