"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Membership } from "@/lib/auth";

/** Switches which workspace the session is looking at. */
export default function WorkspaceSwitcher({
  memberships,
  activeOrgId,
}: {
  memberships: Membership[];
  activeOrgId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Nothing to switch between.
  if (memberships.length < 2) return null;

  async function switchTo(orgId: string) {
    if (orgId === activeOrgId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (res.ok) {
        router.push("/agents");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="ws-switch">
      <span className="eyebrow">Workspace</span>
      <select
        className="select-sm"
        value={activeOrgId}
        disabled={busy}
        onChange={(e) => switchTo(e.target.value)}
      >
        {memberships.map((m) => (
          <option key={m.orgId} value={m.orgId}>
            {m.orgName}
            {m.isOwner ? " (yours)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
