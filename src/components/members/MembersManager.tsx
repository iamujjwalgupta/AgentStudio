"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CopyIcon, CrossIcon, MoreIcon, TrashIcon } from "@/components/agent-ui";

type Member = { id: string; email: string; name: string; role: string; created_at: string; is_owner: boolean };
type Invite = { id: string; email: string; role: string; invited_by_name: string; created_at: string; expires_at: string; expired?: boolean };
type Viewer = { id: string; isOwner: boolean; role: string };

const ROLES: { id: string; label: string; blurb: string }[] = [
  { id: "admin", label: "Admin", blurb: "Builds and publishes agents, manages skills and limits, and invites people." },
  { id: "builder", label: "Builder", blurb: "Builds, tests and runs agents. Cannot publish them." },
  { id: "approver", label: "Approver", blurb: "Decides the actions agents hold for approval. Can also build and run agents." },
];
const roleLabel = (r: string) => ROLES.find((x) => x.id === r)?.label ?? r;

/** What each role may do, as the server enforces it (lib/auth, lib/approvals). */
const CAPS: { label: string; owner: boolean; admin: boolean; builder: boolean; approver: boolean }[] = [
  { label: "Build, test and run agents", owner: true, admin: true, builder: true, approver: true },
  { label: "Publish agents and restore retired ones", owner: true, admin: true, builder: false, approver: false },
  { label: "Edit skills and approve skill downloads", owner: true, admin: true, builder: false, approver: false },
  { label: "Set usage limits", owner: true, admin: true, builder: false, approver: false },
  { label: "Decide actions agents hold for approval", owner: true, admin: false, builder: false, approver: true },
  { label: "Invite people and withdraw invitations", owner: true, admin: true, builder: false, approver: false },
  { label: "Change roles and remove members", owner: true, admin: false, builder: false, approver: false },
];

const initials = (n: string) => n.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
const COLOURS = ["#00338d", "#0091da", "#6d2077", "#007a78", "#1e49e2", "#b36b00"];
const colourOf = (k: string) => COLOURS[[...k].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % COLOURS.length];
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
function daysLeft(iso: string) {
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5);
  return d <= 0 ? "Expired" : d === 1 ? "Expires tomorrow" : `Expires in ${d} days`;
}

export default function MembersManager() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [inviteDays, setInviteDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [term, setTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [withdrawing, setWithdrawing] = useState<Invite | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/members", { cache: "no-store" });
      if (!res.ok) throw new Error("Members could not be loaded.");
      const j = await res.json();
      setMembers(j.members ?? []);
      setInvites(j.invitations ?? []);
      setCanManage(Boolean(j.canManageMembers));
      setViewer(j.viewer ?? null);
      if (j.inviteDays) setInviteDays(j.inviteDays);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);

  const isOwner = !!viewer?.isOwner;
  const counts = useMemo(() => {
    const c: Record<string, number> = { admin: 0, builder: 0, approver: 0 };
    for (const m of members) if (!m.is_owner) c[m.role] = (c[m.role] ?? 0) + 1;
    return c;
  }, [members]);
  const shown = members.filter((m) => {
    if (roleFilter === "owner" ? !m.is_owner : roleFilter && (m.is_owner || m.role !== roleFilter)) return false;
    const n = term.trim().toLowerCase();
    return !n || m.name.toLowerCase().includes(n) || m.email.toLowerCase().includes(n);
  });
  const liveInvites = invites.filter((i) => !i.expired && new Date(i.expires_at).getTime() > Date.now());

  async function changeRole(m: Member, next: string) {
    setBusy(m.id);
    setError("");
    try {
      const res = await fetch(`/api/members/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: next }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The role could not be changed.");
      setNotice(`${m.name} is now ${roleLabel(next).toLowerCase() === "admin" ? "an admin" : `a ${roleLabel(next).toLowerCase()}`}.`);
      await load();
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  const stats = [
    { key: "", label: "Members", value: members.length },
    { key: "admin", label: "Admins", value: counts.admin },
    { key: "builder", label: "Builders", value: counts.builder },
    { key: "approver", label: "Approvers", value: counts.approver, tone: counts.approver ? "" : "warn", hint: counts.approver ? undefined : "nobody but the owner can decide approvals" },
  ];

  return (
    <div className="page mb">
      <header className="page-head">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Members</h1>
          <p className="sub" style={{ maxWidth: 780 }}>
            Who can use this workspace and what they may do in it. Joining adds access — people keep their own workspace, and nothing of theirs moves.
          </p>
        </div>
        {canManage && <button className="btn btn-primary" onClick={() => setInviting(true)}>+ Invite people</button>}
      </header>

      {notice && (
        <div className="mb-notice">
          <CheckIcon size={13} /> <span className="grow">{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Dismiss"><CrossIcon size={11} /></button>
        </div>
      )}
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="al-summary" role="group" aria-label="Members summary">
        {stats.map((s) => (
          <button key={s.label} className={`al-stat ${s.tone ?? ""} ${roleFilter === s.key && (s.key || !roleFilter) ? "on" : ""}`} onClick={() => setRoleFilter(roleFilter === s.key ? "" : s.key)}>
            <span className="v">{s.value}</span>
            <span className="l">{s.label}{s.hint ? ` · ${s.hint}` : ""}</span>
          </button>
        ))}
        {canManage && (
          <button className={`al-stat ${liveInvites.length ? "warn" : ""}`} onClick={() => document.getElementById("mb-invites")?.scrollIntoView({ behavior: "smooth" })}>
            <span className="v">{liveInvites.length}</span>
            <span className="l">Invitations waiting</span>
          </button>
        )}
      </div>

      <div className="mb-layout">
        <div className="mb-main">
          <div className="al-toolbar">
            <div className="al-toolbar-row">
              <input className="input search al-search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name or email" aria-label="Search members" />
              <div className="chips">
                {[{ id: "", label: "Everyone" }, { id: "owner", label: "Owner" }, ...ROLES].map((r) => (
                  <button key={r.id || "all"} className={`chip ${roleFilter === r.id ? "on" : ""}`} onClick={() => setRoleFilter(r.id)}>{r.label}</button>
                ))}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="mb-skel"><span /><span /><span /></div>
          ) : !shown.length ? (
            <div className="empty"><h3>Nobody matches</h3><p>Try another name, or show everyone.</p></div>
          ) : (
            <div className="al-table mb-table" role="table">
              <div className="al-row al-head" role="row">
                <div>Member</div>
                <div>Role</div>
                <div>Joined</div>
                <div />
              </div>
              {shown.map((m) => {
                const you = m.id === viewer?.id;
                const editable = isOwner && !m.is_owner;
                return (
                  <div key={m.id} className="al-row" role="row" style={{ cursor: "default" }}>
                    <div className="mb-person">
                      <span className="mb-avatar" style={{ background: colourOf(m.email) }}>{initials(m.name || m.email)}</span>
                      <div className="al-main">
                        <span className="al-name" style={{ cursor: "default" }}>
                          {m.name}
                          {you && <span className="mb-tag you">You</span>}
                        </span>
                        <div className="al-desc">{m.email}</div>
                      </div>
                    </div>
                    <div>
                      {m.is_owner ? (
                        <span className="mb-role owner" title="Created the workspace. Can do everything, including changing roles.">Owner</span>
                      ) : editable ? (
                        <select className="select-sm mb-role-select" value={m.role} disabled={busy === m.id} onChange={(e) => changeRole(m, e.target.value)} aria-label={`Role of ${m.name}`}>
                          {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                        </select>
                      ) : (
                        <span className={`mb-role ${m.role}`} title={ROLES.find((r) => r.id === m.role)?.blurb}>{roleLabel(m.role)}</span>
                      )}
                    </div>
                    <div className="al-small">{day(m.created_at)}</div>
                    <div className="al-actions">
                      {editable && (
                        <div className="al-menu-wrap">
                          <button className="icon-act" aria-label={`More for ${m.name}`} title="More" onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id); }}>
                            <MoreIcon />
                          </button>
                          {menuFor === m.id && (
                            <div className="al-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                              <button role="menuitem" className="danger" onClick={() => { setMenuFor(null); setRemoving(m); }}>
                                <TrashIcon /> Remove from workspace…
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!isOwner && canManage && <p className="mb-foot">Only the workspace owner can change roles or remove people.</p>}

          {canManage && (
            <section id="mb-invites" className="mb-invites">
              <div className="mb-sec-head">
                <h2>Invitations</h2>
                <span className="dim">Nobody is added until they accept. Links expire after {inviteDays} days.</span>
              </div>
              {!invites.length ? (
                <div className="mb-empty-invites">
                  No invitations waiting. <button className="link-btn" onClick={() => setInviting(true)}>Invite someone</button>
                </div>
              ) : (
                <div className="al-table mb-inv-table" role="table">
                  {invites.map((i) => {
                    const expired = i.expired || new Date(i.expires_at).getTime() <= Date.now();
                    return (
                      <div key={i.id} className="al-row" role="row" style={{ cursor: "default" }}>
                        <div className="mb-person">
                          <span className="mb-avatar pending">{initials(i.email)}</span>
                          <div className="al-main">
                            <span className="al-name" style={{ cursor: "default" }}>{i.email}</span>
                            <div className="al-desc">Invited by {i.invited_by_name} · {day(i.created_at)}</div>
                          </div>
                        </div>
                        <div><span className={`mb-role ${i.role}`}>{roleLabel(i.role)}</span></div>
                        <div className={`al-small ${expired ? "mb-expired" : ""}`}>{daysLeft(i.expires_at)}</div>
                        <div className="al-actions">
                          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setWithdrawing(i)}>{expired ? "Remove" : "Withdraw"}</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="mb-side">
          <section className="mb-card">
            <h2>What each role can do</h2>
            <table className="mb-caps">
              <thead>
                <tr><th /><th title="Owner">Owner</th><th title="Admin">Admin</th><th title="Builder">Builder</th><th title="Approver">Approver</th></tr>
              </thead>
              <tbody>
                {CAPS.map((c) => (
                  <tr key={c.label}>
                    <td>{c.label}</td>
                    {(["owner", "admin", "builder", "approver"] as const).map((k) => (
                      <td key={k} className={c[k] ? "yes" : "no"}>{c[k] ? <CheckIcon size={12} /> : "–"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mb-small">The person who runs an agent cannot approve its actions when someone else can — held actions need a second pair of eyes.</p>
          </section>
        </aside>
      </div>

      {inviting && (
        <InviteDialog
          inviteDays={inviteDays}
          onClose={() => setInviting(false)}
          onDone={() => load()}
        />
      )}

      {removing && (
        <Confirm
          kicker="Remove member"
          title={`Remove ${removing.name}?`}
          body={<>They lose access to this workspace straight away. Their own workspace, and anything they built there, is not affected. Agents they built here stay here.</>}
          action="Remove"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const res = await fetch(`/api/members/${removing.id}`, { method: "DELETE" });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(j.error || "That member could not be removed.");
            setNotice(`Removed ${removing.name} from the workspace.`);
            setRemoving(null);
            await load();
            router.refresh();
          }}
        />
      )}

      {withdrawing && (
        <Confirm
          kicker="Invitation"
          title={`Withdraw the invitation to ${withdrawing.email}?`}
          body={<>Their link stops working. You can invite them again at any time.</>}
          action="Withdraw"
          onClose={() => setWithdrawing(null)}
          onConfirm={async () => {
            const res = await fetch(`/api/invitations/${withdrawing.id}`, { method: "DELETE" });
            if (!res.ok) {
              const j = await res.json().catch(() => ({}));
              throw new Error(j.error || "The invitation could not be withdrawn.");
            }
            setNotice(`Withdrew the invitation to ${withdrawing.email}.`);
            setWithdrawing(null);
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

function InviteDialog({ inviteDays, onClose, onDone }: { inviteDays: number; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("builder");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState<{ email: string; link: string; hasAccount: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  useEscape(onClose, busy);

  async function send() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The invitation could not be created.");
      setSent({ email: email.trim().toLowerCase(), link: window.location.origin + j.link, hasAccount: !!j.hasAccount });
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onMouseDown={() => !busy && onClose()}>
      <div className="panel modal mb-invite" role="dialog" aria-modal="true" aria-labelledby="mb-inv-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="eyebrow">Invite people</div>
        {!sent ? (
          <>
            <h2 id="mb-inv-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>Who would you like to invite?</h2>
            <p className="help" style={{ marginTop: 0 }}>They can already have an account or not — either works. Nobody is added until they accept.</p>
            <label className="field" style={{ marginTop: 10 }}>
              <span className="eyebrow">Email address</span>
              <input className="input" type="email" autoFocus value={email} placeholder="colleague@company.com" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && email.trim() && !busy && send()} />
            </label>
            <div className="field" style={{ marginTop: 12 }}>
              <span className="eyebrow">Role</span>
              <div className="mb-role-pick" role="radiogroup">
                {ROLES.map((r) => (
                  <button key={r.id} type="button" role="radio" aria-checked={role === r.id} className={role === r.id ? "on" : ""} onClick={() => setRole(r.id)}>
                    <span className="mb-radio" />
                    <span className="grow"><b>{r.label}</b><span>{r.blurb}</span></span>
                  </button>
                ))}
              </div>
            </div>
            {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
            <div className="panel-foot">
              <span className="dim" style={{ fontSize: 12, alignSelf: "center" }}>The link expires after {inviteDays} days.</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                <button className="btn btn-primary" onClick={send} disabled={busy || !email.trim()}>{busy ? "Creating…" : "Create invitation"}</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <h2 id="mb-inv-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>Invitation created for {sent.email}</h2>
            <p className="help" style={{ marginTop: 0 }}>
              {sent.hasAccount
                ? "They already have an account, so they will see the invitation when they next sign in. You can also send them this link."
                : "They have no account yet. Send them this link — it takes them through sign-up straight into this workspace."}{" "}
              If the workspace has an email connection, the link has also been emailed to them.
            </p>
            <div className="mb-link">
              <code>{sent.link}</code>
              <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(sent.link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); })}>
                {copied ? <><CheckIcon size={12} /> Copied</> : <><CopyIcon size={12} /> Copy link</>}
              </button>
            </div>
            <div className="panel-foot">
              <button className="btn" onClick={() => { setSent(null); setEmail(""); }}>Invite someone else</button>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Confirm({ kicker, title, body, action, onClose, onConfirm }: { kicker: string; title: string; body: React.ReactNode; action: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEscape(onClose, busy);
  return (
    <div className="modal-back" onMouseDown={() => !busy && onClose()}>
      <div className="panel modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="eyebrow">{kicker}</div>
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
