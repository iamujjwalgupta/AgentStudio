"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export type AgentRow = {
  id: string;
  name: string;
  description: string;
  archetype: string;
  status: string;
  published_ver: number | null;
  run_count: number;
  draft_spec: any;
};

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

const statusOf = (a: AgentRow) =>
  a.status === "published" ? { cls: "green", label: `v${a.published_ver} live` } : { cls: "grey", label: "Draft" };

export default function AgentList({ agents, canDelete }: { agents: AgentRow[]; canDelete: boolean }) {
  const router = useRouter();

  // Starts on the list so the first paint matches the server render; the stored
  // preference is applied after mount.
  const [view, setView] = useState<View>("list");
  const [target, setTarget] = useState<AgentRow | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  const cols = "2.4fr .9fr .9fr .9fr .9fr";
  const rowCols = `${cols} ${canDelete ? "82px" : "46px"}`;

  return (
    <>
      <div className="list-head">
        <span className="count">
          {agents.length} {agents.length === 1 ? "agent" : "agents"}
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

      {view === "list" ? (
        <div className="table">
          <div className="tr th" style={{ gridTemplateColumns: rowCols }}>
            <div>Agent</div>
            <div>Type</div>
            <div>Domain</div>
            <div>Status</div>
            <div>Runs</div>
            <div />
          </div>
          {agents.map((a) => {
            const s = statusOf(a);
            return (
              <div key={a.id} className="tr agent-row" style={{ gridTemplateColumns: rowCols }}>
                <Link href={`/agents/${a.id}`} className="cell-link">
                  <div className="name">{a.name}</div>
                  <div className="sub-line">{a.description || "No description yet"}</div>
                </Link>
                <div><span className="tag">{a.archetype}</span></div>
                <div className="mono dim">{a.draft_spec?.domain || "—"}</div>
                <div><span className={`pill ${s.cls}`}>{s.label}</span></div>
                <div className="mono dim">{a.run_count}</div>
                <div className="row-actions">
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
          {agents.map((a) => {
            const s = statusOf(a);
            return (
              <div key={a.id} className="card-wrap">
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
                    <span className="card-meta">{a.draft_spec?.domain || "No domain"}</span>
                  </div>
                </Link>
                <div className="card-actions">
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
