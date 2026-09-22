import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { syncAgentSchedule } from "@/lib/agent-schedule";
import { startRun } from "@/lib/orchestrator";
import { parseSchedule, nextRun, describeSchedule } from "@/lib/schedule";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;

  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const pastRuns = await q<any>(
    `select id, status, started_at, finished_at, trigger, cost_cents
     from runs where agent_id = $1 and trigger in ('schedule', 'cron')
     order by started_at desc limit 10`,
    [id]
  );

  const spec = agent.draft_spec || {};
  const trigger = spec.trigger || { type: "manual" };
  const scheduleStr = trigger.schedule || "";
  const parsed = parseSchedule(scheduleStr);
  const next = parsed.schedule ? nextRun(parsed.schedule, u.timezone) : agent.next_run_at;
  const description = parsed.schedule ? describeSchedule(parsed.schedule, u.timezone) : "";

  return NextResponse.json({
    ok: true,
    armed: trigger.type === "schedule",
    schedule: scheduleStr,
    parsedSchedule: parsed.schedule,
    description: description || "No active recurring schedule",
    caveat: parsed.caveat || agent.schedule_caveat,
    nextRunAt: next ? new Date(next).toISOString() : null,
    standingInput: trigger.input || "",
    pastScheduledRuns: pastRuns,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;

  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { action, schedule, armed, standingInput } = body;

  // Immediate test run of the scheduled task
  if (action === "run-now") {
    const prompt =
      standingInput ||
      agent.draft_spec?.trigger?.input ||
      `Scheduled execution for ${agent.name}`;

    const runId = await startRun({
      orgId: u.orgId,
      agentId: agent.id,
      spec: agent.draft_spec,
      version: null,
      input: prompt,
      user: u,
      trigger: "schedule",
      dryRun: false,
    });

    return NextResponse.json({
      ok: true,
      runId,
      message: "Scheduled job triggered immediately",
    });
  }

  // Update schedule configuration
  const spec = agent.draft_spec || {};
  const updatedSpec = {
    ...spec,
    trigger: {
      ...(spec.trigger || {}),
      type: armed ? "schedule" : "manual",
      schedule: schedule || "",
      input: standingInput || "",
    },
  };

  await q(
    `update agents set draft_spec = $1, updated_at = now() where id = $2 and org_id = $3`,
    [JSON.stringify(updatedSpec), id, u.orgId]
  );

  const syncResult = await syncAgentSchedule(id);

  return NextResponse.json({
    ok: true,
    armed,
    schedule,
    standingInput,
    sync: syncResult,
  });
}
