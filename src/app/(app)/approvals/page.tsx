"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Approval = {
  id: string;
  run_id: string;
  agent_id: string;
  agent_name: string;
  tool: string;
  payload: any;
  created_at: string;
  started_by_name: string | null;
  /** False when this viewer may not decide this one; `blocked` says why. */
  canDecide: boolean;
  blocked: string | null;
  /** Deciding would be recorded as a self-approval, because nobody else can. */
  selfWouldApprove: boolean;
};

function payloadText(p: any) {
  if (p == null) return "";
  if (typeof p === "string") return p;
  if (typeof p.body === "string" && p.body.trim()) return p.body;
  if (typeof p.text === "string" && p.text.trim()) return p.text;
  return JSON.stringify(p, null, 2);
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});

  async function load() {
    try {
      const res = await fetch("/api/approvals");
      if (!res.ok) throw new Error("The approval queue could not be loaded.");
      const j = await res.json();
      setItems(j.approvals ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusy(id);
    setError("");
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment: comments[id] ?? "" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The decision could not be recorded.");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Approvals</h1>
          <p className="sub">
            Actions an agent has stopped on. You see exactly what would be sent or changed, not a summary of it.
            Approving carries the run on from where it paused.
          </p>
        </div>
      </header>

      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

      {loading ? (
        <div className="note">Loading the queue…</div>
      ) : items.length === 0 ? (
        <div className="empty">
          <h3>Nothing waiting on you</h3>
          <p>When an agent reaches an action that needs a person, it stops here and holds until you decide.</p>
        </div>
      ) : (
        <div className="stack">
          {items.map((a) => (
            <div className="panel" key={a.id}>
              <div className="spread" style={{ alignItems: "flex-start" }}>
                <div>
                  <div className="eyebrow">Waiting for approval</div>
                  <h2 style={{ margin: "6px 0 2px", fontSize: 17 }}>{a.payload?.title || a.tool}</h2>
                  <div className="sub-line">
                    <Link href={`/agents/${a.agent_id}`}>{a.agent_name}</Link>
                    {" · "}
                    <Link href={`/runs/${a.run_id}`}>view the run</Link>
                    {" · "}
                    <span className="mono">{new Date(a.created_at).toLocaleString()}</span>
                  </div>
                </div>
                <span className="tag amber">{a.tool}</span>
              </div>

              {a.started_by_name && (
                <div className="sub-line" style={{ marginTop: 6 }}>
                  Started by {a.started_by_name}
                </div>
              )}

              <div className="eyebrow mt">What would happen</div>
              <pre className="payload">{payloadText(a.payload)}</pre>

              {a.blocked ? (
                <div className="note mt">{a.blocked}</div>
              ) : (
                <>
                  {a.selfWouldApprove && (
                    <div className="note mt">
                      You started this run and nobody else in this workspace can decide it, so this will be recorded
                      as a self-approval. Invite someone with the approver role to keep the two duties apart.
                    </div>
                  )}
                  <input
                    className="input"
                    placeholder="Add a note for the record (optional)"
                    value={comments[a.id] ?? ""}
                    onChange={(e) => setComments({ ...comments, [a.id]: e.target.value })}
                  />

                  <div className="panel-foot">
                    <button className="btn" onClick={() => decide(a.id, "rejected")} disabled={busy === a.id}>
                      Reject
                    </button>
                    <button
                      className="btn btn-warn"
                      onClick={() => decide(a.id, "approved")}
                      disabled={busy === a.id}
                    >
                      {busy === a.id ? "Working…" : "Approve and continue"}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
