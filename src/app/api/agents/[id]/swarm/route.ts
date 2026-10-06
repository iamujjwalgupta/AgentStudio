import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { startRun } from "@/lib/orchestrator";
import { budgetCheck } from "@/lib/spend";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;

  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const otherAgents = await q<any>(
    `select id, name, description, archetype, status from agents where org_id = $1 and id <> $2 order by name`,
    [u.orgId, id]
  );

  const swarm = agent.draft_spec?.swarm || {
    enabled: false,
    strategy: "router",
    supervisorRole: "Triage & Delegate",
    workers: [],
  };

  return NextResponse.json({
    ok: true,
    swarm,
    availableAgents: otherAgents,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;

  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { swarm, action, input } = body;

  let effectiveSpec = agent.draft_spec || {};

  // 1. If updating swarm spec
  if (swarm) {
    effectiveSpec = {
      ...effectiveSpec,
      swarm,
    };

    await q(
      `update agents set draft_spec = $1, updated_at = now() where id = $2 and org_id = $3`,
      [JSON.stringify(effectiveSpec), id, u.orgId]
    );

    await audit(u.orgId, u, "Updated Multi-Agent Swarm Configuration", "agent", id, {
      strategy: swarm.strategy,
      workerCount: swarm.workers?.length || 0,
    });
  }

  // 2. If dispatching a swarm run
  if (action === "dispatch") {
    const budget = await budgetCheck(u.orgId, agent.id);
    if (!budget.ok) return NextResponse.json({ error: budget.reason }, { status: 402 });
    const prompt = input || `Execute multi-agent swarm task: ${agent.name} acting as Supervisor Coordinator.`;
    const runId = await startRun({
      orgId: u.orgId,
      agentId: agent.id,
      spec: effectiveSpec,
      version: null,
      input: prompt,
      user: u,
      trigger: "swarm",
      dryRun: false,
    });

    return NextResponse.json({
      ok: true,
      runId,
      message: "Swarm execution dispatched successfully",
    });
  }

  return NextResponse.json({ ok: true, message: "Swarm configuration saved" });
}
