"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { StatusPill } from "./Builder";

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
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/runs/${runId}`);
    if (!res.ok) return setErr("This run could not be loaded.");
    setData(await res.json());
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (data?.run?.status !== "running") return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [data?.run?.status, load]);

  const decide = async (approvalId: string, decision: "approved" | "rejected") => {
    setDeciding(approvalId);
    await fetch(`/api/approvals/${approvalId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, comment }),
    });
    setComment("");
    setDeciding(null);
    load();
  };

  if (err) return <div className="page"><div className="error">{err}</div></div>;
  if (!data) return <div className="page"><div className="note">Loading the run…</div></div>;

  const { run, steps, approvals } = data as { run: any; steps: Step[]; approvals: any[] };
  const pending = approvals.filter((a) => a.status === "pending");

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <Link href={`/agents/${run.agent_id}`} className="dim" style={{ fontSize: 13 }}>
            ← {run.agent_name}
          </Link>
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
                placeholder="Comment — recorded either way"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              <div className="row">
                <button className="btn amber" onClick={() => decide(a.id, "approved")} disabled={deciding === a.id}>
                  {deciding === a.id && <span className="spin" />}Approve and continue
                </button>
                <button className="btn" onClick={() => decide(a.id, "rejected")} disabled={deciding === a.id}>
                  Reject
                </button>
              </div>
            </div>
          ))}
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

      {run.output && (
        <div className="panel">
          <h2>Deliverable</h2>
          <div className="deliverable mt-s">{run.output}</div>
        </div>
      )}
    </div>
  );
}
