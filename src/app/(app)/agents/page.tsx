import "./agents.css";
import "./export.css";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listAgentsPage, type AgentListPage } from "@/lib/agent-list";
import NewAgentButton from "@/components/NewAgentButton";
import AgentList from "@/components/AgentList";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const u = await requireUser();
  // Only the first page is rendered here; the list fetches further pages, searches
  // and filters from /api/agents/list rather than receiving every agent up front.
  let initial: AgentListPage | null = null;
  let dbError: string | null = null;
  try {
    initial = await listAgentsPage(u.orgId, {});
  } catch (e: any) {
    dbError = e.message;
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Agents</h1>
          <p className="sub" style={{ maxWidth: "none" }}>
            Describe work in plain language. Publish it as an agent that runs with the tools you grant it.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <Link href="/sandbox" className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            Import an agent
          </Link>
          <NewAgentButton />
        </div>
      </header>

      {dbError && <div className="error">The database is not reachable: {dbError}</div>}

      {!dbError && initial && initial.totalAll === 0 ? (
        <div className="empty">
          <h3>Nothing here yet</h3>
          <p>Start with something you do every week. Describe it once and it runs on its own.</p>
          <NewAgentButton />
        </div>
      ) : (
        !dbError && initial && <AgentList initial={initial} me={{ id: u.id, canPublish: u.canPublish }} timezone={u.timezone} />
      )}
    </div>
  );
}
