"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewAgentButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: null }),
      });
      if (!res.ok) throw new Error(`The agent could not be created (${res.status}).`);
      const { agent } = await res.json();
      router.push(`/agents/${agent.id}`);
      router.refresh();
    } catch (e: any) {
      setError(e.message || "The agent could not be created.");
      setBusy(false);
    }
  }

  return (
    <div className="stack-sm">
      <button className="btn btn-primary" onClick={create} disabled={busy}>
        {busy ? "Creating…" : "New agent"}
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
