"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatWhen } from "@/lib/format";

export type AgentRow = {
  id: string;
  name: string;
  description: string;
  archetype: string;
  status: string;
  published_ver: number | null;
  run_count: number;
  draft_spec: any;
  next_run_at: string | null;
  schedule_caveat: string;
};

// Formatted in the workspace timezone so the server and the browser agree.
const nextRunLabel = (a: AgentRow, tz: string) => formatWhen(a.next_run_at, tz);

type View = "list" | "grid";
const STORE_KEY = "agent-studio.agents.view";

/** Thin-stroke bin, inheriting colour so the button states drive it. */
function TrashIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.6 4.2h10.8" />
      <path d="M6.5 4.2V2.9c0-.45.35-.8.8-.8h1.4c.45 0 .8.35.8.8v1.3" />
      <path d="M12.1 4.2l-.45 8.5c-.03.75-.6 1.3-1.3 1.3H5.65c-.7 0-1.27-.55-1.3-1.3L3.9 4.2" />
      <path d="M6.65 6.9v4.2M9.35 6.9v4.2" />
    </svg>
  );
}

/** Thin-stroke share arrow, matching the bin. */
function ShareIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 10.4V2.2" />
      <path d="M5.2 4.9L8 2.1l2.8 2.8" />
      <path d="M3.2 8.6v4.1c0 .65.5 1.2 1.15 1.2h7.3c.65 0 1.15-.55 1.15-1.2V8.6" />
    </svg>
  );
}

/** Thin-stroke archive box, for retiring. */
function ArchiveIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="2.3" y="2.6" width="11.4" height="3.1" rx="0.8" />
      <path d="M3.4 5.7v6.6c0 .6.5 1.1 1.1 1.1h7c.6 0 1.1-.5 1.1-1.1V5.7" />
      <path d="M6.5 8.4h3" />
    </svg>
  );
}

/** Thin-stroke restore arrow, for bringing one back. */
function RestoreIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 8a5 5 0 1 0 1.5-3.6" />
      <path d="M2.6 2.9v2.9h2.9" />
    </svg>
  );
}

/** Thin-stroke play triangle, for running. */
function RunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5.4 3.4l6.4 4.6-6.4 4.6z" />
    </svg>
  );
}

const statusOf = (a: AgentRow) =>
  a.status === "retired"
    ? { cls: "grey", label: "Retired" }
    : a.status === "published"
      ? { cls: "green", label: `v${a.published_ver} live` }
      : { cls: "grey", label: "Draft" };

export default function AgentList({
  agents,
  canDelete,
  timezone,
}: {
  agents: AgentRow[];
  canDelete: boolean;
  timezone: string;
}) {
  const router = useRouter();

  // Starts on the list so the first paint matches the server render; the stored
  // preference is applied after mount.
  const [view, setView] = useState<View>("list");
  const [target, setTarget] = useState<AgentRow | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState("");
  const [term, setTerm] = useState("");
  const [archetype, setArchetype] = useState("all");
  const [status, setStatus] = useState("active");
  const [sort, setSort] = useState("updated");

  const [shareOf, setShareOf] = useState<AgentRow | null>(null);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState("");
  const [shareErr, setShareErr] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved === "grid" || saved === "list") setView(saved);
    } catch {
      /* private windows and blocked site data are fine — the default stands */
    }
  }, []);

  // Escape closes the dialog, as it would anywhere else in the app.
  useEffect(() => {
    if (!target && !shareOf) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (target) close();
      if (shareOf) closeShare();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, shareOf]);

  function choose(next: View) {
    setView(next);
    try {
      localStorage.setItem(STORE_KEY, next);
    } catch {
      /* the choice still applies for this visit */
    }
  }

  function ask(e: React.MouseEvent, a: AgentRow) {
    e.preventDefault(); // the row and the card are links; the button must not follow them
    e.stopPropagation();
    setTarget(a);
    setPassword("");
    setError("");
  }

  function askShare(e: React.MouseEvent, a: AgentRow) {
    e.preventDefault();
    e.stopPropagation();
    setShareOf(a);
    setEmail("");
    setNote("");
    setSent("");
    setShareErr("");
  }

  function closeShare() {
    setShareOf(null);
    setEmail("");
    setNote("");
    setSent("");
    setShareErr("");
  }

  async function send() {
    if (!shareOf || !email.trim()) {
      setShareErr("Enter the person's email address.");
      return;
    }
    setBusy(true);
    setShareErr("");
    try {
      const res = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: shareOf.id, email, note }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The agent could not be shared.");
      setSent(`Sent to ${j.to.name} at ${j.to.org}. It waits there until they accept it.`);
      router.refresh();
    } catch (e: any) {
      setShareErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function setRetired(e: React.MouseEvent, a: AgentRow, action: "retire" | "restore") {
    e.preventDefault();
    e.stopPropagation();
    if (action === "retire" && !confirm(`Retire "${a.name}"? It stops running, on a schedule or by hand. Every version, run and approval it produced is kept, and you can restore it at any time.`)) return;
    setWorking(a.id);
    setError("");
    try {
      const res = await fetch(`/api/agents/${a.id}/retire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "That could not be done.");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setWorking("");
    }
  }

  function close() {
    setTarget(null);
    setPassword("");
    setError("");
  }

  async function confirmDelete() {
    if (!target || !password) {
      setError("Enter your password to confirm.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/agents/${target.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The agent could not be deleted.");
      close();
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const retiredCount = agents.filter((a) => a.status === "retired").length;

  const needle = term.trim().toLowerCase();
  const shown = agents
    .filter((a) => {
      // "active" is the useful default: a retired agent is history, not inventory.
      if (status === "active" && a.status === "retired") return false;
      if (status !== "all" && status !== "active" && a.status !== status) return false;
      if (archetype !== "all" && a.archetype !== archetype) return false;
      if (!needle) return true;
      return [a.name, a.description, a.draft_spec?.domain, a.archetype]
        .filter(Boolean)
        .some((v: string) => String(v).toLowerCase().includes(needle));
    })
    .sort((x, y) => {
      if (sort === "name") return x.name.localeCompare(y.name);
      if (sort === "runs") return y.run_count - x.run_count;
      if (sort === "domain")
        return String(x.draft_spec?.domain || "").localeCompare(String(y.draft_spec?.domain || ""));
      return 0; // the server already returns most-recently-updated first
    });

  const filtered = needle !== "" || archetype !== "all" || status !== "active";

  const cols = "2.4fr .9fr .9fr .9fr .9fr";
  const rowCols = `${cols} ${canDelete ? "150px" : "114px"}`;

  return (
    <>
      <div className="filters">
        <input
          className="input search"
          value={term}
          placeholder="Search by name, description or domain"
          onChange={(e) => setTerm(e.target.value)}
        />
        <div className="chips">
          {["all", "analyst", "author", "operator", "sentinel"].map((t) => (
            <button
              key={t}
              className={`chip ${archetype === t ? "on" : ""}`}
              onClick={() => setArchetype(t)}
            >
              {t === "all" ? "All types" : t}
            </button>
          ))}
        </div>
        <select className="select-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="published">Live only</option>
          <option value="draft">Drafts only</option>
          <option value="retired">Retired{retiredCount ? ` (${retiredCount})` : ""}</option>
          <option value="all">Everything</option>
        </select>
        <select className="select-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="updated">Recently updated</option>
          <option value="name">Name</option>
          <option value="runs">Most runs</option>
          <option value="domain">Domain</option>
        </select>
      </div>

      <div className="list-head">
        <span className="count">
          {shown.length} {shown.length === 1 ? "agent" : "agents"}
          {filtered && <span className="dim"> of {agents.length}</span>}
          {filtered && (
            <button
              className="link-btn"
              onClick={() => {
                setTerm("");
                setArchetype("all");
                setStatus("active");
              }}
            >
              clear
            </button>
          )}
        </span>
        <div className="seg" role="group" aria-label="View">
          {(["list", "grid"] as View[]).map((v) => (
            <button
              key={v}
              className={`seg-opt ${view === v ? "on" : ""}`}
              onClick={() => choose(v)}
              aria-pressed={view === v}
            >
              {v === "list" ? "List" : "Grid"}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <h3>Nothing matches</h3>
          <p>No agent matches those filters. Widen the search or clear it.</p>
        </div>
      ) : view === "list" ? (
        <div className="table">
          <div className="tr th" style={{ gridTemplateColumns: rowCols }}>
            <div>Agent</div>
            <div>Type</div>
            <div>Domain</div>
            <div>Status</div>
            <div>Runs</div>
            <div />
          </div>
          {shown.map((a) => {
            const s = statusOf(a);
            return (
              <div key={a.id} className={`tr agent-row ${a.status === "retired" ? "is-retired" : ""}`} style={{ gridTemplateColumns: rowCols }}>
                <Link href={`/agents/${a.id}`} className="cell-link">
                  <div className="name">{a.name}</div>
                  <div className="sub-line">{a.description || "No description yet"}</div>
                  {nextRunLabel(a, timezone) && (
                    <div className="sub-line mono next-run" title={a.schedule_caveat || undefined}>
                      next run {nextRunLabel(a, timezone)} {timezone}
                      {a.schedule_caveat ? " ·  needs attention" : ""}
                    </div>
                  )}
                </Link>
                <div><span className="tag">{a.archetype}</span></div>
                <div className="mono dim">{a.draft_spec?.domain || "—"}</div>
                <div><span className={`pill ${s.cls}`}>{s.label}</span></div>
                <div className="mono dim">{a.run_count}</div>
                <div className="row-actions">
                  <Link
                    href={`/agents/${a.id}/run`}
                    className="icon-act"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Run ${a.name}`}
                    title="Run"
                  >
                    <RunIcon />
                  </Link>
                  <button
                    className="icon-act"
                    onClick={(e) => setRetired(e, a, a.status === "retired" ? "restore" : "retire")}
                    aria-label={`${a.status === "retired" ? "Restore" : "Retire"} ${a.name}`}
                    title={a.status === "retired" ? "Restore" : "Retire"}
                    disabled={working === a.id}
                  >
                    {a.status === "retired" ? <RestoreIcon /> : <ArchiveIcon />}
                  </button>
                  <button
                    className="icon-act"
                    onClick={(e) => askShare(e, a)}
                    aria-label={`Share ${a.name}`}
                    title="Share"
                  >
                    <ShareIcon />
                  </button>
                  {canDelete && (
                    <button
                      className="icon-act del-btn"
                      onClick={(e) => ask(e, a)}
                      aria-label={`Delete ${a.name}`}
                      title="Delete"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="cards">
          {shown.map((a) => {
            const s = statusOf(a);
            return (
              <div key={a.id} className={`card-wrap ${a.status === "retired" ? "is-retired" : ""}`}>
                <Link href={`/agents/${a.id}`} className="card">
                  <div className="card-head">
                    <span className="tag">{a.archetype}</span>
                    <span className={`pill ${s.cls}`}>{s.label}</span>
                  </div>
                  <div className="card-name">{a.name}</div>
                  <p className="card-desc">{a.description || "No description yet"}</p>
                  <div className="card-foot">
                    {/* Domain only: the action buttons claim the right of this line, and
                        the run count already has a column in the list view. */}
                    <span className="card-meta" title={a.schedule_caveat || undefined}>
                      {nextRunLabel(a, timezone) ? `next ${nextRunLabel(a, timezone)}` : a.draft_spec?.domain || "No domain"}
                    </span>
                  </div>
                </Link>
                <div className="card-actions">
                  <Link
                    href={`/agents/${a.id}/run`}
                    className="icon-act"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Run ${a.name}`}
                    title="Run"
                  >
                    <RunIcon />
                  </Link>
                  <button
                    className="icon-act"
                    onClick={(e) => setRetired(e, a, a.status === "retired" ? "restore" : "retire")}
                    aria-label={`${a.status === "retired" ? "Restore" : "Retire"} ${a.name}`}
                    title={a.status === "retired" ? "Restore" : "Retire"}
                    disabled={working === a.id}
                  >
                    {a.status === "retired" ? <RestoreIcon /> : <ArchiveIcon />}
                  </button>
                  <button
                    className="icon-act"
                    onClick={(e) => askShare(e, a)}
                    aria-label={`Share ${a.name}`}
                    title="Share"
                  >
                    <ShareIcon />
                  </button>
                  {canDelete && (
                    <button
                      className="icon-act del-btn"
                      onClick={(e) => ask(e, a)}
                      aria-label={`Delete ${a.name}`}
                      title="Delete"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {shareOf && (
        <div className="modal-back" onMouseDown={closeShare}>
          <div
            className="panel modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="eyebrow">Share agent</div>
            <h2 id="share-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>
              Send “{shareOf.name}”
            </h2>
            <p className="help" style={{ marginTop: 0 }}>
              They must already have an account. It waits for them to accept, then lands in their workspace as a
              draft. Its connections are not sent — no credential leaves this workspace, and they grant their own
              before publishing.
            </p>

            {sent ? (
              <div className="ok-note" style={{ marginTop: 4 }}>{sent}</div>
            ) : (
              <>
                <label className="field">
                  <span className="eyebrow">Their email address</span>
                  <input
                    className="input mono"
                    type="email"
                    autoFocus
                    value={email}
                    placeholder="colleague@example.com"
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !busy && send()}
                  />
                </label>
                <label className="field mt-s">
                  <span className="eyebrow">Note (optional)</span>
                  <input
                    className="input"
                    value={note}
                    placeholder="Why you are sending it"
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !busy && send()}
                  />
                </label>
              </>
            )}

            {shareErr && <div className="error" style={{ marginTop: 12 }}>{shareErr}</div>}

            <div className="panel-foot">
              <button className="btn" onClick={closeShare}>
                {sent ? "Done" : "Cancel"}
              </button>
              {!sent && (
                <button className="btn btn-primary" onClick={send} disabled={busy || !email.trim()}>
                  {busy ? "Sending…" : "Send"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {target && (
        <div className="modal-back" onMouseDown={close}>
          <div
            className="panel modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="del-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="eyebrow">Confirm deletion</div>
            <h2 id="del-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>
              Delete “{target.name}”?
            </h2>
            <p className="help" style={{ marginTop: 0 }}>
              <strong>Retiring is almost always what you want.</strong> It stops the agent running and keeps
              everything it produced, and it can be undone. Deleting cannot.
              <br />
              <br />
              This removes the agent, its {target.published_ver ? `${target.published_ver} published ` : ""}
              version history and its {target.run_count} {target.run_count === 1 ? "run" : "runs"}, with the steps and
              approvals recorded against them. The audit trail keeps the record of the deletion itself. This cannot be
              undone.
            </p>

            <label className="field" style={{ marginTop: 14 }}>
              <span className="eyebrow">Your password</span>
              <input
                className="input mono"
                type="password"
                autoFocus
                value={password}
                placeholder="Re-enter your password to confirm"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && confirmDelete()}
              />
            </label>

            {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

            <div className="panel-foot">
              <button className="btn" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-danger-solid" onClick={confirmDelete} disabled={busy || !password}>
                {busy ? "Deleting…" : "Delete agent"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
