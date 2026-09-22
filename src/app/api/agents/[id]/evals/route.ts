import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { listEvalSuites, runEvalSuite, getEvalHistory, type EvalSuite } from "@/lib/evals";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const u = await requireUser();
  const { id: agentId } = await params;

  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [
    agentId,
    u.orgId,
  ]);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const suites = await listEvalSuites(u.orgId, agentId);
  const history = await getEvalHistory(agentId);

  return NextResponse.json({ suites, history });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const u = await requireUser();
  const { id: agentId } = await params;
  const body = await req.json().catch(() => ({}));
  const { suiteId, useDraft = true } = body;

  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [
    agentId,
    u.orgId,
  ]);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  let spec = agent.draft_spec;
  let version: number | null = null;
  if (!useDraft && agent.published_ver) {
    const v = await one<any>(
      `select spec, version from agent_versions where agent_id = $1 and version = $2`,
      [agentId, agent.published_ver]
    );
    if (v) {
      spec = v.spec;
      version = v.version;
    }
  }

  const suites = await listEvalSuites(u.orgId, agentId);
  const suite = suites.find((s) => s.id === suiteId) || suites[0];

  if (!suite) {
    return NextResponse.json({ error: "No eval suite available" }, { status: 404 });
  }

  const summary = await runEvalSuite(u.orgId, agentId, suite, spec, version);
  return NextResponse.json({ summary });
}
