import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { toolById } from "@/lib/tools";
import { syncAgentSchedule } from "@/lib/agent-schedule";
import type { AgentSpec } from "@/lib/types";

export const runtime = "nodejs";

/** Publishing is gated on the same checks the Review step shows the user. */
function validate(spec: AgentSpec) {
  const fails: string[] = [];
  if (!spec.name?.trim()) fails.push("The agent needs a name.");
  if (!spec.steps?.length || spec.steps.some((s) => !s.trim())) fails.push("Every instruction step must be filled in.");
  if (!spec.tools?.length) fails.push("Grant the agent at least one tool.");
  for (const t of spec.tools || []) {
    const def = toolById(t.id);
    if (!def) fails.push(`Unknown tool ${t.id}.`);
    else if (def.risk !== "low" && t.gate !== "approval") fails.push(`${def.label} is ${def.risk} risk and must require approval.`);
    else if (def.needs && !spec.sources.length) fails.push(`${def.label} needs a ${def.needs} connection.`);
  }
  if (spec.trigger?.type === "schedule" && !spec.trigger.schedule) fails.push("Set the schedule.");
  return fails;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;

  if (!u.canPublish) {
    return NextResponse.json(
      { error: "Only the workspace owner and admins can publish an agent." },
      { status: 403 },
    );
  }

  const { note } = await req.json().catch(() => ({ note: "" }));
  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const spec = agent.draft_spec as AgentSpec;
  const fails = validate(spec);
  if (fails.length) return NextResponse.json({ error: fails.join(" ") }, { status: 400 });

  const next = (agent.published_ver || 0) + 1;
  await one(
    `insert into agent_versions (agent_id, version, spec, note, created_by) values ($1,$2,$3,$4,$5) returning id`,
    [id, next, JSON.stringify(spec), note || (next === 1 ? "First published version." : "Updated."), u.id],
  );
  const updated = await one<any>(
    `update agents set status = 'published', published_ver = $2, updated_at = now() where id = $1 returning *`,
    [id, next],
  );
  // Publishing is what arms a schedule; the published spec is what will run.
  const sched = await syncAgentSchedule(id);
  await audit(u.orgId, u, "Published agent", "agent", id, {
    version: next,
    name: agent.name,
    ...(sched.next ? { nextRun: sched.next.toISOString() } : {}),
  });
  return NextResponse.json({ agent: updated, version: next, schedule: sched });
}
