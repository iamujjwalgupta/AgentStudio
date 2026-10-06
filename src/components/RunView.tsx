"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SkillFromCorrectionModal, { CorrectionModalContext } from "./SkillFromCorrectionModal";
import SkillMarkdown from "./SkillMarkdown";
import ActionPreview from "./approvals/ActionPreview";
import DeliverableView from "./deliverable/DeliverableView";
import { normalizeDeliverable } from "@/lib/deliverable";
import { AlertIcon, BookIcon, ChatIcon, CheckIcon, CopyIcon, CrossIcon, DocIcon, RunIcon, ShieldIcon, SparkIcon, WrenchIcon } from "./agent-ui";
import { duration, money, statusOf, tokensText, TRIGGER, triggerKind } from "./runs/run-meta";

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

const RISK: Record<string, string> = { high: "High risk", medium: "Medium risk", low: "Low risk" };
const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

function StepIcon({ s }: { s: Step }) {
  if (s.status === "error") return <AlertIcon size={13} />;
  if (s.kind === "model") return <SparkIcon size={13} />;
  if (s.kind === "approval") return <ShieldIcon size={13} />;
  if (s.kind === "output") return <DocIcon size={13} />;
  return <WrenchIcon size={13} />;
}

function Fields({ obj }: { obj: any }) {
  if (obj == null) return null;
  if (typeof obj !== "object") return <p className="rv-plain">{String(obj)}</p>;
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return null;
  return (
    <dl className="rv-fields">
      {entries.slice(0, 12).map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{typeof v === "object" ? <code>{JSON.stringify(v).slice(0, 300)}</code> : String(v).slice(0, 600)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function RunView({ runId }: { runId: string }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalContext, setModalContext] = useState<CorrectionModalContext | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    if (!res.ok) return setErr(res.status === 404 ? "This run was not found. It may have been deleted with its agent." : "This run could not be loaded.");
    const j = await res.json();
    setData((prev: any) => ({ ...(prev || {}), ...j }));
  }, [runId]);

  // Live: the stream sends new steps and approvals as they happen; polling is the fallback.
  useEffect(() => {
    let sse: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    try {
      sse = new EventSource(`/api/runs/${runId}/stream`);
      sse.addEventListener("step", (e) => {
        try {
          const step = JSON.parse((e as MessageEvent).data);
          setData((prev: any) => {
            if (!prev) return prev;
            if (prev.steps?.some((s: any) => s.id === step.id || s.idx === step.idx)) return prev;
            return { ...prev, steps: [...(prev.steps || []), step].sort((a: any, b: any) => a.idx - b.idx) };
          });
        } catch {}
      });
      // Approvals and the end of the run carry fields only the full read has (labels, who may decide).
      sse.addEventListener("approvals", () => load());
      sse.addEventListener("done", () => {
        load();
        sse?.close();
      });
      sse.onerror = () => {
        sse?.close();
        if (!poll) poll = setInterval(load, 4000);
      };
    } catch {
      poll = setInterval(load, 3000);
    }
    load();
    return () => {
      sse?.close();
      if (poll) clearInterval(poll);
    };
  }, [runId, load]);

  // A running clock for "so far".
  useEffect(() => {
    if (data?.run?.status !== "running") return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [data?.run?.status]);

  const steps: Step[] = data?.steps ?? [];
  const toolsUsed = useMemo(() => Array.from(new Set(steps.filter((s) => s.kind === "tool" && s.tool).map((s) => s.title || s.tool))), [steps]);

  async function decide(a: any, decision: "approved" | "rejected", teach = false) {
    const note = (notes[a.id] ?? "").trim();
    if (teach && !note) return setActionError("Write what the agent got wrong in the note first — that is what the skill is made from.");
    setDeciding(a.id);
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/approvals/${a.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, comment: note }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The decision could not be recorded.");
      setNotice(j.resumeError ? `Recorded, but the run could not carry on: ${j.resumeError}` : decision === "approved" ? "Approved. The run is carrying on." : "Rejected. The agent was told why and is carrying on without it.");
      if (teach) {
        setModalContext({ approvalId: a.id, agentId: data.run.agent_id, agentName: data.run.agent_name, tool: a.tool, payload: a.payload, comment: note, runInput: data.run.input });
        setModalOpen(true);
      }
      await load();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setDeciding(null);
    }
  }

  if (err) return <div className="page"><div className="error">{err}</div><p><Link href="/runs">← All runs</Link></p></div>;
  if (!data?.run) return <div className="page rv"><div className="rv-skel"><span /><span /><span /></div></div>;

  const { run, approvals = [], parentRun, childRuns = [] } = data;
  const s = statusOf(run.status, run.stuck);
  const kind = triggerKind(run);
  const pending = approvals.filter((a: any) => a.status === "pending");
  const decided = approvals.filter((a: any) => a.status !== "pending");
  const tokens = (run.input_tokens || 0) + (run.output_tokens || 0) + (run.cache_read_tokens || 0) + (run.cache_write_tokens || 0);
  const inputs = run.inputs && typeof run.inputs === "object" ? Object.entries(run.inputs).filter(([, v]) => v !== "" && v != null) : [];

  return (
    <div className="page rv">
      <nav className="rv-crumbs">
        <Link href="/runs">Runs</Link>
        <span>›</span>
        <Link href={`/agents/${run.agent_id}`}>{run.agent_name}</Link>
      </nav>
      <header className="rv-head">
        <div className="grow">
          <h1>{run.agent_name}</h1>
          <div className="rv-head-meta">
            <span className={`rv-status ${s.cls}`}><span className={`al-dot ${s.dot}`} /> {s.label}</span>
            <span>{TRIGGER[kind] ?? run.trigger}{kind === "manual" && run.started_by_name ? ` · started by ${run.started_by_name}` : ""}</span>
            <span>·</span>
            <span>{when(run.started_at)}</span>
            {run.status === "running" && !run.stuck ? (
              <><span>·</span><span>{duration(run.started_at)} so far</span></>
            ) : run.ended_at ? (
              <><span>·</span><span>took {duration(run.started_at, run.ended_at)}</span></>
            ) : null}
          </div>
          {parentRun && (
            <div className="rv-parent">Part of a team run by <Link href={`/runs/${parentRun.id}`}>{parentRun.agent_name}</Link></div>
          )}
        </div>
        <div className="rv-head-actions">
          <Link href={`/agents/${run.agent_id}`} className="btn btn-ghost">Open agent</Link>
          {run.chat_id ? (
            <Link href={`/agents/${run.agent_id}/chat?c=${run.chat_id}`} className="btn btn-primary"><ChatIcon size={13} /> Back to the conversation</Link>
          ) : (
            <Link href={`/agents/${run.agent_id}/run`} className="btn btn-primary"><RunIcon /> Run again</Link>
          )}
        </div>
      </header>

      {run.status === "running" && !run.stuck && <div className="rv-banner live"><span className="al-dot live" /> Working — this page updates as each step finishes.</div>}
      {run.stuck && (
        <div className="rv-banner bad">
          <AlertIcon size={14} /> This run started {duration(run.started_at)} ago and never finished. It most likely stopped when the server restarted or hit an error; it will not resume on its own. Run the agent again if you still need the result.
        </div>
      )}
      {run.dry_run && <div className="rv-banner info"><ShieldIcon size={14} /> Dry run — actions that need approval were described, not carried out.</div>}
      {run.error && <div className="rv-banner bad"><AlertIcon size={14} /> {run.error}</div>}
      {notice && (
        <div className="rv-banner ok">
          <CheckIcon size={13} /> <span className="grow">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss"><CrossIcon size={11} /></button>
        </div>
      )}
      {actionError && <div className="error" style={{ marginBottom: 12 }}>{actionError}</div>}

      {data?.deliverable && (
        <div className="rv-result">
          <DeliverableView
            d={normalizeDeliverable(data.deliverable.spec)}
            id={data.deliverable.id}
            compact
            fullHref={`/deliverables/${data.deliverable.id}`}
          />
        </div>
      )}

      <div className="rv-grid">
        <div className="rv-main">
          {pending.map((a: any) => (
            <section key={a.id} className="rv-card rv-waiting">
              <div className="rv-card-head">
                <div>
                  <span className="rv-kicker"><ShieldIcon size={12} /> Waiting for approval · <span className={`apx-risk ${a.tool_risk}`}>{RISK[a.tool_risk] ?? "Needs approval"}</span></span>
                  <h2>{a.tool_label}</h2>
                </div>
              </div>
              <div className="apx-preview"><ActionPreview tool={a.tool} p={a.payload} /></div>
              {a.blocked ? (
                <div className="apx-blocked"><ShieldIcon size={14} /> {a.blocked}</div>
              ) : (
                <div className="apx-decide">
                  {a.selfWouldApprove && <div className="apx-self"><AlertIcon size={13} /> You started this run and nobody else here can decide it, so this is recorded as a self-approval.</div>}
                  <label className="apx-label" htmlFor={`note-${a.id}`}>Note <em>— optional when approving; when rejecting, the agent is told this as the reason</em></label>
                  <textarea id={`note-${a.id}`} className="textarea" rows={2} value={notes[a.id] ?? ""} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                  <div className="apx-go">
                    <button className="btn btn-ghost apx-teach" onClick={() => decide(a, "rejected", true)} disabled={deciding === a.id}><BookIcon size={13} /> Reject and teach</button>
                    <span className="grow" />
                    <button className="btn btn-danger" onClick={() => decide(a, "rejected")} disabled={deciding === a.id}><CrossIcon size={11} /> Reject</button>
                    <button className="btn btn-primary" onClick={() => decide(a, "approved")} disabled={deciding === a.id}><CheckIcon size={13} /> {deciding === a.id ? "Working…" : "Approve and continue"}</button>
                  </div>
                </div>
              )}
            </section>
          ))}

          <section className="rv-card">
            <div className="rv-card-head"><h2>What it was asked</h2></div>
            {run.input?.trim() ? <p className="rv-task">{run.input}</p> : <p className="dim" style={{ margin: 0 }}>No task text — it ran from its standing instructions.</p>}
            {inputs.length > 0 && (
              <dl className="rv-fields" style={{ marginTop: 10 }}>
                {inputs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd></div>)}
              </dl>
            )}
          </section>

          <section className="rv-card">
            <div className="rv-card-head">
              <h2>What it did</h2>
              <span className="dim">{steps.length} {steps.length === 1 ? "step" : "steps"}</span>
            </div>
            {!steps.length ? (
              <p className="dim" style={{ margin: 0 }}>{run.status === "running" && !run.stuck ? "Starting…" : "No steps were recorded."}</p>
            ) : (
              <ol className="rv-steps">
                {steps.map((st, i) => {
                  const isErr = st.status === "error";
                  const expanded = open[st.id];
                  const raw = st.kind === "model" ? String(st.output?.text || "") : "";
                  // The final answer is shown in full under Deliverable; don't repeat it here.
                  const isAnswer = !!raw && !!run.output && raw.trim() === String(run.output).trim();
                  const text = isAnswer ? "" : raw;
                  const long = text.length > 420;
                  return (
                    <li key={st.id} className={`rv-step ${st.kind} ${isErr ? "err" : ""}`}>
                      <span className="rv-step-ic"><StepIcon s={st} /></span>
                      <div className="rv-step-body">
                        <div className="rv-step-top">
                          <b>{st.kind === "model" ? (st.title && st.title !== "Deliverable" ? st.title : i === steps.length - 1 && run.output ? "Wrote the deliverable" : "Thought about the next step") : st.title || st.tool || st.kind}</b>
                          {st.tool && st.kind === "tool" && <code>{st.tool}</code>}
                          <span className="grow" />
                          {st.duration_ms ? <span className="rv-dur">{(st.duration_ms / 1000).toFixed(1)}s</span> : null}
                        </div>
                        {isAnswer && <div className="rv-thought">The finished answer — see Deliverable below.</div>}
                        {text && (
                          <div className={`rv-thought ${long && !expanded ? "clamp" : ""}`}>{text}</div>
                        )}
                        {st.kind !== "model" && isErr && st.output?.error && <div className="rv-err">{String(st.output.error)}</div>}
                        {st.kind === "tool" && !isErr && st.input && <Fields obj={st.input} />}
                        {(long || (st.kind !== "model" && (st.input || st.output))) && (
                          <button className="rv-more" onClick={() => setOpen((o) => ({ ...o, [st.id]: !o[st.id] }))}>
                            {expanded ? "Show less" : long ? "Show all" : "Show details"}
                          </button>
                        )}
                        {expanded && st.kind !== "model" && (
                          <div className="rv-detail">
                            {st.input != null && <><span className="apx-label">Sent</span><pre className="apv-code">{JSON.stringify(st.input, null, 2)}</pre></>}
                            {st.output != null && <><span className="apx-label">Got back</span><pre className="apv-code">{JSON.stringify(st.output, null, 2).slice(0, 8000)}</pre></>}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
                {run.status === "running" && !run.stuck && (
                  <li className="rv-step pending"><span className="rv-step-ic"><span className="rv-spin" /></span><div className="rv-step-body"><b className="dim">Working on the next step…</b></div></li>
                )}
              </ol>
            )}
          </section>

          {run.output && (
            <section className="rv-card rv-deliverable">
              <div className="rv-card-head">
                <h2>{data?.deliverable ? "Written answer" : "Deliverable"}</h2>
                <div className="rv-card-tools">
                  <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(run.output).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); })}>
                    {copied ? <><CheckIcon size={12} /> Copied</> : <><CopyIcon size={12} /> Copy</>}
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      const url = URL.createObjectURL(new Blob([run.output], { type: "text/markdown" }));
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${run.agent_name.replace(/[^\w]+/g, "-").toLowerCase()}-${run.started_at.slice(0, 10)}.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <DocIcon size={12} /> Download .md
                  </button>
                </div>
              </div>
              <SkillMarkdown source={run.output} className="rv-md" />
            </section>
          )}
        </div>

        <aside className="rv-side">
          <section className="rv-card">
            <div className="rv-card-head"><h2>Summary</h2></div>
            <dl className="rv-facts">
              <dt>Status</dt><dd>{s.label}</dd>
              <dt>Started</dt><dd>{when(run.started_at)}</dd>
              <dt>Finished</dt><dd>{run.ended_at ? when(run.ended_at) : "—"}</dd>
              <dt>Version</dt><dd>{run.version ? `v${run.version}` : "Draft"}</dd>
              <dt>Model</dt><dd>{run.model || "—"}</dd>
              <dt>Tokens</dt><dd>{tokens ? `${tokensText(tokens)} (${tokensText(run.input_tokens)} in · ${tokensText(run.output_tokens)} out)` : "—"}</dd>
              <dt>Cost</dt><dd>{money(run.cost_usd)}</dd>
              <dt>Tools used</dt><dd>{toolsUsed.length ? toolsUsed.join(", ") : "None"}</dd>
            </dl>
          </section>

          {decided.length > 0 && (
            <section className="rv-card">
              <div className="rv-card-head"><h2>Decisions</h2></div>
              <ul className="rv-list">
                {decided.map((d: any) => (
                  <li key={d.id}>
                    <span className={`pill ${d.status === "approved" ? "green" : "red"}`}>{d.status === "approved" ? "Approved" : "Rejected"}</span>
                    <div className="grow">
                      <b>{d.tool_label}</b>
                      <span>{d.decided_by_name ? `by ${d.decided_by_name}` : ""}{d.decided_at ? ` · ${when(d.decided_at)}` : ""}</span>
                      {d.comment && <em>“{d.comment}”</em>}
                    </div>
                    {d.status === "rejected" && (
                      <button className="icon-act" title="Turn this rejection into a skill" onClick={() => { setModalContext({ approvalId: d.id, agentId: run.agent_id, agentName: run.agent_name, tool: d.tool, payload: d.payload, comment: d.comment || "Rejected by a reviewer.", runInput: run.input }); setModalOpen(true); }}>
                        <BookIcon size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {childRuns.length > 0 && (
            <section className="rv-card">
              <div className="rv-card-head"><h2>Team members&apos; runs</h2></div>
              <ul className="rv-list">
                {childRuns.map((c: any) => {
                  const cs = statusOf(c.status);
                  return (
                    <li key={c.id}>
                      <span className={`al-dot ${cs.dot}`} />
                      <Link href={`/runs/${c.id}`} className="grow">
                        <b>{c.agent_name}</b>
                        <span>{cs.label}{c.ended_at ? ` · ${duration(c.started_at, c.ended_at)}` : ""}</span>
                        {c.input && <em>{String(c.input).slice(0, 120)}</em>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </aside>
      </div>

      <SkillFromCorrectionModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        context={modalContext}
        onSaved={(skill, attached) => setNotice(`Skill “${skill.label}” created${attached ? " and attached to the agent for future runs" : ""}.`)}
      />
    </div>
  );
}
