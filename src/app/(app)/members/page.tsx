"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Member = {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
  is_owner: boolean;
};

type Invite = {
  id: string;
  email: string;
  role: string;
  invited_by_name: string;
  created_at: string;
  expires_at: string;
};

const ROLES = [
  { id: "admin", blurb: "Builds agents, and can invite people." },
  { id: "builder", blurb: "Builds and runs agents." },
  { id: "approver", blurb: "Reviews and decides the actions agents hold for approval." },
];

export default function MembersPage() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invite[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [me, setMe] = useState<{ isOwner: boolean }>({ isOwner: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("builder");
  const [link, setLink] = useState("");
  const [linkNote, setLinkNote] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/members");
      if (!res.ok) throw new Error("Members could not be loaded.");
      const j = await res.json();
      setMembers(j.members ?? []);
      setInvitations(j.invitations ?? []);
      setCanManage(Boolean(j.canManageMembers));
      const owner = (j.members ?? []).find((m: Member) => m.is_owner);
      setMe({ isOwner: Boolean(owner) && j.canManageMembers });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function invite() {
    setBusy("invite");
    setError("");
    setLink("");
    try {
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The invitation could not be sent.");
      setLink(window.location.origin + j.link);
      setLinkNote(
        j.hasAccount
          ? `${email} already has an account. They will see this invitation when they sign in — or you can send them this link.`
          : `${email} has no account yet. Send them this link; it carries them through sign-up straight into this workspace.`,
      );
      setEmail("");
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  async function changeRole(id: string, next: string) {
    setBusy(id);
    setError("");
    try {
      const res = await fetch(`/api/members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The role could not be changed.");
      load();
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  async function remove(m: Member) {
    if (!confirm(`Remove ${m.name} from this workspace? Their own workspace and agents are not affected.`)) return;
    setBusy(m.id);
    setError("");
    try {
      const res = await fetch(`/api/members/${m.id}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "That member could not be removed.");
      load();
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  async function withdraw(inv: Invite) {
    if (!confirm(`Withdraw the invitation to ${inv.email}?`)) return;
    setBusy(inv.id);
    try {
      await fetch(`/api/invitations/${inv.id}`, { method: "DELETE" });
      load();
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Members</h1>
          <p className="sub">
            Who can see this workspace, and what they may do in it. People keep their own workspace when they join
            yours — joining adds access, it never moves anything.
          </p>
        </div>
      </header>

      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

      {canManage && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Invite someone</h2>
          <p className="help">
            They can already have an account or not — either works. Nobody is added until they accept.
          </p>
          <div className="grid2">
            <label className="field">
              <span className="eyebrow">Email address</span>
              <input
                className="input mono"
                type="email"
                value={email}
                placeholder="colleague@example.com"
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && email.trim() && !busy && invite()}
              />
            </label>
            <label className="field">
              <span className="eyebrow">Role</span>
              <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id}
                  </option>
                ))}
              </select>
              <span className="help" style={{ marginTop: 6 }}>{ROLES.find((r) => r.id === role)?.blurb}</span>
            </label>
          </div>

          {link && (
            <div className="ok-note" style={{ marginTop: 4 }}>
              <div>{linkNote}</div>
              <div className="mono" style={{ marginTop: 8, wordBreak: "break-all" }}>{link}</div>
            </div>
          )}

          <div className="panel-foot">
            <span className="sub-line">Invitations expire after 14 days.</span>
            <button className="btn btn-primary" onClick={invite} disabled={busy === "invite" || !email.trim()}>
              {busy === "invite" ? "Creating…" : "Create invitation"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="note">Loading members…</div>
      ) : (
        <>
          <div className="table">
            <div className="tr th" style={{ gridTemplateColumns: "2fr 1.4fr 1fr .8fr" }}>
              <div>Member</div>
              <div>Role</div>
              <div>Joined</div>
              <div />
            </div>
            {members.map((m) => (
              <div className="tr" key={m.id} style={{ gridTemplateColumns: "2fr 1.4fr 1fr .8fr" }}>
                <div>
                  <div className="name">
                    {m.name} {m.is_owner && <span className="tag" style={{ marginLeft: 6 }}>owner</span>}
                  </div>
                  <div className="sub-line mono">{m.email}</div>
                </div>
                <div>
                  {me.isOwner && !m.is_owner ? (
                    <select
                      className="select-sm"
                      value={m.role}
                      disabled={busy === m.id}
                      onChange={(e) => changeRole(m.id, e.target.value)}
                    >
                      {ROLES.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="tag tag-neutral">{m.role}</span>
                  )}
                </div>
                <div className="mono dim">{new Date(m.created_at).toLocaleDateString()}</div>
                <div style={{ textAlign: "right" }}>
                  {me.isOwner && !m.is_owner && (
                    <button className="btn btn-ghost btn-danger" onClick={() => remove(m)} disabled={busy === m.id}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {canManage && invitations.length > 0 && (
            <>
              <div className="list-head" style={{ marginTop: 22 }}>
                <span className="count">{invitations.length} waiting to be accepted</span>
              </div>
              <div className="table">
                {invitations.map((i) => (
                  <div className="tr" key={i.id} style={{ gridTemplateColumns: "2fr 1.4fr 1fr .8fr" }}>
                    <div>
                      <div className="name mono">{i.email}</div>
                      <div className="sub-line">invited by {i.invited_by_name}</div>
                    </div>
                    <div><span className="tag tag-neutral">{i.role}</span></div>
                    <div className="mono dim">expires {new Date(i.expires_at).toLocaleDateString()}</div>
                    <div style={{ textAlign: "right" }}>
                      <button className="btn btn-ghost btn-danger" onClick={() => withdraw(i)} disabled={busy === i.id}>
                        Withdraw
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
