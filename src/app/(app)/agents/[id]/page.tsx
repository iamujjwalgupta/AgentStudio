import "../agents.css";
import "../builder.css";
import "../export.css";
import { notFound } from "next/navigation";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { SELECTABLE_TOOLS } from "@/lib/tools";
import Builder, { type AgentMeta, type AgentRun } from "@/components/Builder";
import { enginesFor } from "@/lib/models";
import { emptySpec } from "@/lib/types";
import { domainTaxonomy, skillUsage } from "@/lib/agent-list";
import { canDeleteAgent } from "@/lib/agent-perms";

export const dynamic = "force-dynamic";

const STEP_NAMES = ["brief", "instructions", "data", "actions", "schedule", "review"];

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; step?: string }>;
}) {
  const u = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const agent = await one<any>(
    `select a.*, us.name as owner_name from agents a left join users us on us.id = a.owner_id
      where a.id = $1 and a.org_id = $2`,
    [id, u.orgId],
  );
  if (!agent) notFound();

  const [connections, versions, published, runs, stats, pending, skills, workspaceAgents, taxonomy, usage] = await Promise.all([
    // The Anthropic key powers the run itself; it is not a source an agent reads from.
    q<any>(`select id, name, kind, config from connections where org_id = $1 and kind not in ('anthropic', 'gemini') order by name`, [u.orgId]),
    q<any>(
      `select v.version, v.note, v.created_at, us.name as by from agent_versions v
       left join users us on us.id = v.created_by where v.agent_id = $1 order by v.version desc`,
      [id],
    ),
    // The live spec, so the Review step can show what publishing would change —
    // computed against the editor's in-memory spec, not the saved draft.
    agent.published_ver
      ? one<any>(`select spec from agent_versions where agent_id = $1 and version = $2`, [id, agent.published_ver])
      : Promise.resolve(null),
    q<AgentRun>(
      `select id, status, started_at, ended_at, input, trigger, version, dry_run, cost_usd::float8 as cost_usd
         from runs where agent_id = $1 order by started_at desc limit 50`,
      [id],
    ),
    one<any>(
      `select count(*)::int as total,
              count(*) filter (where status = 'completed')::int as completed,
              count(*) filter (where status in ('failed', 'rejected'))::int as failed,
              count(*) filter (where status = 'awaiting_approval')::int as awaiting,
              count(*) filter (where status = 'running')::int as running,
              coalesce(sum(cost_usd), 0)::float8 as cost,
              (avg(extract(epoch from (ended_at - started_at))) filter (where ended_at is not null) * 1000)::float8 as avg_ms
         from runs where agent_id = $1`,
      [id],
    ),
    one<any>(
      `select count(*)::int as n from approvals ap join runs r on r.id = ap.run_id
        where r.agent_id = $1 and ap.status = 'pending'`,
      [id],
    ),
    // Every skill the workspace has, not only the attached ones: the builder is
    // where they get attached, so it needs the whole list to offer. Retired ones
    // are included so an agent still holding one can show it as retired; the
    // builder only offers active ones for attaching.
    q<any>(`select id, name, label, description, instructions, status from skills where org_id = $1 order by label`, [u.orgId]),
    // Other agents this one can delegate to.
    q<any>(
      `select id, name, description, archetype, status from agents where org_id = $1 and id <> $2 and status <> 'retired' order by name`,
      [u.orgId, id],
    ),
    domainTaxonomy(u.orgId).catch(() => []),
    skillUsage(u.orgId).catch(() => []),
  ]);

  const meta: AgentMeta = {
    ownerName: agent.owner_name ?? null,
    createdAt: agent.created_at ? new Date(agent.created_at).toISOString() : null,
    nextRunAt: agent.next_run_at ? new Date(agent.next_run_at).toISOString() : null,
    scheduleCaveat: agent.schedule_caveat || "",
    pendingApprovals: pending?.n ?? 0,
    runCount: stats?.total ?? 0,
    runStats: {
      completed: stats?.completed ?? 0,
      failed: stats?.failed ?? 0,
      awaiting: stats?.awaiting ?? 0,
      running: stats?.running ?? 0,
      costUsd: stats?.cost ?? 0,
      avgMs: stats?.avg_ms ?? null,
    },
  };

  const stepIdx = STEP_NAMES.indexOf(String(sp.step ?? ""));

  return (
    <Builder
      agentId={agent.id}
      initialSpec={{ ...emptySpec(), ...(agent.draft_spec || {}) }}
      status={agent.status}
      publishedVer={agent.published_ver}
      updatedAt={agent.updated_at ? new Date(agent.updated_at).toISOString() : null}
      tools={SELECTABLE_TOOLS.map((t) => ({ id: t.id, label: t.label, description: t.description, risk: t.risk, needs: t.needs ?? null }))}
      connections={connections}
      skills={skills}
      versions={versions}
      runs={runs.map((r) => ({
        ...r,
        started_at: new Date(r.started_at).toISOString(),
        ended_at: r.ended_at ? new Date(r.ended_at).toISOString() : null,
      }))}
      timezone={u.timezone}
      publishedSpec={published?.spec ?? null}
      canPublish={u.canPublish}
      canDelete={canDeleteAgent(u, agent)}
      workspaceAgents={workspaceAgents}
      meta={meta}
      initialTab={sp.tab}
      initialStep={stepIdx >= 0 ? stepIdx : undefined}
      taxonomy={taxonomy}
      engines={await enginesFor(u.orgId)}
      skillUsage={usage}
    />
  );
}
