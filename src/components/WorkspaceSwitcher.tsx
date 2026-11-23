"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Membership } from "@/lib/auth";

const roleText = (m: Membership) => (m.isOwner ? "Owner" : m.role ? m.role[0].toUpperCase() + m.role.slice(1) : "Member");
const mark = (name: string) => name.trim()[0]?.toUpperCase() || "W";

/**
 * The workspace you are looking at, and your role in it. The card opens a menu
 * of every workspace you belong to, and is where admins start another one.
 */
export default function WorkspaceSwitcher({
  memberships, activeOrgId, canCreate,
}: { memberships: Membership[]; activeOrgId: string; canCreate: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"" | "switch" | "create">("");
  const [err, setErr] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const active = memberships.find((m) => m.orgId === activeOrgId) ?? memberships[0];

  const close = () => {
    setOpen(false);
    setCreating(false);
    setName("");
    setErr(null);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!active) return null;

  async function go(body: object, kind: "switch" | "create") {
    setBusy(kind);
    setErr(null);
    try {
      const res = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error || "Something went wrong. Please try again.");
        return;
      }
      close();
      router.push("/agents");
      router.refresh();
    } catch {
      setErr("Could not reach Agent Studio. Try again.");
    } finally {
      setBusy("");
    }
  }

  const switchTo = (orgId: string) => (orgId === activeOrgId ? close() : go({ orgId }, "switch"));
  const create = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) go({ action: "create", name: name.trim() }, "create");
  };

  return (
    <div className="ws-switch rl-ws-wrap" ref={root}>
      <button
        type="button"
        className={`rl-ws many${busy ? " busy" : ""}${open ? " open" : ""}`}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch or create a workspace"
      >
        <span className="rl-ws-mark" aria-hidden="true">{mark(active.orgName)}</span>
        <span className="rl-ws-text">
          <b>{active.orgName}</b>
          <span>
            {busy === "switch"
              ? "Switching…"
              : `${roleText(active)}${memberships.length > 1 ? ` · ${memberships.length} workspaces` : ""}`}
          </span>
        </span>
        <svg className="rl-ws-chev" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 6l3-3 3 3M5 10l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div className="rl-ws-menu" role="menu" aria-label="Workspaces">
          <div className="rl-ws-menu-head">Your workspaces</div>
          {memberships.map((m) => (
            <button
              key={m.orgId}
              type="button"
              role="menuitemradio"
              aria-checked={m.orgId === activeOrgId}
              className={`rl-ws-item${m.orgId === activeOrgId ? " on" : ""}`}
              disabled={Boolean(busy)}
              onClick={() => switchTo(m.orgId)}
            >
              <span className="rl-ws-mark" aria-hidden="true">{mark(m.orgName)}</span>
              <span className="rl-ws-item-text">
                <b>{m.orgName}</b>
                <span>{roleText(m)}</span>
              </span>
              {m.orgId === activeOrgId && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              )}
            </button>
          ))}

          <div className="rl-ws-sep" />
          {!canCreate ? (
            <p className="rl-ws-note">Only workspace admins can create a workspace.</p>
          ) : creating ? (
            <form className="rl-ws-new" onSubmit={create}>
              <label htmlFor="rl-ws-name">New workspace name</label>
              <input
                id="rl-ws-name"
                autoFocus
                value={name}
                maxLength={80}
                placeholder="e.g. Acme Finance"
                onChange={(e) => setName(e.target.value)}
                disabled={busy === "create"}
              />
              <p>You&apos;ll be its owner and can invite people from Members.</p>
              {err && <div className="rl-ws-err" role="alert">{err}</div>}
              <div className="rl-ws-new-actions">
                <button type="button" className="btn" onClick={() => { setCreating(false); setErr(null); }} disabled={busy === "create"}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy === "create"}>
                  {busy === "create" ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          ) : (
            <>
              {err && <div className="rl-ws-err" role="alert">{err}</div>}
              <button type="button" role="menuitem" className="rl-ws-item rl-ws-add" onClick={() => { setCreating(true); setErr(null); }} disabled={Boolean(busy)}>
                <span className="rl-ws-plus" aria-hidden="true">+</span>
                <span className="rl-ws-item-text"><b>New workspace</b></span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
