"use client";

import { useEffect, useState } from "react";

type Change = {
  section: string;
  label: string;
  before?: string;
  after?: string;
  kind: "added" | "removed" | "changed";
  severity: "weakens" | "strengthens" | "neutral";
};

type Diff = {
  from: string;
  to: string;
  changes: Change[];
  weakens: number;
  strengthens: number;
  neutral: number;
  identical: boolean;
  error?: string;
  unavailable?: boolean;
};

/** Renders an already-computed diff. Used directly where the spec is in memory. */
export function DiffView({
  diff,
  title,
}: {
  diff: Pick<Diff, "changes" | "weakens" | "identical" | "from" | "to">;
  title?: string;
}) {
  if (diff.identical) {
    return (
      <div className="note mt">
        No difference between {diff.from} and {diff.to}.
      </div>
    );
  }
  return (
    <div className="mt">
      <div className="eyebrow">{title || `What changes from ${diff.from} to ${diff.to}`}</div>

      {diff.weakens > 0 && (
        <div className="diff-warn">
          {diff.weakens} {diff.weakens === 1 ? "change loosens" : "changes loosen"} what this agent is allowed to do.
          Read {diff.weakens === 1 ? "it" : "them"} before publishing.
        </div>
      )}

      <div className="table" style={{ marginTop: 10 }}>
        {diff.changes.map((c, i) => (
          <div key={i} className="tr static diff-row" style={{ gridTemplateColumns: "150px 1fr" }}>
            <div>
              <span className={`pill ${c.severity === "weakens" ? "amber" : c.severity === "strengthens" ? "green" : "grey"}`}>
                {c.severity === "weakens" ? "loosens" : c.severity === "strengthens" ? "tightens" : c.kind}
              </span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="name">
                {c.section} · {c.label}
              </div>
              {(c.before || c.after) && (
                <div className="sub-line diff-values">
                  {c.before ? <span className="diff-before">{c.before}</span> : null}
                  {c.before && c.after ? <span className="diff-arrow">→</span> : null}
                  {c.after ? <span className="diff-after">{c.after}</span> : null}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Fetches two stored specs and shows what changed between them. */
export default function VersionDiff({
  agentId,
  from,
  to,
  title,
}: {
  agentId: string;
  from?: string;
  to?: string;
  title?: string;
}) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    fetch(`/api/agents/${agentId}/diff?${qs}`)
      .then((r) => r.json())
      .then(setDiff)
      .catch(() => setDiff(null))
      .finally(() => setLoading(false));
  }, [agentId, from, to]);

  if (loading) return <div className="note mt">Working out what changed…</div>;
  if (!diff || diff.unavailable || diff.error) {
    return <div className="note mt">{diff?.error || "The comparison could not be loaded."}</div>;
  }
  return <DiffView diff={diff} title={title} />;
}
