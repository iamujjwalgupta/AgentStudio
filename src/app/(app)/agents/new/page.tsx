import "../agents.css";
import "../builder.css";
import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { SELECTABLE_TOOLS } from "@/lib/tools";
import { domainTaxonomy, skillUsage } from "@/lib/agent-list";
import { enginesFor } from "@/lib/models";
import NewAgentStart, { type Template } from "@/components/NewAgentStart";

export const dynamic = "force-dynamic";

/**
 * Where "New agent" leads. The agent is built here and only saved when the
 * person saves it as a draft or publishes it, so an abandoned attempt no longer
 * leaves an empty "Untitled agent" behind.
 *
 * The starting points are briefs of live agents in this workspace, a few per
 * process, the most common processes first.
 */
export default async function NewAgentPage() {
  const u = await requireUser();
  const [templates, connections, skills, workspaceAgents, taxonomy, usage, engines] = await Promise.all([
    q<Template>(
      `with b as (
         select name, draft_spec->>'brief' as brief, draft_spec->>'domain' as domain, updated_at,
                substring(draft_spec->>'domain' from '· *([A-Za-z0-9]{2,6}) *(?:\\(|$)') as process
           from agents
          where org_id = $1 and status = 'published' and coalesce(draft_spec->>'brief', '') <> ''
       ), r as (
         select b.*, row_number() over (partition by process order by updated_at desc) as rn,
                count(*) over (partition by process) as n
           from b where process is not null
       )
       select name, brief, domain, process from r where rn <= 6 order by n desc, process, rn limit 60`,
      [u.orgId],
    ).catch(() => [] as Template[]),
    // The Anthropic key powers the run itself; it is not a source an agent reads from.
    q<any>(`select id, name, kind, config from connections where org_id = $1 and kind not in ('anthropic', 'gemini') order by name`, [u.orgId]),
    q<any>(`select id, name, label, description, instructions, status from skills where org_id = $1 order by label`, [u.orgId]),
    q<any>(`select id, name, description, archetype, status from agents where org_id = $1 and status <> 'retired' order by name`, [u.orgId]),
    domainTaxonomy(u.orgId).catch(() => []),
    skillUsage(u.orgId).catch(() => []),
    enginesFor(u.orgId),
  ]);

  return (
    <NewAgentStart
      templates={templates}
      ctx={{
        tools: SELECTABLE_TOOLS.map((t) => ({ id: t.id, label: t.label, description: t.description, risk: t.risk, needs: t.needs ?? null })),
        connections,
        skills,
        workspaceAgents,
        timezone: u.timezone,
        canPublish: u.canPublish,
        taxonomy,
        skillUsage: usage,
        engines,
      }}
    />
  );
}
