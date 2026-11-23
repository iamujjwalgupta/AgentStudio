"use client";

import { useState } from "react";
import Link from "next/link";
import FinIcon from "./FinIcon";
import { METRICS, genSeries, fmtNum, catColor, seedFromString, mulberry32, metricHref, type Level } from "@/lib/finance";

/* ── signal: where to focus ─────────────────────────────────────────────────
   Red = focus now, amber = plan next, teal = healthy. These are business
   priorities, not app states, so they never use magenta ("a person is needed"). */

export const SIGNAL_LABELS: Record<Level, string> = { red: "Focus now", amber: "Plan next", green: "Healthy" };

export function Signal({ level = "green", labels = SIGNAL_LABELS }: { level?: Level; labels?: Record<Level, string> }) {
  return (
    <span className={`fin-sig ${level}`}>
      <span className="fin-dot" aria-hidden="true" />
      {labels[level] || labels.green}
    </span>
  );
}

export function SignalLegend({ labels = SIGNAL_LABELS }: { labels?: Record<Level, string> }) {
  return (
    <div className="fin-legend" aria-label="What the signals mean">
      <span className="fin-legend-k">Signals</span>
      {(["red", "amber", "green"] as Level[]).map((l) => (
        <Signal key={l} level={l} labels={labels} />
      ))}
    </div>
  );
}

/** Who does a step: an AI agent, a rules-based automation, or a person. */
export function OwnerTag({ type }: { type: "AI" | "Automation" | "Human" | string }) {
  const cls = type === "AI" ? "ai" : type === "Automation" ? "auto" : "human";
  return <span className={`fin-owner ${cls}`}>{type}-led</span>;
}

export function Sparkline({ series, good, width = 86, height = 26 }: { series: number[]; good: boolean; width?: number; height?: number }) {
  if (series.length < 2) return null;
  const pad = 2;
  const min = Math.min(...series);
  const range = Math.max(...series) - min || 1;
  const points = series
    .map((v, i) => {
      const x = pad + (i / (series.length - 1)) * (width - 2 * pad);
      const y = height - pad - ((v - min) / range) * (height - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className={`fin-spark ${good ? "good" : "bad"}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** One instrument on a persona's cockpit. Opens its driver tree or its process. */
export function MetricTile({ metricId, personaId }: { metricId: string; personaId: string }) {
  const m = METRICS[metricId];
  if (!m) return null;
  const series = genSeries(metricId, m.base, m.vol, 12);
  const prev = series[series.length - 2];
  const diffPct = ((m.base - prev) / Math.abs(prev || 1)) * 100;
  const good = (m.better === "up" && diffPct >= 0) || (m.better === "down" && diffPct < 0);
  const href = metricHref(metricId, personaId);
  const body = (
    <>
      <div className="fin-tile-top">
        <span className="fin-tile-label">{m.label}</span>
        <span className="fin-cat" style={{ background: catColor(m.category) }} title={`${m.category[0].toUpperCase()}${m.category.slice(1)}`} />
      </div>
      <div className="fin-tile-val">
        {fmtNum(m.base)}
        {m.unit && <span className="fin-tile-unit">{m.unit}</span>}
      </div>
      <div className="fin-tile-foot">
        <span className={`fin-delta ${good ? "good" : "bad"}`}>
          {diffPct >= 0 ? "▲" : "▼"} {Math.abs(diffPct).toFixed(1)}%
        </span>
        <Sparkline series={series} good={good} />
      </div>
      {href && <span className="fin-tile-cta">Drill in <FinIcon name="arrow-right" size={12} /></span>}
    </>
  );
  return href ? (
    <Link href={href} className="fin-tile">{body}</Link>
  ) : (
    <div className="fin-tile static">{body}</div>
  );
}

const COPILOT_ANSWERS = [
  "DSO moved up 1.4 days this week, mainly from the Export segment — 3 large invoices crossed 60 days. Collections Prioritisation Agent has flagged them for outreach.",
  "Cash position is ₹1,240 Cr, up 2.1% week-on-week, driven by faster collections and a scheduled AP batch deferred by 2 days.",
  "Forecast accuracy held at 84% — within the top-quartile band once we exclude the one-off raw-material price shock in Plant 4.",
  "Cost-to-serve in P2P is at 1.4% of revenue vs 0.8% benchmark. The largest lever is scaling touchless invoice ingestion from 42% to 85%.",
  "Intercompany reconciliation has 27 open mismatches, primarily concentrated between Plant 1 and Plant 3 inventory transfers.",
];

/** A demo question box: answers come from a fixed set of illustrative insights. */
export function CopilotBar({ placeholder }: { placeholder: string }) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const ask = () => {
    if (!query.trim()) return;
    const rnd = mulberry32(seedFromString(query));
    setAnswer(COPILOT_ANSWERS[Math.floor(rnd() * COPILOT_ANSWERS.length)]);
  };
  return (
    <div className="fin-copilot">
      <form
        className="fin-copilot-bar"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <span className="fin-copilot-ico"><FinIcon name="sparkles" size={16} /></span>
        <input
          className="fin-copilot-input"
          value={query}
          placeholder={placeholder}
          aria-label="Ask the cockpit a question"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn btn-primary btn-sm" type="submit">
          Ask <FinIcon name="arrow-right" size={13} />
        </button>
      </form>
      {answer && (
        <div className="fin-copilot-answer" aria-live="polite">
          <span className="eyebrow bare">Copilot · illustrative answer</span>
          <p>{answer}</p>
        </div>
      )}
    </div>
  );
}

/** Page header in the Agent Studio pattern: eyebrow, uppercase title, one-line explanation, actions. */
export function FinHead({ eyebrow, title, sub, children }: { eyebrow: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="page-head fin-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {sub && <p className="sub fin-sub">{sub}</p>}
      </div>
      {children && <div className="fin-head-actions">{children}</div>}
    </div>
  );
}
