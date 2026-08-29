"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Invite = { id: string; role: string; org_name: string; invited_by_name: string };

/** Invitations addressed to the signed-in person, wherever they are in the app. */
export default function InviteBanner() {
  const router = useRouter();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/invitations");
      if (!res.ok) return;
      const j = await res.json();
      setInvites(j.invitations ?? []);
    } catch {
      /* the banner is not worth an error of its own */
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, action: "accept" | "decline") {
    setBusy(id);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (res.ok) {
        await load();
        router.refresh();
      }
    } finally {
      setBusy("");
    }
  }

  if (!invites.length) return null;

  return (
    <div className="invite-bar">
      {invites.map((i) => (
        <div className="invite-row" key={i.id}>
          <div>
            <span className="eyebrow">Invitation</span>
            <div>
              <strong>{i.invited_by_name}</strong> invited you to <strong>{i.org_name}</strong> as {i.role}.
            </div>
          </div>
          <div className="row-actions" style={{ gap: 8 }}>
            <button className="btn" onClick={() => decide(i.id, "decline")} disabled={busy === i.id}>
              Decline
            </button>
            <button className="btn btn-primary" onClick={() => decide(i.id, "accept")} disabled={busy === i.id}>
              {busy === i.id ? "Joining…" : "Join workspace"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
