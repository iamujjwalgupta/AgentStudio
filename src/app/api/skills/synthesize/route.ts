import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { synthesizeSkillFromCorrection, type CorrectionContext } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const u = await requireUser();
  const body = await req.json();
  const { approvalId, comment: overrideComment } = body;

  let ctx: CorrectionContext;
  let targetAgentId: string | null = null;

  if (approvalId) {
    const row = await one<any>(
      `select ap.tool, ap.payload, ap.comment, r.input as run_input, r.agent_id,
              a.name as agent_name, a.description as agent_purpose
         from approvals ap
         join runs r on r.id = ap.run_id
         join agents a on a.id = r.agent_id
        where ap.id = $1 and ap.org_id = $2`,
      [approvalId, u.orgId],
    );
    if (!row) {
      return NextResponse.json({ error: "Approval record not found." }, { status: 404 });
    }

    const comment = String(overrideComment || row.comment || "").trim();
    if (!comment) {
      return NextResponse.json(
        { error: "Provide a reviewer comment or correction note explaining why this action was rejected/modified." },
        { status: 400 },
      );
    }

    targetAgentId = row.agent_id;
    ctx = {
      agentName: row.agent_name,
      agentPurpose: row.agent_purpose,
      tool: row.tool,
      payload: row.payload,
      comment,
      runInput: row.run_input,
    };
  } else {
    const { agentId, agentName, agentPurpose, tool, payload, comment, runInput } = body;
    if (!String(comment || "").trim()) {
      return NextResponse.json(
        { error: "Provide a reviewer comment or correction note explaining why this action was rejected/modified." },
        { status: 400 },
      );
    }
    targetAgentId = agentId || null;
    ctx = {
      agentName: String(agentName || "Agent"),
      agentPurpose: agentPurpose || "",
      tool: String(tool || "action"),
      payload,
      comment: String(comment).trim(),
      runInput: runInput || "",
    };
  }

  try {
    const draft = await synthesizeSkillFromCorrection(u.orgId, ctx, u.id);
    return NextResponse.json({ draft, agentId: targetAgentId });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to synthesize skill from correction." },
      { status: 500 },
    );
  }
}
