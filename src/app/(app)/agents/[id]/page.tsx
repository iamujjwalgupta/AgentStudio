import { notFound } from "next/navigation";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { SELECTABLE_TOOLS } from "@/lib/tools";
import Builder from "@/components/Builder";
import { emptySpec } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!agent) notFound();

  // The Anthropic key powers the run itself; it is not a source an agent reads from.
  const connections = await q<any>(
    `select id, name, kind, config from connections where org_id = $1 and kind <> 'anthropic' order by name`,
    [u.orgId],
  );
  const versions = await q<any>(
    `select v.version, v.note, v.created_at, us.name as by from agent_versions v
     left join users us on us.id = v.created_by where v.agent_id = $1 order by v.version desc`,
    [id],
  );
  // The live spec, so the Review step can show what publishing would change —
  // computed against the editor's in-memory spec, not the saved draft.
  const published = agent.published_ver
    ? await one<any>(`select spec from agent_versions where agent_id = $1 and version = $2`, [id, agent.published_ver])
    : null;
  const runs = await q<any>(
    `select id, status, started_at, input from runs where agent_id = $1 order by started_at desc limit 20`,
    [id],
  );
  // Every skill the workspace has, not only the attached ones: the builder is
  // where they get attached, so it needs the whole list to offer.
  const skills = await q<any>(
    `select id, name, label, description, instructions from skills where org_id = $1 order by label`,
    [u.orgId],
  );

  // Query other agents in the workspace for multi-agent swarm delegation
  const workspaceAgents = await q<any>(
    `select id, name, description, archetype, status from agents where org_id = $1 and id <> $2 order by name`,
    [u.orgId, id],
  );

  return (
    <Builder
      agentId={agent.id}
      initialSpec={{ ...emptySpec(), ...(agent.draft_spec || {}) }}
      status={agent.status}
      publishedVer={agent.published_ver}
      updatedAt={agent.updated_at ? new Date(agent.updated_at).toISOString() : new Date().toISOString()}
      tools={SELECTABLE_TOOLS.map((t) => ({ id: t.id, label: t.label, description: t.description, risk: t.risk, needs: t.needs ?? null }))}
      connections={connections}
      skills={skills}
      versions={versions}
      runs={runs}
      timezone={u.timezone}
      publishedSpec={published?.spec ?? null}
      canPublish={u.canPublish}
      workspaceAgents={workspaceAgents}
    />
  );
}
