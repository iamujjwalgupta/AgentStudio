"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertIcon, CheckIcon, CrossIcon, ShareIcon } from "@/components/agent-ui";

type Incoming = {
  id: string;
  agent_name: string;
  spec: any;
  note: string;
  status: "pending" | "accepted" | "declined" | "revoked";
  from_user_name: string;
  from_org_name: string;
  created_at: string;
  decided_at: string | null;
  accepted_agent_id: string | null;
  source_version: number | null;
  tool_labels: string[];
};
type Outgoing = {
  id: string;
  agent_id: string;
  agent_name: string;
  note: string;
  status: "pending" | "accepted" | "declined" | "revoked";
  created_at: string;
  decided_at: string | null;
  source_version: number | null;
  to_email: string;
  to_name: string;
  to_org_name: string;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Waiting", cls: "amber" },
  accepted: { label: "Accepted", cls: "green" },
  declined: { label: "Declined", cls: "grey" },
  revoked: { label: "Withdrawn", cls: "grey" },
};
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return day(iso);
}
const initials = (n: string) => n.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";

export default function SharesManager() {
  const router = useRouter();
  const [incoming, setIncoming] = useState<Incoming[]>([]);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [workspace, setWorkspace] = useState("this workspace");
  const [tab, setTab] = useState<"in" | "out">("in");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ text: string; href?: string; link?: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [sharing, setSharing] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "decline" | "withdraw"; id: string; name: string; who: string } | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/shares", { cache: "no-store" });
      if (!res.ok) throw new Error("Shares could not be loaded.");
      const j = await res.json();
      setIncoming(j.incoming ?? []);
      setOutgoing(j.outgoing ?? []);
      if (j.workspace) setWorkspace(j.workspace);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const waitingIn = incoming.filter((s) => s.status === "pending");
  const decidedIn = incoming.filter((s) => s.status !== "pending");
  const waitingOut = outgoing.filter((s) => s.status === "pending");
  // Start on what is sent when nothing is waiting here but sends exist.
  useEffect(() => {
    if (!loading && !waitingIn.length && !decidedIn.length && outgoing.length) setTab("out");
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  async function accept(s: Incoming) {
    setBusy(s.id);
    setError("");
    try {
      const res = await fetch(`/api/shares/${s.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "That could not be completed.");
      setNotice({ text: `“${s.agent_name}” is now a draft in ${workspace}. Give it your own connections before publishing.`, href: j.agentId ? `/agents/${j.agentId}` : undefined, link: "Open the agent" });
      await load();
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  const stats = [
    { key: "in", label: "Waiting for you", value: waitingIn.length, tone: waitingIn.length ? "warn" : "" },
    { key: "in", label: "Accepted by you", value: incoming.filter((s) => s.status === "accepted").length, tone: "ok" },
    { key: "out", label: "You sent · waiting", value: waitingOut.length },
    { key: "out", label: "You sent · accepted", value: outgoing.filter((s) => s.status === "accepted").length, tone: "ok" },
  ];

  return (
    <div className="page sh">
      <header className="page-head">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Shares</h1>
          <p className="sub" style={{ maxWidth: 820 }}>
            Send an agent to someone in another workspace, or accept one sent to you. An accepted agent arrives as a draft copy — its connections and skills stay behind, so it can never reach the sender&apos;s systems.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setSharing(true)}><ShareIcon size={14} /> Share an agent</button>
      </header>

      {notice && (
        <div className="sh-notice">
          <CheckIcon size={13} /> <span className="grow">{notice.text}</span>
          {notice.href && <Link href={notice.href} className="btn btn-sm">{notice.link}</Link>}
          <button className="sh-x" onClick={() => setNotice(null)} aria-label="Dismiss"><CrossIcon size={11} /></button>
        </div>
      )}
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="al-summary" role="group" aria-label="Shares summary">
        {stats.map((s) => (
          <button key={s.label} className={`al-stat ${s.tone}`} onClick={() => setTab(s.key as "in" | "out")}>
            <span className="v">{s.value}</span>
            <span className="l">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="sh-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "in"} className={tab === "in" ? "on" : ""} onClick={() => setTab("in")}>
          Received {waitingIn.length > 0 ? <span className="warn">{waitingIn.length}</span> : <span>{incoming.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === "out"} className={tab === "out" ? "on" : ""} onClick={() => setTab("out")}>
          Sent <span>{outgoing.length}</span>
        </button>
      </div>

      {loading ? (
        <div className="sh-skel"><span /><span /></div>
      ) : tab === "in" ? (
        <>
          {!incoming.length && (
            <div className="sh-empty">
              <span className="sh-empty-ic"><ShareIcon size={20} /></span>
              <h3>Nothing has been shared with you</h3>
              <p>When someone in another workspace sends you an agent, it waits here until you accept or decline it. Nothing is added before that.</p>
            </div>
          )}

          {waitingIn.length > 0 && (
            <div className="sh-cards">
              {waitingIn.map((s) => {
                const steps = s.spec?.steps?.length ?? 0;
                const trig = s.spec?.trigger?.type === "schedule" ? "Runs on a schedule" : s.spec?.trigger?.type === "event" ? "Runs on an event" : "Run by hand";
                return (
                  <section key={s.id} className="sh-card">
                    <div className="sh-from">
                      <span className="sh-avatar">{initials(s.from_user_name)}</span>
                      <span className="grow">
                        <span className="sh-from-line"><b>{s.from_user_name}</b> sent you an agent</span>
                        <span>{s.from_org_name} · {ago(s.created_at)}</span>
                      </span>
                    </div>
                    <h2>{s.agent_name}</h2>
                    <p className="sh-purpose">{s.spec?.purpose || <span className="dim">No description given.</span>}</p>
                    {s.note && <blockquote className="sh-note">“{s.note}”</blockquote>}

                    <dl className="sh-facts">
                      <div><dt>Version</dt><dd>{s.source_version ? `Published v${s.source_version}` : "Draft (never published)"}</dd></div>
                      <div><dt>Steps</dt><dd>{steps}</dd></div>
                      <div><dt>Runs</dt><dd>{trig}</dd></div>
                      <div className="wide"><dt>Actions</dt><dd>{s.tool_labels?.length ? s.tool_labels.join(", ") : "None — it only writes answers"}</dd></div>
                    </dl>

                    <div className="sh-what">
                      <b>If you accept</b>
                      <ul>
                        <li>A draft copy is added to <b>{workspace}</b>, owned by you.</li>
                        <li>Its connections and skills are not included — you give it your own.</li>
                        <li>It does nothing until you publish it.</li>
                      </ul>
                    </div>

                    <div className="sh-go">
                      <button className="btn" onClick={() => setConfirm({ kind: "decline", id: s.id, name: s.agent_name, who: s.from_user_name })} disabled={busy === s.id}>Decline</button>
                      <button className="btn btn-primary" onClick={() => accept(s)} disabled={busy === s.id}>
                        {busy === s.id ? "Adding…" : <><CheckIcon size={13} /> Accept into {workspace}</>}
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {decidedIn.length > 0 && (
            <>
              <h3 className="sh-section">Earlier</h3>
              <div className="al-table sh-table-in" role="table">
                <div className="al-row al-head" role="row">
                  <div>Agent</div><div>From</div><div>Outcome</div><div>Decided</div><div />
                </div>
                {decidedIn.map((s) => (
                  <div key={s.id} className="al-row" role="row" style={{ cursor: "default" }}>
                    <div className="al-main"><span className="al-name" style={{ cursor: "default" }}>{s.agent_name}</span><div className="al-desc">{s.spec?.purpose || ""}</div></div>
                    <div className="al-small">{s.from_user_name}<div className="dim">{s.from_org_name}</div></div>
                    <div><span className={`pill ${STATUS[s.status]?.cls}`}>{s.status === "revoked" ? "Withdrawn by sender" : STATUS[s.status]?.label}</span></div>
                    <div className="al-small">{day(s.decided_at)}</div>
                    <div className="al-actions">
                      {s.status === "accepted" && s.accepted_agent_id && <Link href={`/agents/${s.accepted_agent_id}`} className="btn sm al-run">Open agent</Link>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : !outgoing.length ? (
        <div className="sh-empty">
          <span className="sh-empty-ic"><ShareIcon size={20} /></span>
          <h3>You haven&apos;t shared anything</h3>
          <p>Send one of this workspace&apos;s agents to someone in another workspace. They get a draft copy to review; nothing of yours is connected to it.</p>
          <button className="btn btn-primary" onClick={() => setSharing(true)}><ShareIcon size={14} /> Share an agent</button>
        </div>
      ) : (
        <div className="al-table sh-table-out" role="table">
          <div className="al-row al-head" role="row">
            <div>Agent</div><div>Sent to</div><div>Sent</div><div>Status</div><div />
          </div>
          {outgoing.map((s) => (
            <div key={s.id} className="al-row" role="row" style={{ cursor: "default" }}>
              <div className="al-main">
                <Link href={`/agents/${s.agent_id}`} className="al-name">{s.agent_name}</Link>
                <div className="al-desc">{s.source_version ? `Published v${s.source_version}` : "Draft"}{s.note ? ` · “${s.note}”` : ""}</div>
              </div>
              <div className="sh-to">
                <span className="sh-avatar sm">{initials(s.to_name)}</span>
                <span className="grow"><b>{s.to_name}</b><span>{s.to_email} · {s.to_org_name}</span></span>
              </div>
              <div className="al-small">{ago(s.created_at)}</div>
              <div>
                <span className={`pill ${STATUS[s.status]?.cls}`}>{STATUS[s.status]?.label}</span>
                {s.decided_at && s.status !== "pending" && <div className="al-small dim">{day(s.decided_at)}</div>}
              </div>
              <div className="al-actions">
                {s.status === "pending" && (
                  <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setConfirm({ kind: "withdraw", id: s.id, name: s.agent_name, who: s.to_name })}>Withdraw</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {sharing && (
        <ShareDialog
          onClose={() => setSharing(false)}
          onSent={(msg) => {
            setSharing(false);
            setNotice({ text: msg });
            setTab("out");
            load();
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "decline" ? `Decline “${confirm.name}”?` : `Withdraw “${confirm.name}”?`}
          body={confirm.kind === "decline" ? `${confirm.who} is told you declined. Nothing is added to your workspace.` : `${confirm.who} can no longer accept it. You can share it again later.`}
          action={confirm.kind === "decline" ? "Decline" : "Withdraw"}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const res =
              confirm.kind === "decline"
                ? await fetch(`/api/shares/${confirm.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "decline" }) })
                : await fetch(`/api/shares/${confirm.id}`, { method: "DELETE" });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(j.error || "That could not be completed.");
            setNotice({ text: confirm.kind === "decline" ? `Declined “${confirm.name}”.` : `Withdrew “${confirm.name}”.` });
            setConfirm(null);
            await load();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function useEscape(onClose: () => void, busy: boolean) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose, busy]);
}

function ShareDialog({ onClose, onSent }: { onClose: () => void; onSent: (msg: string) => void }) {
  const [agents, setAgents] = useState<{ id: string; name: string; status: string; published_ver: number | null }[] | null>(null);
  const [agentId, setAgentId] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEscape(onClose, busy);

  useEffect(() => {
    fetch("/api/agents/list?status=all&sort=name&pageSize=100&meta=0", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setAgents((j.agents ?? []).filter((a: any) => a.status !== "retired")))
      .catch(() => setAgents([]));
  }, []);
  const chosen = useMemo(() => agents?.find((a) => a.id === agentId), [agents, agentId]);

  async function send() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId, email, note }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The agent could not be shared.");
      onSent(`Sent “${chosen?.name}” to ${j.to.name} at ${j.to.org}. It waits there until they accept it.`);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onMouseDown={() => !busy && onClose()}>
      <div className="panel modal sh-dialog" role="dialog" aria-modal="true" aria-labelledby="sh-share-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="eyebrow">Share an agent</div>
        <h2 id="sh-share-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>Send an agent to another workspace</h2>
        <p className="help" style={{ marginTop: 0 }}>
          They must already have an Agent Studio account. They receive a snapshot as a draft to review — later changes here don&apos;t reach them.
        </p>
        <label className="field" style={{ marginTop: 10 }}>
          <span className="eyebrow">Agent</span>
          <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={!agents}>
            <option value="">{agents === null ? "Loading agents…" : "Choose an agent…"}</option>
            {(agents ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.status === "published" && a.published_ver ? ` — v${a.published_ver}` : " — draft"}</option>
            ))}
          </select>
          {chosen && (
            <span className="sh-hint">{chosen.status === "published" && chosen.published_ver ? `The published version (v${chosen.published_ver}) is sent, not the draft.` : "It has never been published, so the current draft is sent."}</span>
          )}
        </label>
        <label className="field" style={{ marginTop: 10 }}>
          <span className="eyebrow">Their email address</span>
          <input className="input" type="email" value={email} placeholder="colleague@company.com" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field" style={{ marginTop: 10 }}>
          <span className="eyebrow">Note <em className="sh-opt">— optional</em></span>
          <textarea className="textarea" rows={2} maxLength={500} value={note} placeholder="Why you are sending it" onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="sh-dialog-info">
          <AlertIcon size={13} />
          <span>Connections, credentials and skills are never sent. The recipient gives the copy their own before it can run.</span>
        </div>
        {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
        <div className="panel-foot">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={send} disabled={busy || !agentId || !email.trim()}>{busy ? "Sending…" : "Send"}</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, body, action, onClose, onConfirm }: { title: string; body: string; action: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEscape(onClose, busy);
  return (
    <div className="modal-back" onMouseDown={() => !busy && onClose()}>
      <div className="panel modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="eyebrow">Shares</div>
        <h2 style={{ margin: "2px 0 8px", fontSize: 17 }}>{title}</h2>
        <p className="help" style={{ marginTop: 0 }}>{body}</p>
        {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
        <div className="panel-foot">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="btn btn-danger-solid"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                await onConfirm();
              } catch (e: any) {
                setErr(e.message);
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : action}
          </button>
        </div>
      </div>
    </div>
  );
}
