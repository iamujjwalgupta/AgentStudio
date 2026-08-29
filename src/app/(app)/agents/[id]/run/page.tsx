import { notFound } from "next/navigation";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import RunForm from "@/components/RunForm";
import { emptySpec } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RunAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!agent) notFound();

  // Run the published version when there is one — that is the reviewed article.
  const published = agent.status === "published" && agent.published_ver
    ? await one<any>(`select spec from agent_versions where agent_id = $1 and version = $2`, [id, agent.published_ver])
    : null;

  return (
    <RunForm
      agentId={agent.id}
      agentName={agent.name}
      spec={{ ...emptySpec(), ...(published?.spec || agent.draft_spec || {}) }}
      published={Boolean(published)}
    />
  );
}
