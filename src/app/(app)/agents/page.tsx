import Link from "next/link";
import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import NewAgentButton from "@/components/NewAgentButton";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const u = await requireUser();
  let agents: any[] = [];
  let dbError: string | null = null;
  try {
    agents = await q(
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
        <div className="table">
          <div className="tr th" style={{ gridTemplateColumns: "2.4fr .9fr .9fr .9fr .9fr" }}>
            <div>Agent</div>
            <div>Type</div>
            <div>Domain</div>
            <div>Status</div>
            <div>Runs</div>
          </div>
          {agents.map((a) => (
            <Link key={a.id} href={`/agents/${a.id}`} className="tr link" style={{ gridTemplateColumns: "2.4fr .9fr .9fr .9fr .9fr" }}>
              <div>
                <div className="name">{a.name}</div>
                <div className="sub-line">{a.description || "No description yet"}</div>
              </div>
              <div><span className="tag">{a.archetype}</span></div>
              <div className="mono dim">{a.draft_spec?.domain || "—"}</div>
              <div>
                <span className={`pill ${a.status === "published" ? "green" : "grey"}`}>
                  {a.status === "published" ? `v${a.published_ver} live` : "Draft"}
                </span>
              </div>
              <div className="mono dim">{a.run_count}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
