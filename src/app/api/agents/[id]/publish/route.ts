import { NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { toolById } from "@/lib/tools";
import { syncAgentSchedule } from "@/lib/agent-schedule";
import { ENGINE_LABEL, engineAccess, engineOf } from "@/lib/models";
import type { AgentSpec } from "@/lib/types";

export const runtime = "nodejs";

/** Publishing is gated on the same checks the Review step shows the user. */
function validate(spec: AgentSpec, connKindById?: Map<string, string>) {
  const fails: string[] = [];
  if (!spec.name?.trim()) fails.push("The agent needs a name.");
  if (!spec.steps?.length || spec.steps.some((s) => !s.trim())) fails.push("Every instruction step must be filled in.");
  if (!spec.tools?.length) fails.push("Grant the agent at least one tool.");
  for (const t of spec.tools || []) {
    const def = toolById(t.id);
    if (!def) fails.push(`Unknown tool ${t.id}.`);
    else if (def.risk !== "low" && t.gate !== "approval") fails.push(`${def.label} is ${def.risk} risk and must require approval.`);
    else if (def.needs) {
      if (!spec.sources?.length) {
        fails.push(`${def.label} needs a ${def.needs} connection.`);
      } else if (connKindById) {
        const hasMatchingKind = spec.sources.some((s) => connKindById.get(s.connectionId) === def.needs);
        if (!hasMatchingKind) {
          fails.push(`${def.label} requires an attached connection of type "${def.needs}".`);
        }
      }
    }
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

  const connections = await q<any>(`select id, kind from connections where org_id = $1`, [u.orgId]);
  const connKindById = new Map<string, string>();
  for (const c of connections) connKindById.set(c.id, c.kind);

  const spec = agent.draft_spec as AgentSpec;
  const fails = validate(spec, connKindById);
  // Published means anyone can run it, so the model it runs on must be reachable.
  const engine = engineOf(spec);
  await engineAccess(u.orgId, engine).catch(() =>
    fails.push(`It runs on ${ENGINE_LABEL[engine]}, and this workspace has no key for it. Add one under Connections, or choose the other model in the Brief step.`),
  );
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
