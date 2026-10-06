import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { startRun } from "@/lib/orchestrator";
import { budgetCheck } from "@/lib/spend";
import { composeRunInput, missingRequired } from "@/lib/run-input";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const u = await requireUser();
  const runs = await q(
    `select r.id, r.status, r.started_at, r.ended_at, r.input, a.name as agent_name
     from runs r join agents a on a.id = r.agent_id
     where r.org_id = $1 order by r.started_at desc limit 50`,
    [u.orgId],
  );
  return NextResponse.json({ runs });
}

export async function POST(req: Request) {
  const u = await requireUser();
  const { agentId, input, useDraft, dryRun, values } = await req.json();
  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [agentId, u.orgId]);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (agent.status === "retired") {
    return NextResponse.json(
      { error: "That agent is retired. Restore it before running it again." },
      { status: 409 },
    );
  }

  let spec = agent.draft_spec;
  let version: number | null = null;
  if (!useDraft && agent.published_ver) {
    const v = await one<any>(`select spec, version from agent_versions where agent_id = $1 and version = $2`, [
      agentId,
      agent.published_ver,
    ]);
    if (v) {
      spec = v.spec;
      version = v.version;
    }
  }
  if (!spec?.steps?.length) return NextResponse.json({ error: "Add instructions before running this agent." }, { status: 400 });

  // The form's answers, not a single blob of prose.
  const supplied: Record<string, string> = values && typeof values === "object" ? values : {};
  const missing = missingRequired(spec, supplied);
  if (missing.length) {
    return NextResponse.json(
      { error: `Fill in ${missing.join(", ")} before running this agent.`, missing },
      { status: 400 },
    );
  }

  const budget = await budgetCheck(u.orgId, agentId);
  if (!budget.ok) return NextResponse.json({ error: budget.reason }, { status: 402 });

  const runId = await startRun({
    orgId: u.orgId,
    agentId,
    spec,
    version,
    input: composeRunInput(spec, supplied, input || ""),
    user: { id: u.id, name: u.name },
    dryRun: Boolean(dryRun),
    inputs: supplied,
    waitForCompletion: false,
  });
  return NextResponse.json({ runId }, { status: 202 });
}
