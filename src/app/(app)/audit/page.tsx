import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const u = await requireUser();
  const events = await q<any>(
    `select * from audit_events where org_id = $1 order by at desc limit 300`,
    [u.orgId],
  );
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Audit trail</h1>
          <p className="sub">
            Append-only. Every specification change, publish, run, approval and delivery, with the actor and the time.
          </p>
        </div>
      </header>
      {events.length === 0 ? (
        <div className="empty"><h3>No events yet</h3><p>Build, run or publish an agent and every action lands here.</p></div>
      ) : (
        <div className="table">
          <div className="tr th" style={{ gridTemplateColumns: "1.2fr .9fr 1.3fr 2fr" }}>
            <div>When</div><div>Actor</div><div>Action</div><div>Detail</div>
          </div>
          {events.map((e) => (
            <div key={e.id} className="tr static" style={{ gridTemplateColumns: "1.2fr .9fr 1.3fr 2fr" }}>
              <div className="mono dim">{new Date(e.at).toLocaleString()}</div>
              <div className="mono">{e.actor_name}</div>
              <div className="name">{e.action}</div>
              <div className="sub-line mono">{JSON.stringify(e.detail).slice(0, 160)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
