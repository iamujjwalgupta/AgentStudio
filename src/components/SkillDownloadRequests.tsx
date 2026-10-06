"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Req = {
  id: string;
  skill_id: string | null;
  skill_label: string;
  requested_by_name: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "downloaded" | "expired";
  created_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  expires_at: string | null;
  downloaded_at: string | null;
  skill_status: string | null;
};

const when = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const STATUS: Record<Req["status"], { label: string; cls: string }> = {
  pending: { label: "Waiting", cls: "amber" },
  approved: { label: "Approved · not downloaded yet", cls: "green" },
  downloaded: { label: "Approved · downloaded", cls: "green" },
  rejected: { label: "Rejected", cls: "red" },
  expired: { label: "Approved · expired unused", cls: "grey" },
};

/**
 * The owner's and admins' queue of skill download requests, on the Approvals page.
 * Approving allows one download of the skill as it is now, within seven days.
 */
export default function SkillDownloadRequests({ onCount }: { onCount?: (n: number) => void }) {
  const [pending, setPending] = useState<Req[]>([]);
  const [decided, setDecided] = useState<Req[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [p, d] = await Promise.all([
        fetch("/api/skill-downloads?status=pending", { cache: "no-store" }),
        fetch("/api/skill-downloads?status=decided", { cache: "no-store" }),
      ]);
      const pj = await p.json();
      if (!p.ok) throw new Error(pj.error || "Requests could not be loaded.");
      setPending(pj.requests ?? []);
      onCount?.((pj.requests ?? []).length);
      if (d.ok) setDecided((await d.json()).requests ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(r: Req, decision: "approved" | "rejected") {
    const note = (notes[r.id] ?? "").trim();
    if (decision === "rejected" && !note) {
      setError("Add a note saying why, so the requester knows.");
      return;
    }
    setBusy(r.id);
    setError("");
    try {
      const res = await fetch(`/api/skill-downloads/${r.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The decision could not be saved.");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  if (loading) return <div className="apx-skel"><span /><span /></div>;

  return (
    <div className="apx-dl">
      {error && <div className="error">{error}</div>}

      {pending.length === 0 ? (
        <div className="apx-empty">
          <h3>No download requests waiting</h3>
          <p>
            When someone who is not an admin asks to download a skill as a file, the request waits here. Approving
            allows one download, within seven days, of the skill as it is when you approve.
          </p>
        </div>
      ) : (
        <div className="apx-dl-grid">
          {pending.map((r) => (
            <section className="apx-dl-card" key={r.id}>
              <div className="apx-dl-head">
                <div className="grow">
                  <b>{r.skill_label}</b>
                  <span>
                    Requested by {r.requested_by_name} · {when(r.created_at)}
                    {r.skill_status === "retired" && " · the skill is retired"}
                  </span>
                </div>
                {r.skill_id && <Link href="/skills" className="apx-dl-link">Open Skills</Link>}
              </div>
              <div className="apx-dl-reason">
                <span className="apx-label">Why they need it</span>
                <p>{r.reason}</p>
              </div>
              <label className="apx-label" htmlFor={`dl-${r.id}`}>Note to them <em>— needed to reject</em></label>
              <input
                id={`dl-${r.id}`}
                className="input"
                value={notes[r.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                placeholder="Optional when approving"
              />
              <div className="apx-go">
                <span className="grow dim" style={{ fontSize: 12 }}>One download, within 7 days, of the skill as it is now.</span>
                <button className="btn btn-danger" disabled={busy === r.id} onClick={() => decide(r, "rejected")}>Reject</button>
                <button className="btn btn-primary" disabled={busy === r.id || !r.skill_id} onClick={() => decide(r, "approved")}>
                  {busy === r.id ? "Saving…" : "Approve download"}
                </button>
              </div>
            </section>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <>
          <h3 className="apx-section-title">Decided requests</h3>
          <div className="al-table apx-dl-table" role="table">
            <div className="al-row al-head" role="row">
              <div>Skill</div>
              <div>Requested by</div>
              <div>Outcome</div>
              <div>Decided</div>
              <div>Reason and note</div>
            </div>
            {decided.map((r) => (
              <div key={r.id} className="al-row" role="row" style={{ cursor: "default" }}>
                <div className="al-main"><span className="al-name" style={{ cursor: "default" }}>{r.skill_label}</span></div>
                <div className="al-small">{r.requested_by_name}</div>
                <div><span className={`pill ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></div>
                <div className="al-small">
                  {r.decided_by_name ?? "—"}
                  <div className="dim">{when(r.decided_at)}{r.downloaded_at ? ` · downloaded ${when(r.downloaded_at)}` : ""}</div>
                </div>
                <div className="al-small apx-note-cell" title={`${r.reason}${r.decision_note ? ` — ${r.decision_note}` : ""}`}>
                  {r.reason}
                  {r.decision_note && <div className="dim">Note: {r.decision_note}</div>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
