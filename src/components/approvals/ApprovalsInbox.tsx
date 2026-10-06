"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SkillFromCorrectionModal, { CorrectionModalContext } from "@/components/SkillFromCorrectionModal";
import SkillDownloadRequests from "@/components/SkillDownloadRequests";
import Pagination from "@/components/Pagination";
import { AlertIcon, BookIcon, CheckIcon, ClockIcon, CrossIcon, ShieldIcon } from "@/components/agent-ui";
import ActionPreview from "./ActionPreview";

type Approval = {
  id: string;
  run_id: string;
  agent_id: string;
  agent_name: string;
  tool: string;
  tool_label: string;
  tool_risk: "low" | "medium" | "high";
  payload: any;
  status: "pending" | "approved" | "rejected";
  comment?: string | null;
  created_at: string;
  decided_at?: string | null;
  started_by_name: string | null;
  decided_by_name?: string | null;
  parent_run_id?: string | null;
  parent_agent_name?: string | null;
  run_input?: string | null;
  self_approved?: boolean;
  canDecide: boolean;
  blocked: string | null;
  selfWouldApprove: boolean;
};

type Tab = "pending" | "decided" | "downloads";

const RISK: Record<string, { label: string; cls: string }> = {
  high: { label: "High risk", cls: "high" },
  medium: { label: "Medium risk", cls: "medium" },
  low: { label: "Low risk", cls: "low" },
};

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}
const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

/* ---------------------------------------------------------------------------------- */
/* What the action would do, shown as the thing itself rather than as raw JSON.        */
/* ---------------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------------- */

export default function ApprovalsInbox() {
  const [tab, setTab] = useState<Tab>("pending");
  const [pending, setPending] = useState<Approval[]>([]);
  const [decided, setDecided] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [canDownloads, setCanDownloads] = useState(false);
  const [downloadCount, setDownloadCount] = useState(0);
  const [showRaw, setShowRaw] = useState(false);

  // decided list
  const [term, setTerm] = useState("");
  const [outcome, setOutcome] = useState<"" | "approved" | "rejected">("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalContext, setModalContext] = useState<CorrectionModalContext | null>(null);

  async function load() {
    try {
      const [p, d] = await Promise.all([
        fetch("/api/approvals?status=pending", { cache: "no-store" }),
        fetch("/api/approvals?status=decided", { cache: "no-store" }),
      ]);
      if (!p.ok) throw new Error("The approval queue could not be loaded.");
      const pj = await p.json();
      setPending(pj.approvals ?? []);
      if (d.ok) setDecided((await d.json()).approvals ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    fetch("/api/skill-downloads?status=pending", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return;
        setCanDownloads(true);
        setDownloadCount(((await r.json()).requests ?? []).length);
      })
      .catch(() => {});
  }, []);
  // Keep a selection while there is something to select.
  useEffect(() => {
    if (!pending.length) setSelected(null);
    else if (!selected || !pending.some((a) => a.id === selected)) setSelected(pending[0].id);
  }, [pending, selected]);
  useEffect(() => setShowRaw(false), [selected]);
  useEffect(() => setPage(1), [term, outcome, pageSize]);

  const current = pending.find((a) => a.id === selected) ?? null;
  const mineToDecide = pending.filter((a) => a.canDecide).length;
  const oldest = pending.length ? pending.reduce((o, a) => (new Date(a.created_at) < new Date(o.created_at) ? a : o)) : null;
  const weekAgo = Date.now() - 7 * 864e5;
  const decidedWeek = decided.filter((a) => a.decided_at && new Date(a.decided_at).getTime() > weekAgo);

  async function decide(a: Approval, decision: "approved" | "rejected", teach = false) {
    const note = (notes[a.id] ?? "").trim();
    if (teach && !note) {
      setError("Write what the agent got wrong in the note first — that is what the skill is made from.");
      return;
    }
    setBusy(a.id);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/approvals/${a.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment: note }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The decision could not be recorded.");
      setNotice(
        j.resumeError
          ? `Recorded, but the run could not carry on: ${j.resumeError}`
          : decision === "approved"
            ? `Approved. ${a.agent_name} carried out “${a.tool_label}” and carried on.`
            : `Rejected. ${a.agent_name} was told why and carried on without it.`,
      );
      if (teach) {
        setModalContext({ approvalId: a.id, agentId: a.agent_id, agentName: a.agent_name, tool: a.tool, payload: a.payload, comment: note });
        setModalOpen(true);
      }
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const shownDecided = useMemo(() => {
    const n = term.trim().toLowerCase();
    return decided.filter(
      (a) =>
        (!outcome || a.status === outcome) &&
        (!n || [a.agent_name, a.tool_label, a.tool, a.decided_by_name, a.comment].some((v) => (v || "").toLowerCase().includes(n))),
    );
  }, [decided, term, outcome]);
  const pageRows = shownDecided.slice((page - 1) * pageSize, page * pageSize);

  const stats: { key: Tab; label: string; value: string | number; tone?: string; hint?: string }[] = [
    { key: "pending", label: "Waiting for a decision", value: pending.length, tone: pending.length ? "warn" : "", hint: pending.length && mineToDecide < pending.length ? `${mineToDecide} you can decide` : undefined },
    { key: "pending", label: "Waiting longest", value: oldest ? ago(oldest.created_at) : "—" },
    { key: "decided", label: "Decided in the last 7 days", value: decidedWeek.length },
    { key: "decided", label: "Rejected in the last 7 days", value: decidedWeek.filter((a) => a.status === "rejected").length },
    ...(canDownloads ? [{ key: "downloads" as Tab, label: "Skill downloads waiting", value: downloadCount, tone: downloadCount ? "warn" : "" }] : []),
  ];

  return (
    <div className="page apx">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Approvals</h1>
          <p className="sub" style={{ maxWidth: 820 }}>
            Actions agents have paused on until a person decides. You see exactly what would be sent or changed; approve to let it happen, or reject to have the agent carry on without it.
          </p>
        </div>
      </header>

      <div className="al-summary" role="group" aria-label="Approvals summary">
        {stats.map((s) => (
          <button key={s.label} className={`al-stat ${s.tone ?? ""} ${tab === s.key && s.label === stats.find((x) => x.key === tab)?.label ? "on" : ""}`} onClick={() => setTab(s.key)}>
            <span className="v">{s.value}</span>
            <span className="l">{s.label}{s.hint ? ` · ${s.hint}` : ""}</span>
          </button>
        ))}
      </div>

      <div className="apx-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "pending"} className={tab === "pending" ? "on" : ""} onClick={() => setTab("pending")}>
          Waiting {pending.length > 0 && <span className="warn">{pending.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === "decided"} className={tab === "decided" ? "on" : ""} onClick={() => setTab("decided")}>
          Decided <span>{decided.length}</span>
        </button>
        {canDownloads && (
          <button role="tab" aria-selected={tab === "downloads"} className={tab === "downloads" ? "on" : ""} onClick={() => setTab("downloads")}>
            Skill downloads {downloadCount > 0 && <span className="warn">{downloadCount}</span>}
          </button>
        )}
      </div>

      {notice && (
        <div className="apx-notice">
          <CheckIcon size={13} />
          <span className="grow">{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Dismiss"><CrossIcon size={11} /></button>
        </div>
      )}
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      {tab === "downloads" ? (
        <SkillDownloadRequests onCount={setDownloadCount} />
      ) : loading ? (
        <div className="apx-skel"><span /><span /><span /></div>
      ) : tab === "pending" ? (
        !pending.length ? (
          <div className="apx-empty">
            <span className="apx-empty-ic"><ShieldIcon size={22} /></span>
            <h3>Nothing is waiting</h3>
            <p>When an agent reaches an action set to need approval — sending an email, changing data, posting a message — it stops here and waits until someone decides.</p>
          </div>
        ) : (
          <div className="apx-inbox">
            <ul className="apx-list" aria-label="Waiting for a decision">
              {pending.map((a) => (
                <li key={a.id}>
                  <button className={a.id === selected ? "on" : ""} onClick={() => setSelected(a.id)}>
                    <span className={`apx-risk-dot ${a.tool_risk}`} title={RISK[a.tool_risk]?.label} />
                    <span className="grow">
                      <b>{a.tool_label}</b>
                      <span>{a.agent_name}</span>
                    </span>
                    <span className="apx-age"><ClockIcon size={11} /> {ago(a.created_at)}</span>
                    {!a.canDecide && <span className="apx-cant" title={a.blocked ?? ""}>view only</span>}
                  </button>
                </li>
              ))}
            </ul>

            {current && (
              <section className="apx-detail" aria-label="Selected approval">
                <div className="apx-detail-head">
                  <div className="grow">
                    <div className="apx-kicker">
                      <span className={`apx-risk ${current.tool_risk}`}>{RISK[current.tool_risk]?.label}</span>
                      <span>waiting {ago(current.created_at)} · since {when(current.created_at)}</span>
                    </div>
                    <h2>{current.tool_label}</h2>
                    <div className="apx-meta">
                      <Link href={`/agents/${current.agent_id}`}>{current.agent_name}</Link>
                      <span>·</span>
                      <Link href={`/runs/${current.run_id}`}>Open the run</Link>
                      {current.started_by_name && <><span>·</span><span>started by {current.started_by_name}</span></>}
                      {current.parent_agent_name && (
                        <><span>·</span><span>delegated by <Link href={`/runs/${current.parent_run_id}`}>{current.parent_agent_name}</Link></span></>
                      )}
                    </div>
                  </div>
                </div>

                {current.run_input?.trim() && (
                  <div className="apx-block">
                    <span className="apx-label">What the agent was asked to do</span>
                    <p className="apx-task">{current.run_input.length > 600 ? `${current.run_input.slice(0, 600)}…` : current.run_input}</p>
                  </div>
                )}

                <div className="apx-block">
                  <span className="apx-label">What would happen if you approve</span>
                  <div className="apx-preview"><ActionPreview tool={current.tool} p={current.payload} /></div>
                  <button className="apx-raw-toggle" onClick={() => setShowRaw(!showRaw)}>{showRaw ? "Hide" : "Show"} the exact data</button>
                  {showRaw && <pre className="apv-code">{JSON.stringify(current.payload, null, 2)}</pre>}
                </div>

                {current.blocked ? (
                  <div className="apx-blocked"><ShieldIcon size={14} /> {current.blocked}</div>
                ) : (
                  <div className="apx-decide">
                    {current.selfWouldApprove && (
                      <div className="apx-self">
                        <AlertIcon size={13} /> You started this run and nobody else here can decide it, so this is recorded as a self-approval. Give someone the approver role to keep the two duties apart.
                      </div>
                    )}
                    <label className="apx-label" htmlFor="apx-note">Note <em>— optional when approving; when rejecting, the agent is told this as the reason</em></label>
                    <textarea
                      id="apx-note"
                      className="textarea"
                      rows={2}
                      value={notes[current.id] ?? ""}
                      placeholder="e.g. Use the finance distribution list, not the whole company."
                      onChange={(e) => setNotes({ ...notes, [current.id]: e.target.value })}
                    />
                    <div className="apx-go">
                      <button
                        className="btn btn-ghost apx-teach"
                        onClick={() => decide(current, "rejected", true)}
                        disabled={busy === current.id}
                        title="Reject, then turn your note into a skill so the agent does it right next time"
                      >
                        <BookIcon size={13} /> Reject and teach
                      </button>
                      <span className="grow" />
                      <button className="btn btn-danger" onClick={() => decide(current, "rejected")} disabled={busy === current.id}>
                        <CrossIcon size={11} /> Reject
                      </button>
                      <button className="btn btn-primary" onClick={() => decide(current, "approved")} disabled={busy === current.id}>
                        <CheckIcon size={13} /> {busy === current.id ? "Working…" : "Approve and continue"}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        )
      ) : (
        /* ---- decided ---- */
        <>
          <div className="al-toolbar">
            <div className="al-toolbar-row">
              <input className="input search al-search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by agent, action, person or note" aria-label="Search decisions" />
              <select className="select-sm" value={outcome} onChange={(e) => setOutcome(e.target.value as any)} aria-label="Outcome">
                <option value="">All decisions</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <span className="al-count">{shownDecided.length} {shownDecided.length === 1 ? "decision" : "decisions"}</span>
            </div>
          </div>
          {!shownDecided.length ? (
            <div className="apx-empty">
              <h3>{decided.length ? "Nothing matches" : "No decisions yet"}</h3>
              <p>{decided.length ? "Try another search or outcome." : "Decided approvals are kept here with who decided and why."}</p>
            </div>
          ) : (
            <div className="al-table apx-table" role="table">
              <div className="al-row al-head" role="row">
                <div>Action</div>
                <div>Decision</div>
                <div>By</div>
                <div>When</div>
                <div>Note</div>
                <div />
              </div>
              {pageRows.map((a) => (
                <div key={a.id} className="al-row" role="row" style={{ cursor: "default" }}>
                  <div className="al-main">
                    <span className="al-name" style={{ cursor: "default" }}>{a.tool_label}</span>
                    <div className="al-desc"><Link href={`/agents/${a.agent_id}`}>{a.agent_name}</Link></div>
                  </div>
                  <div>
                    <span className={`pill ${a.status === "approved" ? "green" : "red"}`}>{a.status === "approved" ? "Approved" : "Rejected"}</span>
                    {a.self_approved && <div className="al-small dim">self-approved</div>}
                  </div>
                  <div className="al-small">{a.decided_by_name || "—"}</div>
                  <div className="al-small">{when(a.decided_at || a.created_at)}</div>
                  <div className="al-small apx-note-cell" title={a.comment || undefined}>{a.comment || <span className="dim">—</span>}</div>
                  <div className="al-actions">
                    <Link className="btn sm al-run" href={`/runs/${a.run_id}`}>Run</Link>
                    {a.status === "rejected" && (
                      <button
                        className="icon-act"
                        title="Turn this rejection into a skill"
                        aria-label="Turn into a skill"
                        onClick={() => {
                          setModalContext({ approvalId: a.id, agentId: a.agent_id, agentName: a.agent_name, tool: a.tool, payload: a.payload, comment: a.comment || "The reviewer rejected this action." });
                          setModalOpen(true);
                        }}
                      >
                        <BookIcon size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {shownDecided.length > pageSize && (
            <Pagination currentPage={page} totalItems={shownDecided.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} pageSizeOptions={[10, 25, 50]} itemLabel="decision" itemLabelPlural="decisions" />
          )}
          <p className="apx-foot-note">The last 50 decisions are shown. Every decision is also in the <Link href="/audit">Audit trail</Link>.</p>
        </>
      )}

      <SkillFromCorrectionModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        context={modalContext}
        onSaved={(skill, attached) => setNotice(`Skill “${skill.label}” created${attached ? " and attached to the agent for future runs" : ""}.`)}
      />
    </div>
  );
}

