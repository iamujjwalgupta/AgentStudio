"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SkillFromCorrectionModal, { CorrectionModalContext } from "@/components/SkillFromCorrectionModal";

type Approval = {
  id: string;
  run_id: string;
  agent_id: string;
  agent_name: string;
  tool: string;
  payload: any;
  status: "pending" | "approved" | "rejected";
  comment?: string | null;
  created_at: string;
  decided_at?: string | null;
  started_by_name: string | null;
  decided_by_name?: string | null;
  parent_run_id?: string | null;
  parent_agent_name?: string | null;
  canDecide: boolean;
  blocked: string | null;
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
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const [items, setItems] = useState<Approval[]>([]);
  const [decidedItems, setDecidedItems] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});

  // Skill compiler modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalContext, setModalContext] = useState<CorrectionModalContext | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [pRes, dRes] = await Promise.all([
        fetch("/api/approvals?status=pending"),
        fetch("/api/approvals?status=decided"),
      ]);
      if (!pRes.ok) throw new Error("The approval queue could not be loaded.");
      const pData = await pRes.json();
      setItems(pData.approvals ?? []);

      if (dRes.ok) {
        const dData = await dRes.json();
        setDecidedItems(dData.approvals ?? []);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, decision: "approved" | "rejected", thenOpenSkillModal = false) {
    setBusy(id);
    setError("");
    const comment = comments[id] ?? "";
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The decision could not be recorded.");

      if (thenOpenSkillModal) {
        const target = items.find((x) => x.id === id);
        if (target) {
          setModalContext({
            approvalId: id,
            agentId: target.agent_id,
            agentName: target.agent_name,
            tool: target.tool,
            payload: target.payload,
            comment: comment || "Action rejected. Needs stricter validation and compliance checks.",
          });
          setModalOpen(true);
        }
      }

      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  function openSkillCompilerForDecided(item: Approval) {
    setModalContext({
      approvalId: item.id,
      agentId: item.agent_id,
      agentName: item.agent_name,
      tool: item.tool,
      payload: item.payload,
      comment: item.comment || "Action was rejected by reviewer during approval check.",
    });
    setModalOpen(true);
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Approvals &amp; Governance</h1>
          <p className="sub">
            Actions an agent has stopped on. You see exactly what would be sent or changed.
            Rejecting with feedback can now be synthesized directly into reusable workspace skills.
          </p>
        </div>
      </header>

      {notice && (
        <div className="note" style={{ marginBottom: 14, borderColor: "var(--teal, #00a3a1)", background: "rgba(0,163,161,0.08)" }}>
          {notice}
        </div>
      )}

      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        <button
          className={`btn sm ${tab === "pending" ? "btn-warn" : ""}`}
          onClick={() => setTab("pending")}
        >
          Waiting on you ({items.length})
        </button>
        <button
          className={`btn sm ${tab === "decided" ? "btn-warn" : ""}`}
          onClick={() => setTab("decided")}
        >
          Decided History ({decidedItems.length})
        </button>
      </div>

      {loading ? (
        <div className="note">Loading approvals…</div>
      ) : tab === "pending" ? (
        items.length === 0 ? (
          <div className="empty">
            <h3>Nothing waiting on you</h3>
            <p>When an agent reaches an action that needs human approval, it stops here and holds until you decide.</p>
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
                    {a.parent_agent_name && (
                      <div style={{ marginTop: 4, fontSize: 12 }}>
                        <span className="mono" style={{ color: "var(--teal, #00a3a1)", fontWeight: 600 }}>Delegated task:</span>{" "}
                        <span>dispatched by <Link href={`/runs/${a.parent_run_id}`}>{a.parent_agent_name}</Link></span>
                      </div>
                    )}
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
                      placeholder="Add corrective feedback (e.g. why rejected, or conditions to follow)"
                      value={comments[a.id] ?? ""}
                      onChange={(e) => setComments({ ...comments, [a.id]: e.target.value })}
                    />

                    <div className="panel-foot" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <button className="btn" onClick={() => decide(a.id, "rejected")} disabled={busy === a.id}>
                          Reject
                        </button>
                        <button
                          className="btn"
                          style={{ borderColor: "var(--kpmg-magenta, #c6007e)", color: "var(--kpmg-magenta, #c6007e)" }}
                          onClick={() => {
                            if (!comments[a.id]?.trim()) {
                              setError("Please write a short note/correction above so the AI can synthesize it into a skill.");
                              return;
                            }
                            decide(a.id, "rejected", true);
                          }}
                          disabled={busy === a.id}
                        >
                          Reject &amp; Create Skill
                        </button>
                      </div>
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
        )
      ) : (
        /* Decided History Tab */
        decidedItems.length === 0 ? (
          <div className="empty">
            <h3>No past decisions yet</h3>
            <p>Decided approvals will be kept here with their audit notes and actions.</p>
          </div>
        ) : (
          <div className="stack">
            {decidedItems.map((a) => (
              <div className="panel" key={a.id}>
                <div className="spread" style={{ alignItems: "flex-start" }}>
                  <div>
                    <div className="eyebrow">
                      {a.status === "approved" ? "Approved" : "Rejected"}
                      {a.decided_by_name ? ` by ${a.decided_by_name}` : ""}
                    </div>
                    <h2 style={{ margin: "6px 0 2px", fontSize: 17 }}>{a.payload?.title || a.tool}</h2>
                    <div className="sub-line">
                      <Link href={`/agents/${a.agent_id}`}>{a.agent_name}</Link>
                      {" · "}
                      <Link href={`/runs/${a.run_id}`}>view the run</Link>
                      {" · "}
                      <span className="mono">
                        {new Date(a.decided_at || a.created_at).toLocaleString()}
                      </span>
                    </div>
                    {a.parent_agent_name && (
                      <div style={{ marginTop: 4, fontSize: 12 }}>
                        <span className="mono" style={{ color: "var(--teal, #00a3a1)", fontWeight: 600 }}>Delegated task:</span>{" "}
                        <span>dispatched by <Link href={`/runs/${a.parent_run_id}`}>{a.parent_agent_name}</Link></span>
                      </div>
                    )}
                  </div>
                  <span className={`tag ${a.status === "approved" ? "green" : "red"}`}>
                    {a.status}
                  </span>
                </div>

                <div className="eyebrow mt">Action Detail</div>
                <pre className="payload">{payloadText(a.payload)}</pre>

                {a.comment && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: "8px 12px",
                      background: "rgba(0,0,0,0.03)",
                      borderRadius: 4,
                      fontSize: 13,
                    }}
                  >
                    <span className="mono" style={{ fontWeight: 600 }}>Decision Note: </span>
                    <span>{a.comment}</span>
                  </div>
                )}

                <div className="panel-foot" style={{ justifyContent: "flex-end" }}>
                  <button
                    className="btn"
                    style={{ borderColor: "var(--kpmg-magenta, #c6007e)", color: "var(--kpmg-magenta, #c6007e)" }}
                    onClick={() => openSkillCompilerForDecided(a)}
                  >
                    Turn into Skill
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Skill from Correction Modal */}
      <SkillFromCorrectionModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        context={modalContext}
        onSaved={(skill, attached) => {
          setNotice(
            `Skill "${skill.label}" created successfully!${
              attached ? ` Automatically attached to the agent for future runs.` : ""
            }`
          );
        }}
      />
    </div>
  );
}

