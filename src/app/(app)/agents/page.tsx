import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import NewAgentButton from "@/components/NewAgentButton";
import AgentList, { type AgentRow } from "@/components/AgentList";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const u = await requireUser();
  let agents: AgentRow[] = [];
  let dbError: string | null = null;
  try {
    agents = await q<AgentRow>(
      `select a.*, (select count(*)::int from runs r where r.agent_id = a.id) as run_count,
              (select max(started_at) from runs r where r.agent_id = a.id) as last_run
       from agents a where a.org_id = $1 order by a.updated_at desc`,
      [u.orgId],
    );
  } catch (e: any) {
    dbError = e.message;
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Agents</h1>
          <p className="sub">Describe work in plain language. Publish it as an agent that runs with the tools you grant it.</p>
        </div>
        <NewAgentButton />
      </header>

      {dbError && <div className="error">The database is not reachable: {dbError}</div>}

      {!dbError && agents.length === 0 ? (
        <div className="empty">
          <h3>Nothing here yet</h3>
          <p>Start with something you do every week. Describe it once and it runs on its own.</p>
          <NewAgentButton />
        </div>
      ) : (
        !dbError && <AgentList agents={agents} canDelete={u.isOwner} timezone={u.timezone} />
      )}
    </div>
  );
}
