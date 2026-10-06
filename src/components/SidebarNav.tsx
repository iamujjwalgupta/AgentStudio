"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import NavIcon from "./NavIcon";

type Item = { href: string; label: string; icon: string; badge?: number; live?: number; hint?: string };
type Group = { title: string; items: Item[] };

/**
 * The rail's links, grouped by what people come to do. The page you are on is
 * marked; counts show what is waiting (approvals, shares) and a pulse shows runs
 * in progress. Each link keeps its data-tour hook for the guided demo.
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
      title: "Build",
      items: [
        { href: "/agents", label: "Agents", icon: "agents" },
        { href: "/skills", label: "Skills", icon: "skills" },
        { href: "/connections", label: "Connections", icon: "connections" },
        { href: "/sandbox", label: "Sandbox", icon: "sandbox" },
      ],
    },
    {
      title: "Work",
      items: [
        { href: "/apps", label: "Apps", icon: "apps" },
        { href: "/approvals", label: "Approvals", icon: "approvals", badge: approvals, hint: approvals ? `${approvals} waiting for a decision` : undefined },
        { href: "/runs", label: "Runs", icon: "runs", live: running, hint: running ? `${running} running now` : undefined },
      ],
    },
    {
      title: "Oversee",
      items: [
        { href: "/usage", label: "Usage & limits", icon: "spend" },
        { href: "/audit", label: "Audit trail", icon: "audit" },
      ],
    },
    {
      title: "Workspace",
      items: [
        ...(showMembers ? [{ href: "/members", label: "Members", icon: "members" }] : []),
        { href: "/shares", label: "Shares", icon: "shares", badge: shares, hint: shares ? `${shares} shared with you` : undefined },
      ],
    },
  ];
  const isActive = (href: string) => path === href || path.startsWith(`${href}/`) || (href === "/usage" && path === "/spend");

  return (
    <nav className="nav rl-nav" aria-label="Main">
      {groups.map((g) => (
        <div key={g.title} className="rl-group" role="group" aria-label={g.title}>
          <div className="eyebrow nav-head bare">{g.title}</div>
          {g.items.map((it) => {
            const on = isActive(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`nav-item${on ? " active" : ""}`}
                aria-current={on ? "page" : undefined}
                data-tour={it.href.slice(1)}
                title={it.hint ? `${it.label} — ${it.hint}` : it.label}
              >
                <span className="nav-ico"><NavIcon name={it.icon} /></span>
                <span className="nav-label">{it.label}</span>
                {it.badge ? <span className="nav-badge">{it.badge}</span> : it.live ? <span className="rl-live" aria-label={`${it.live} running`} /> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
