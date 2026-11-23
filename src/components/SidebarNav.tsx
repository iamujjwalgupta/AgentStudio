"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NavIcon from "./NavIcon";

type Item = { href: string; label: string; icon: string; badge?: number; live?: number; hint?: string; also?: string[] };
type Group = { title: string; items: Item[] };

/** Sent by the guided tour so the Admin section is open while the tour walks through it. */
export const OPEN_ADMIN_EVENT = "agent-studio:open-admin";
const ADMIN_KEY = "as_rail_admin";

/**
 * The rail's links: Finance first (Finance Personas, Value Stream), then the
 * studio (Agents, Apps), then everything else under an expandable Admin section.
 * Admin is a grouping, not a permission: each link inside keeps its own rules
 * (Members and API keys are listed only for people who can manage the
 * workspace). The page you are on is marked; counts show what is waiting
 * (approvals, shares) and a pulse shows runs in progress. While Admin is closed,
 * its header carries those counts so nothing waiting is hidden. Each link keeps
 * its data-tour hook for the guided demo.
 */
export default function SidebarNav({
  approvals,
  shares,
  running,
  showMembers,
}: {
  approvals: number;
  shares: number;
  running: number;
  showMembers: boolean;
}) {
  const path = usePathname() || "";
  const groups: Group[] = [
    {
      title: "Finance",
      items: [
        { href: "/finance/personas", label: "Finance Personas", icon: "personas" },
        { href: "/finance/value-stream", label: "Value Stream", icon: "stream", also: ["/finance/challenges"] },
      ],
    },
    {
      title: "Studio",
      items: [
        { href: "/agents", label: "Agents", icon: "agents" },
        { href: "/apps", label: "Apps", icon: "apps" },
      ],
    },
  ];
  const admin: Item[] = [
    { href: "/skills", label: "Skills", icon: "skills" },
    { href: "/connections", label: "Connections", icon: "connections" },
    { href: "/sandbox", label: "Sandbox", icon: "sandbox" },
    { href: "/approvals", label: "Approvals", icon: "approvals", badge: approvals, hint: approvals ? `${approvals} waiting for a decision` : undefined },
    { href: "/runs", label: "Runs", icon: "runs", live: running, hint: running ? `${running} running now` : undefined },
    { href: "/usage", label: "Usage & limits", icon: "spend", also: ["/spend"] },
    { href: "/audit", label: "Audit trail", icon: "audit" },
    ...(showMembers ? [{ href: "/members", label: "Members", icon: "members" }] : []),
    ...(showMembers ? [{ href: "/api-keys", label: "API keys", icon: "key", hint: "Let other applications call your agents" }] : []),
    { href: "/shares", label: "Shares", icon: "shares", badge: shares, hint: shares ? `${shares} shared with you` : undefined },
  ];

  const under = (href: string) => path === href || path.startsWith(`${href}/`);
  const isActive = (it: Item) => under(it.href) || (it.also || []).some(under);
  const inAdmin = admin.some(isActive);

  // Open when you are on one of its pages; otherwise as you last left it.
  const [open, setOpen] = useState(inAdmin);
  useEffect(() => {
    if (inAdmin) {
      setOpen(true);
      return;
    }
    try {
      setOpen(localStorage.getItem(ADMIN_KEY) === "open");
    } catch {
      /* storage unavailable: keep the default */
    }
  }, [inAdmin]);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_ADMIN_EVENT, show);
    return () => window.removeEventListener(OPEN_ADMIN_EVENT, show);
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(ADMIN_KEY, next ? "open" : "closed");
    } catch {
      /* not remembered; still toggles */
    }
  };

  const waiting = approvals + shares;
  const waitingHint = [
    approvals ? `${approvals} waiting for a decision` : "",
    shares ? `${shares} shared with you` : "",
    running ? `${running} running now` : "",
  ].filter(Boolean).join(" · ");

  const link = (it: Item) => {
    const on = isActive(it);
    return (
      <Link
        key={it.href}
        href={it.href}
        className={`nav-item${on ? " active" : ""}`}
        aria-current={on ? "page" : undefined}
        data-tour={it.href.slice(1).replace(/^finance\//, "")}
        title={it.hint ? `${it.label} — ${it.hint}` : it.label}
      >
        <span className="nav-ico"><NavIcon name={it.icon} /></span>
        <span className="nav-label">{it.label}</span>
        {it.badge ? <span className="nav-badge">{it.badge}</span> : it.live ? <span className="rl-live" aria-label={`${it.live} running`} /> : null}
      </Link>
    );
  };

  return (
    <nav className="nav rl-nav" aria-label="Main">
      {groups.map((g) => (
        <div key={g.title} className="rl-group" role="group" aria-label={g.title}>
          <div className="eyebrow nav-head bare">{g.title}</div>
          {g.items.map(link)}
        </div>
      ))}

      <div className={`rl-group rl-admin${open ? " open" : ""}`} role="group" aria-label="Admin">
        <button
          type="button"
          className={`nav-item rl-admin-toggle${inAdmin && !open ? " active" : ""}`}
          aria-expanded={open}
          aria-controls="rl-admin-items"
          onClick={toggle}
          data-tour="admin"
          title={open ? "Hide the admin pages" : `Show the admin pages${waitingHint ? ` — ${waitingHint}` : ""}`}
        >
          <span className="nav-ico"><NavIcon name="admin" /></span>
          <span className="nav-label">Admin</span>
          {!open && (waiting ? <span className="nav-badge">{waiting}</span> : running ? <span className="rl-live" aria-label={`${running} running`} /> : null)}
          <span className="rl-admin-chev" aria-hidden="true"><NavIcon name="chevron" size={14} /></span>
        </button>
        <div id="rl-admin-items" className="rl-admin-items" hidden={!open}>
          {admin.map(link)}
        </div>
      </div>
    </nav>
  );
}
