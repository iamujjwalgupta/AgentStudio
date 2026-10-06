"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Membership } from "@/lib/auth";

const roleText = (m: Membership) => (m.isOwner ? "Owner" : m.role ? m.role[0].toUpperCase() + m.role.slice(1) : "Member");

/**
 * The workspace you are looking at, and your role in it. With more than one
 * workspace the block becomes a switcher; the select sits invisibly over the
 * card so the whole card is the control and keyboard access is the browser's own.
 */
export default function WorkspaceSwitcher({ memberships, activeOrgId }: { memberships: Membership[]; activeOrgId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const active = memberships.find((m) => m.orgId === activeOrgId) ?? memberships[0];
  if (!active) return null;
  const many = memberships.length > 1;

  async function switchTo(orgId: string) {
    if (orgId === activeOrgId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId }) });
      if (res.ok) {
        router.push("/agents");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`ws-switch rl-ws${many ? " many" : ""}${busy ? " busy" : ""}`} title={many ? "Switch workspace" : active.orgName}>
      <span className="rl-ws-mark" aria-hidden="true">{active.orgName.trim()[0]?.toUpperCase() || "W"}</span>
      <span className="rl-ws-text">
        <b>{active.orgName}</b>
        <span>{busy ? "Switching…" : `${roleText(active)}${many ? ` · ${memberships.length} workspaces` : ""}`}</span>
      </span>
      {many && (
        <>
          <svg className="rl-ws-chev" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 6l3-3 3 3M5 10l3 3 3-3" />
          </svg>
          <select className="rl-ws-select" value={activeOrgId} disabled={busy} onChange={(e) => switchTo(e.target.value)} aria-label="Switch workspace">
            {memberships.map((m) => (
              <option key={m.orgId} value={m.orgId}>
                {m.orgName} — {roleText(m)}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
