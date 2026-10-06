import { NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { TOOLS } from "@/lib/tools";
import { specSkillIds } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the Agents list's quick-look panel shows: the live version's tools, data,
 * skills and schedule, and the last few runs. Small on purpose; the builder is
 * where the full spec lives.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const agent = await one<any>(
    `select a.id, a.name, a.description, a.archetype, a.status, a.published_ver, a.next_run_at,
            a.schedule_caveat, a.draft_spec, a.updated_at, us.name as owner_name
       from agents a left join users us on us.id = a.owner_id
      where a.id = $1 and a.org_id = $2`,
    [id, u.orgId],
  );
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The live version is what actually runs; a draft-only agent shows its draft.
  let spec = agent.draft_spec ?? {};
  if (agent.published_ver) {
    const v = await one<any>(`select spec from agent_versions where agent_id = $1 and version = $2`, [id, agent.published_ver]);
    if (v?.spec) spec = v.spec;
  }

  const toolLabel = new Map(TOOLS.map((t) => [t.id, { label: t.label, risk: t.risk }]));
  const tools = (Array.isArray(spec.tools) ? spec.tools : []).map((t: any) => ({
    id: t.id,
    label: toolLabel.get(t.id)?.label ?? t.id,
    risk: toolLabel.get(t.id)?.risk ?? "low",
    gate: t.gate,
  }));

  const sourceIds = (Array.isArray(spec.sources) ? spec.sources : []).map((s: any) => s.connectionId).filter(Boolean);
  const sources = sourceIds.length
    ? await q<any>(`select name, kind from connections where org_id = $1 and id = any($2::uuid[])`, [u.orgId, sourceIds]).catch(() => [])
    : [];

  const skillIds = specSkillIds(spec);
  const skills = skillIds.length
    ? await q<any>(`select label, status from skills where org_id = $1 and id = any($2::uuid[]) order by label`, [u.orgId, skillIds]).catch(() => [])
    : [];

  const runs = await q<any>(
    `select id, status, trigger, started_at, ended_at, cost_usd::float8 as cost
       from runs where agent_id = $1 order by started_at desc limit 5`,
    [id],
  );
  const runCount = await one<any>(`select count(*)::int as n from runs where agent_id = $1`, [id]);

  return NextResponse.json({
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      archetype: agent.archetype,
      status: agent.status,
      published_ver: agent.published_ver,
      next_run_at: agent.next_run_at,
      schedule_caveat: agent.schedule_caveat,
      owner_name: agent.owner_name,
      updated_at: agent.updated_at,
      domain: spec.domain ?? agent.draft_spec?.domain ?? null,
      trigger: spec.trigger ?? null,
      steps: Array.isArray(spec.steps) ? spec.steps.length : 0,
      inputs: Array.isArray(spec.inputs) ? spec.inputs.map((i: any) => i.label).filter(Boolean) : [],
    },
    tools,
    sources,
    skills,
    runs,
    runCount: runCount?.n ?? 0,
  });
}
