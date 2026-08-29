import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { resumeAfterApprovals } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const { decision, comment } = await req.json();
  if (!["approved", "rejected"].includes(decision))
    return NextResponse.json({ error: "Decision must be approved or rejected." }, { status: 400 });

  const a = await one<any>(
    `update approvals set status = $3, comment = $4, decided_by = $5, decided_at = now()
     where id = $1 and org_id = $2 and status = 'pending' returning *`,
    [id, u.orgId, decision, comment || null, u.id],
  );
  if (!a) return NextResponse.json({ error: "That approval has already been decided." }, { status: 409 });

  await audit(u.orgId, u, decision === "approved" ? "Approved action" : "Rejected action", "approval", id, {
    tool: a.tool,
    runId: a.run_id,
    comment,
  });
  await resumeAfterApprovals(a.run_id, { id: u.id, name: u.name });
  return NextResponse.json({ ok: true, runId: a.run_id });
}
