import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { startRun } from "@/lib/orchestrator";

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
  const { agentId, input, useDraft } = await req.json();
  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [agentId, u.orgId]);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

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

  const runId = await startRun({
    orgId: u.orgId,
    agentId,
    spec,
    version,
    input: input || "",
    user: { id: u.id, name: u.name },
  });
  return NextResponse.json({ runId });
}
