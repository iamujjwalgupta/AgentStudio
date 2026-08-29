import Link from "next/link";
import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { StatusPill } from "@/components/Builder";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const u = await requireUser();
  const runs = await q<any>(
    `select r.id, r.status, r.started_at, r.input, r.version, a.name as agent_name
     from runs r join agents a on a.id = r.agent_id where r.org_id = $1
     order by r.started_at desc limit 100`,
    [u.orgId],
  );
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Runs</h1>
          <p className="sub">Every execution, with its full step history.</p>
        </div>
      </header>
      {runs.length === 0 ? (
        <div className="empty"><h3>No runs yet</h3><p>Open an agent and run it to see the history here.</p></div>
      ) : (
        <div className="table">
          <div className="tr th" style={{ gridTemplateColumns: "1.4fr 1.2fr 1fr 2fr" }}>
            <div>Agent</div><div>Started</div><div>Status</div><div>Input</div>
          </div>
          {runs.map((r) => (
            <Link key={r.id} href={`/runs/${r.id}`} className="tr link" style={{ gridTemplateColumns: "1.4fr 1.2fr 1fr 2fr" }}>
              <div className="name">{r.agent_name}</div>
              <div className="mono dim">{new Date(r.started_at).toLocaleString()}</div>
              <div><StatusPill status={r.status} /></div>
              <div className="sub-line">{r.input || "—"}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
