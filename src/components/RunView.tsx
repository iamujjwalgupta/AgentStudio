"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { StatusPill } from "./Builder";
import SkillFromCorrectionModal, { CorrectionModalContext } from "./SkillFromCorrectionModal";

type Step = {
  id: string;
  idx: number;
  kind: string;
  tool: string | null;
  title: string;
  input: any;
  output: any;
  status: string;
  duration_ms: number;
};

export default function RunView({ runId }: { runId: string }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Skill compiler modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalContext, setModalContext] = useState<CorrectionModalContext | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/runs/${runId}`);
    if (!res.ok) return setErr("This run could not be loaded.");
    setData(await res.json());
  }, [runId]);

  useEffect(() => {
    let sse: EventSource | null = null;
    let pollInterval: NodeJS.Timeout | null = null;

    try {
      sse = new EventSource(`/api/runs/${runId}/stream`);

      sse.addEventListener("init", (e) => {
        try {
          const payload = JSON.parse(e.data);
          setData(payload);
        } catch {}
      });

      sse.addEventListener("step", (e) => {
        try {
          const newStep = JSON.parse(e.data);
          setData((prev: any) => {
            if (!prev) return prev;
            const exists = prev.steps?.some((s: any) => s.id === newStep.id || s.idx === newStep.idx);
            if (exists) return prev;
            return {
              ...prev,
              steps: [...(prev.steps || []), newStep].sort((a: any, b: any) => a.idx - b.idx),
            };
          });
        } catch {}
      });

      sse.addEventListener("approvals", (e) => {
        try {
          const apprs = JSON.parse(e.data);
          setData((prev: any) => (prev ? { ...prev, approvals: apprs } : prev));
        } catch {}
      });

      sse.addEventListener("done", (e) => {
        try {
          const info = JSON.parse(e.data);
          setData((prev: any) => {
            if (!prev || !prev.run) return prev;
            return {
              ...prev,
              run: { ...prev.run, status: info.status, output: info.output, error: info.error },
            };
          });
        } catch {}
        if (sse) sse.close();
      });

      sse.onerror = () => {
        if (sse) sse.close();
        if (!pollInterval) {
          pollInterval = setInterval(load, 4000);
        }
      };
    } catch {
      pollInterval = setInterval(load, 3000);
    }

    load();

    return () => {
      if (sse) sse.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [runId, load]);

  const decide = async (approvalId: string, decision: "approved" | "rejected", thenCreateSkill = false) => {
    setDeciding(approvalId);
    await fetch(`/api/approvals/${approvalId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, comment }),
    });

    if (thenCreateSkill && data?.run) {
      const target = data.approvals?.find((a: any) => a.id === approvalId);
      setModalContext({
        approvalId,
        agentId: data.run.agent_id,
        agentName: data.run.agent_name,
        tool: target?.tool || "action",
        payload: target?.payload,
        comment: comment || "Rejected held action during approval review.",
        runInput: data.run.input,
      });
      setModalOpen(true);
    }

    setComment("");
    setDeciding(null);
    load();
  };

  const openSkillCompiler = (approval: any) => {
    setModalContext({
      approvalId: approval.id,
      agentId: data?.run?.agent_id,
      agentName: data?.run?.agent_name,
      tool: approval.tool,
      payload: approval.payload,
      comment: approval.comment || "Rejected by human reviewer.",
      runInput: data?.run?.input,
    });
    setModalOpen(true);
  };

  if (err) return <div className="page"><div className="error">{err}</div></div>;
  if (!data) return <div className="page"><div className="note">Loading the run…</div></div>;

  const { run, steps, approvals, parentRun, childRuns } = data as {
    run: any;
    steps: Step[];
    approvals: any[];
    parentRun?: any;
    childRuns?: any[];
  };
  const pending = approvals.filter((a) => a.status === "pending");
  const decided = approvals.filter((a) => a.status !== "pending");

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <Link href={`/agents/${run.agent_id}`} className="dim" style={{ fontSize: 13 }}>
            ← {run.agent_name}
          </Link>
          {parentRun && (
            <div style={{ marginTop: 2 }}>
              <span className="dim" style={{ fontSize: 12 }}>
                ↳ Subtask delegated by <Link href={`/runs/${parentRun.id}`}>{parentRun.agent_name}</Link>
              </span>
            </div>
          )}
          <h1>Run</h1>
          <div className="row mt-s">
            <StatusPill status={run.status} />
            <span className="mono dim">
              {new Date(run.started_at).toLocaleString()}
              {run.dry_run ? " · rehearsal — gated actions were described, not carried out" : ""}
              {run.version ? ` · v${run.version}` : " · draft"}
              {run.input_tokens ? ` · ${run.input_tokens + run.output_tokens} tokens` : ""}
            </span>
          </div>
          {run.input && <p className="sub mt-s">{run.input}</p>}
        </div>
      </header>

      {notice && (
        <div className="note" style={{ marginBottom: 14, borderColor: "var(--teal, #00a3a1)", background: "rgba(0,163,161,0.08)" }}>
          {notice}
        </div>
      )}

      {run.status === "running" && <div className="note" style={{ marginBottom: 14 }}>Working. This page updates itself.</div>}
      {run.error && <div className="error" style={{ marginBottom: 14 }}>{run.error}</div>}

      {pending.length > 0 && (
        <div className="panel" style={{ borderColor: "var(--amber-line)", background: "var(--amber-soft)", marginBottom: 14 }}>
          <div className="eyebrow" style={{ color: "var(--amber)" }}>
            {pending.length} action{pending.length > 1 ? "s" : ""} waiting for you
          </div>
          {pending.map((a) => (
            <div key={a.id} style={{ marginTop: 12 }}>
              <div className="tool-label">{a.tool}</div>
              <pre className="payload">{JSON.stringify(a.payload, null, 2)}</pre>
              <input
                className="input"
                placeholder="Comment or corrective feedback — recorded for the audit trail"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn" onClick={() => decide(a.id, "rejected")} disabled={deciding === a.id}>
                    Reject
                  </button>
                  <button
                    className="btn"
                    style={{ borderColor: "var(--kpmg-magenta, #c6007e)", color: "var(--kpmg-magenta, #c6007e)" }}
                    onClick={() => {
                      if (!comment.trim()) {
                        setErr("Add a comment explaining why this was rejected so the AI can turn it into a skill.");
                        return;
                      }
                      decide(a.id, "rejected", true);
                    }}
                    disabled={deciding === a.id}
                  >
                    Reject &amp; Turn into Skill
                  </button>
                </div>
                <button className="btn amber" onClick={() => decide(a.id, "approved")} disabled={deciding === a.id}>
                  {deciding === a.id && <span className="spin" />}Approve and continue
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <h2>Governance &amp; Decisions ({decided.length})</h2>
          <div className="stack" style={{ marginTop: 10, gap: 10 }}>
            {decided.map((d) => (
              <div key={d.id} style={{ padding: "10px 14px", background: "rgba(0,0,0,0.02)", borderRadius: 4 }}>
                <div className="spread">
                  <div className="row" style={{ gap: 8 }}>
                    <span className={`tag ${d.status === "approved" ? "green" : "red"}`}>{d.status}</span>
                    <span className="mono" style={{ fontWeight: 600 }}>{d.tool}</span>
                    {d.decided_by_name && <span className="sub-line">by {d.decided_by_name}</span>}
                  </div>
                  {d.status === "rejected" && (
                    <button
                      className="btn sm"
                      style={{ borderColor: "var(--kpmg-magenta, #c6007e)", color: "var(--kpmg-magenta, #c6007e)" }}
                      onClick={() => openSkillCompiler(d)}
                    >
                      Turn into Skill
                    </button>
                  )}
                </div>
                {d.comment && (
                  <div className="sub-line" style={{ marginTop: 6, fontStyle: "italic" }}>
                    &ldquo;{d.comment}&rdquo;
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <h2>What happened</h2>
        <ol className="timeline">
          {steps.map((s) => {
            const isGate = s.kind === "approval";
            const isErr = s.status === "error";
            const key = s.id;
            return (
              <li key={key} className={`tl ${isGate ? "gate" : ""} ${isErr ? "err" : ""}`}>
                <span className="dot" />
                <div className="tl-top">
                  <span className="tool-label">{s.title || s.kind}</span>
                  <span className="mono dim">
                    {s.tool || s.kind}
                    {s.duration_ms ? ` · ${(s.duration_ms / 1000).toFixed(1)}s` : ""}
                  </span>
                </div>
                {s.kind === "model" && s.output?.text && <div className="sub-line" style={{ whiteSpace: "pre-wrap" }}>{s.output.text}</div>}
                {(s.input || s.output) && s.kind !== "model" && (
                  <>
                    <button className="btn sm mt-s" onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
                      {open[key] ? "Hide detail" : "Show detail"}
                    </button>
                    {open[key] && (
                      <>
                        {s.input && <pre className="payload">{JSON.stringify(s.input, null, 2)}</pre>}
                        {s.output && <pre className="payload">{JSON.stringify(s.output, null, 2).slice(0, 6000)}</pre>}
                      </>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {childRuns && childRuns.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <h2>Delegated Sub-Agent Runs ({childRuns.length})</h2>
          <div className="sub-line" style={{ marginBottom: 10 }}>
            Specialized agents invoked to execute subtasks under this run.
          </div>
          <div className="stack" style={{ gap: 10 }}>
            {childRuns.map((c: any) => (
              <div key={c.id} style={{ padding: "10px 14px", background: "rgba(0,0,0,0.02)", borderRadius: 4 }}>
                <div className="spread" style={{ alignItems: "flex-start" }}>
                  <div>
                    <div className="row" style={{ gap: 8 }}>
                      <StatusPill status={c.status} />
                      <Link href={`/runs/${c.id}`} style={{ fontWeight: 600, fontSize: 14 }}>
                        {c.agent_name}
                      </Link>
                      <span className="mono dim" style={{ fontSize: 12 }}>
                        {new Date(c.started_at).toLocaleTimeString()}
                      </span>
                    </div>
                    {c.input && (
                      <div className="sub-line" style={{ marginTop: 6, fontSize: 13 }}>
                        <span className="mono" style={{ fontWeight: 600 }}>Delegated task: </span>
                        {c.input}
                      </div>
                    )}
                  </div>
                  <Link href={`/runs/${c.id}`} className="btn sm">
                    View Child Run →
                  </Link>
                </div>
                {c.output && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "6px 10px",
                      background: "rgba(0,0,0,0.02)",
                      borderRadius: 4,
                      fontSize: 12,
                      maxHeight: 120,
                      overflowY: "auto",
                    }}
                  >
                    <span className="mono" style={{ fontWeight: 600, color: "var(--teal, #00a3a1)" }}>
                      Deliverable:{" "}
                    </span>
                    {c.output}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {run.output && (
        <div className="panel">
          <h2>Deliverable</h2>
          <div className="deliverable mt-s">{run.output}</div>
        </div>
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
