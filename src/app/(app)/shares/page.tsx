"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Incoming = {
  id: string;
  agent_name: string;
  spec: any;
  note: string;
  status: string;
  from_user_name: string;
  from_org_name: string;
  created_at: string;
  accepted_agent_id: string | null;
};

type Outgoing = {
  id: string;
  agent_name: string;
  note: string;
  status: string;
  created_at: string;
  to_email: string;
  to_name: string;
  to_org_name: string;
};

const when = (s: string) => new Date(s).toLocaleString();

const pillFor = (status: string) =>
  status === "pending"
    ? "amber"
    : status === "accepted"
      ? "green"
      : "grey";

export default function SharesPage() {
  const router = useRouter();
  const [incoming, setIncoming] = useState<Incoming[]>([]);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [tab, setTab] = useState<"in" | "out">("in");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/shares");
      if (!res.ok) throw new Error("Shares could not be loaded.");
      const j = await res.json();
      setIncoming(j.incoming ?? []);
      setOutgoing(j.outgoing ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, action: "accept" | "decline") {
    setBusy(id);
    setError("");
    try {
      const res = await fetch(`/api/shares/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "That could not be completed.");
      await load();
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  async function withdraw(id: string, name: string) {
    if (!confirm(`Withdraw the offer of "${name}"? They will no longer be able to accept it.`)) return;
    setBusy(id);
    setError("");
    try {
      const res = await fetch(`/api/shares/${id}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "That could not be withdrawn.");
      await load();
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  const waiting = incoming.filter((s) => s.status === "pending");

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Shares</h1>
          <p className="sub">
            Agents sent to you by people in other workspaces, and the ones you have sent. Accepting copies the agent
            into this workspace as a draft — you grant it your own connections before publishing.
          </p>
        </div>
      </header>

      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="tabs">
        <button className={`tab ${tab === "in" ? "active" : ""}`} onClick={() => setTab("in")}>
          Received {waiting.length > 0 && `(${waiting.length})`}
        </button>
        <button className={`tab ${tab === "out" ? "active" : ""}`} onClick={() => setTab("out")}>
          Sent
        </button>
      </div>

      {loading ? (
        <div className="note">Loading shares…</div>
      ) : tab === "in" ? (
        incoming.length === 0 ? (
          <div className="empty">
            <h3>Nothing shared with you</h3>
            <p>When someone in another workspace sends you an agent, it waits here until you accept it.</p>
          </div>
        ) : (
          <div className="stack">
            {incoming.map((s) => (
              <div className="panel" key={s.id}>
                <div className="spread">
                  <div style={{ minWidth: 0 }}>
                    <div className="eyebrow">
                      {s.from_user_name} · {s.from_org_name}
                    </div>
                    <h2 style={{ margin: "3px 0 4px", fontSize: 16 }}>{s.agent_name}</h2>
                    <div className="sub-line">{s.spec?.purpose || "No description given."}</div>
                  </div>
                  <span className={`pill ${pillFor(s.status)}`}>{s.status}</span>
                </div>

                {s.note && (
                  <p className="help" style={{ marginTop: 12, marginBottom: 0 }}>
                    “{s.note}”
                  </p>
                )}

                <div className="sub-line mono" style={{ marginTop: 12 }}>
                  {(s.spec?.steps?.length ?? 0)} steps · {(s.spec?.tools?.length ?? 0)} tools ·{" "}
                  {s.spec?.domain || "no domain"} · sent {when(s.created_at)}
                </div>

                {s.status === "pending" ? (
                  <div className="panel-foot">
                    <button className="btn" onClick={() => decide(s.id, "decline")} disabled={busy === s.id}>
                      Decline
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => decide(s.id, "accept")}
                      disabled={busy === s.id}
                    >
                      {busy === s.id ? "Working…" : "Accept into this workspace"}
                    </button>
                  </div>
                ) : s.status === "accepted" && s.accepted_agent_id ? (
                  <div className="panel-foot">
                    <span className="sub-line">Copied into this workspace as a draft.</span>
                    <Link className="btn" href={`/agents/${s.accepted_agent_id}`}>
                      Open the agent
                    </Link>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )
      ) : outgoing.length === 0 ? (
        <div className="empty">
          <h3>You have not shared anything</h3>
          <p>
            Open <Link href="/agents">Agents</Link> and use the share control on any agent to send it to someone in
            another workspace.
          </p>
        </div>
      ) : (
        <div className="table">
          <div className="tr th" style={{ gridTemplateColumns: "1.6fr 1.8fr 1fr .9fr" }}>
            <div>Agent</div>
            <div>Sent to</div>
            <div>Sent</div>
            <div>Status</div>
          </div>
          {outgoing.map((s) => (
            <div className="tr" key={s.id} style={{ gridTemplateColumns: "1.6fr 1.8fr 1fr .9fr" }}>
              <div className="name">{s.agent_name}</div>
              <div>
                <div>{s.to_name}</div>
                <div className="sub-line mono">
                  {s.to_email} · {s.to_org_name}
                </div>
              </div>
              <div className="mono dim">{when(s.created_at)}</div>
              <div className="spread" style={{ gap: 8 }}>
                <span className={`pill ${pillFor(s.status)}`}>{s.status}</span>
                {s.status === "pending" && (
                  <button
                    className="btn btn-ghost btn-danger"
                    onClick={() => withdraw(s.id, s.agent_name)}
                    disabled={busy === s.id}
                  >
                    Withdraw
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
