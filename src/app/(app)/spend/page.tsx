"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUsd } from "@/lib/pricing";

type Summary = {
  runs: number;
  cost: number;
  input_tokens: string;
  output_tokens: string;
  cache_read_tokens: string;
  cache_write_tokens: string;
  cap: number | null;
  from: string;
};
type AgentRow = { id: string; name: string; status: string; runs: number; cost: number; tokens: string };

const num = (v: string | number) => Number(v || 0).toLocaleString("en-GB");

export default function SpendPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [byAgent, setByAgent] = useState<AgentRow[]>([]);
  const [canSetCap, setCanSetCap] = useState(false);
  const [cap, setCap] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/spend");
      if (!res.ok) throw new Error("Spend could not be loaded.");
      const j = await res.json();
      setSummary(j.summary);
      setByAgent(j.byAgent ?? []);
      setCanSetCap(Boolean(j.canSetCap));
      setCap(j.summary?.cap != null ? String(j.summary.cap) : "");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveCap(next: string | null) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cap: next }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The limit could not be saved.");
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const used = summary?.cap ? Math.min(100, (summary.cost / summary.cap) * 100) : 0;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Spend</h1>
          <p className="sub">
            What this workspace has spent on model calls this month, and the ceiling it runs under. Cost is priced
            when each run finishes, so changing rates never rewrites history.
          </p>
        </div>
      </header>

      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}
      {loading || !summary ? (
        <div className="note">Loading spend…</div>
      ) : (
        <>
          <div className="grid2" style={{ marginBottom: 18 }}>
            <div className="panel">
              <div className="eyebrow">This month</div>
              <div className="spend-figure">{formatUsd(summary.cost)}</div>
              <div className="sub-line">
                across {summary.runs} {summary.runs === 1 ? "run" : "runs"}
              </div>

              {summary.cap != null && (
                <>
                  <div className="meter" style={{ marginTop: 14 }}>
                    <span style={{ width: `${used}%` }} className={used >= 100 ? "over" : used >= 80 ? "near" : ""} />
                  </div>
                  <div className="sub-line mono" style={{ marginTop: 6 }}>
                    {formatUsd(summary.cost)} of {formatUsd(summary.cap)} · {used.toFixed(0)}%
                  </div>
                  {used >= 100 && (
                    <div className="note mt">
                      The limit is reached. New runs are refused until the limit is raised or the month turns.
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="panel">
              <div className="eyebrow">Tokens this month</div>
              <div className="sum-row">
                <div>Input</div>
                <div className="mono">{num(summary.input_tokens)}</div>
              </div>
              <div className="sum-row">
                <div>Output</div>
                <div className="mono">{num(summary.output_tokens)}</div>
              </div>
              <div className="sum-row">
                <div>Cache read</div>
                <div className="mono">{num(summary.cache_read_tokens)}</div>
              </div>
              <div className="sum-row">
                <div>Cache write</div>
                <div className="mono">{num(summary.cache_write_tokens)}</div>
              </div>
              <p className="help" style={{ marginTop: 12, marginBottom: 0 }}>
                Cached input is billed differently from fresh input — reads at about a tenth of the rate, writes at
                about a quarter more — which is why cost does not track raw token count.
              </p>
            </div>
          </div>

          {canSetCap && (
            <div className="panel" style={{ marginBottom: 18 }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Monthly limit</h2>
              <p className="help">
                When the workspace reaches this, new runs are refused and a run already going is stopped at its next
                step. Leave it empty for no limit.
              </p>
              <div className="row" style={{ gap: 10, alignItems: "flex-end" }}>
                <label className="field" style={{ maxWidth: 200 }}>
                  <span className="eyebrow">US dollars</span>
                  <input
                    className="input mono"
                    inputMode="decimal"
                    value={cap}
                    placeholder="e.g. 50"
                    onChange={(e) => setCap(e.target.value)}
                  />
                </label>
                <button className="btn btn-primary" onClick={() => saveCap(cap.trim() || null)} disabled={busy}>
                  {busy ? "Saving…" : "Save limit"}
                </button>
                {summary.cap != null && (
                  <button className="btn" onClick={() => saveCap(null)} disabled={busy}>
                    Remove limit
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="list-head">
            <span className="count">by agent, this month</span>
          </div>
          {byAgent.length === 0 ? (
            <div className="empty">
              <h3>Nothing spent yet this month</h3>
              <p>Once agents run, what each one costs shows up here.</p>
            </div>
          ) : (
            <div className="table">
              <div className="tr th" style={{ gridTemplateColumns: "2.2fr .8fr .8fr 1fr" }}>
                <div>Agent</div>
                <div>Runs</div>
                <div>Tokens</div>
                <div>Cost</div>
              </div>
              {byAgent.map((a) => (
                <Link key={a.id} href={`/agents/${a.id}`} className="tr link" style={{ gridTemplateColumns: "2.2fr .8fr .8fr 1fr" }}>
                  <div className="name">{a.name}</div>
                  <div className="mono dim">{a.runs}</div>
                  <div className="mono dim">{num(a.tokens)}</div>
                  <div className="mono">{formatUsd(a.cost)}</div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
