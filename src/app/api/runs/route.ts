import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { startAgentRun } from "@/lib/run-start";

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
  const r = await startAgentRun(u, { agentId, input, useDraft, dryRun, values });
  if ("error" in r) return NextResponse.json({ error: r.error, ...(r.missing ? { missing: r.missing } : {}) }, { status: r.status });
  return NextResponse.json({ runId: r.runId }, { status: 202 });
}
