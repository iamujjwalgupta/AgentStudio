import { notFound } from "next/navigation";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { TOOLS } from "@/lib/tools";
import Builder from "@/components/Builder";
import { emptySpec } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!agent) notFound();

  const connections = await q<any>(`select id, name, kind, config from connections where org_id = $1 order by name`, [u.orgId]);
  const versions = await q<any>(
    `select v.version, v.note, v.created_at, us.name as by from agent_versions v
     left join users us on us.id = v.created_by where v.agent_id = $1 order by v.version desc`,
    [id],
  );
  const runs = await q<any>(
    `select id, status, started_at, input from runs where agent_id = $1 order by started_at desc limit 20`,
    [id],
  );

  return (
    <Builder
      agentId={agent.id}
      initialSpec={{ ...emptySpec(), ...(agent.draft_spec || {}) }}
      status={agent.status}
      publishedVer={agent.published_ver}
      tools={TOOLS.map((t) => ({ id: t.id, label: t.label, description: t.description, risk: t.risk, needs: t.needs ?? null }))}
      connections={connections}
      versions={versions}
      runs={runs}
    />
  );
}
