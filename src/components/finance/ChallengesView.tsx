"use client";

import { useState } from "react";
import Link from "next/link";
import FinIcon from "./FinIcon";
import { FinHead } from "./parts";
import { CHALLENGES, CHALLENGE_BUCKETS, THEMES, findActivity, streamHref } from "@/lib/finance";

const SLIDERS = [
  { key: "revenue", label: "Annual revenue", min: 500, max: 20000, step: 100, show: (v: number) => `₹ ${v.toLocaleString("en-IN")} Cr` },
  { key: "fte", label: "Finance headcount", min: 50, max: 1000, step: 10, show: (v: number) => `${v} FTEs` },
  { key: "dso", label: "Current DSO", min: 20, max: 120, step: 1, show: (v: number) => `${v} days` },
  { key: "touchless", label: "Current touchless invoice rate", min: 0, max: 90, step: 1, show: (v: number) => `${v}%` },
  { key: "adopt", label: "Target automation adoption", min: 10, max: 90, step: 5, show: (v: number) => `${v}%` },
  { key: "cost", label: "Fully loaded cost per FTE", min: 6, max: 30, step: 1, show: (v: number) => `₹ ${v} L / yr` },
] as const;

type Inputs = Record<(typeof SLIDERS)[number]["key"], number>;

/** Business problems by CFO agenda, the value themes behind them, and a what-if ROI model. */
export default function ChallengesView() {
  const [search, setSearch] = useState("");
  const [v, setV] = useState<Inputs>({ revenue: 5000, fte: 250, dso: 55, touchless: 42, adopt: 60, cost: 12 });

  // Same model as the Finance Command Centre prototype.
  const gain = Math.max(v.adopt - v.touchless, 0);
  const fteFreed = v.fte * (gain / 100) * 0.55;
  const savings = (fteFreed * v.cost) / 100;
  const dsoCut = Math.min(v.dso * 0.11, 8);
  const cash = (dsoCut / 365) * v.revenue;
  const payback = Math.max(6, Math.round(18 - (v.adopt - v.touchless) / 8));

  const term = search.trim().toLowerCase();
  const shown = CHALLENGES.filter((c) => !term || c.q.toLowerCase().includes(term));

  const solutionHref = (l3: string) => {
    const f = findActivity(l3);
    return f ? streamHref({ tower: f.tower.id, area: f.area.id, activity: l3 }) : null;
  };

  return (
    <div className="page fin">
      <FinHead
        eyebrow={<><Link href="/finance/value-stream" className="fin-crumb">Value stream</Link> · Challenges</>}
        title="Finance challenges"
        sub="Start from real business problems, grouped by the CFO agenda: growth, cost, efficiency, accuracy, risk and compliance."
      />

      <section className="fin-section">
        <div className="fin-section-head">
          <h2>Value themes</h2>
          <span className="fin-count">gaps against outside-in benchmarks</span>
        </div>
        <div className="fin-grid fin-grid-3">
          {THEMES.map((t) => (
            <article key={t.id} className="fin-card fin-themecard">
              <b>{t.name}</b>
              <p className="fin-gap">{t.gap}</p>
              <span className="fin-small dim">{t.towers.join(" · ")}</span>
              <Link href={streamHref({ theme: t.id })} className="fin-more">
                See linked processes <FinIcon name="arrow-right" size={12} />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="fin-section">
        <div className="fin-section-head">
          <h2>Pain points by agenda</h2>
          <label className="fin-search">
            <FinIcon name="search" size={14} />
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search challenges" aria-label="Search challenges" />
          </label>
        </div>
        {CHALLENGE_BUCKETS.map((b) => {
          const items = shown.filter((c) => c.bucket === b.id);
          if (!items.length) return null;
          return (
            <div key={b.id} className="fin-bucket">
              <h3><span className="fin-swatch" style={{ background: b.color }} aria-hidden="true" />{b.name}</h3>
              <div className="fin-grid fin-grid-3">
                {items.map((c, i) => {
                  const href = c.link ? solutionHref(c.link) : null;
                  const body = (
                    <>
                      <span className="fin-quote-q">“{c.q}”</span>
                      {href ? (
                        <span className="fin-more">Solution mapped <FinIcon name="arrow-right" size={12} /></span>
                      ) : (
                        <span className="tag static">Being written</span>
                      )}
                    </>
                  );
                  return href ? (
                    <Link key={i} href={href} className="fin-card fin-challenge">{body}</Link>
                  ) : (
                    <div key={i} className="fin-card fin-challenge static">{body}</div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!shown.length && (
          <div className="empty fin-empty">
            <h3>No challenge matches “{search.trim()}”</h3>
            <p>Try a shorter word, such as “close” or “invoice”.</p>
            <button className="btn" onClick={() => setSearch("")}>Clear search</button>
          </div>
        )}
      </section>

      <section className="fin-section">
        <div className="fin-section-head">
          <h2>Business case calculator</h2>
          <span className="fin-count">illustrative what-if model</span>
        </div>
        <div className="panel fin-calc">
          <div className="fin-calc-in">
            {SLIDERS.map((s) => (
              <label key={s.key} className="fin-slider">
                <span className="fin-slider-top">
                  <span>{s.label}</span>
                  <b className="mono">{s.show(v[s.key])}</b>
                </span>
                <input
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={v[s.key]}
                  onChange={(e) => setV((p) => ({ ...p, [s.key]: parseFloat(e.target.value) || 0 }))}
                />
              </label>
            ))}
          </div>
          <div className="fin-calc-out" aria-live="polite">
            <div className="eyebrow bare">Projected return</div>
            <div className="fin-out-row"><span>Finance effort freed</span><b>{fteFreed.toFixed(0)} FTE</b></div>
            <div className="fin-out-row"><span>Annual cost savings</span><b>₹ {savings.toFixed(1)} Cr</b></div>
            <div className="fin-out-row"><span>DSO improvement</span><b>{dsoCut.toFixed(1)} days</b></div>
            <div className="fin-out-row"><span>Working capital unlocked</span><b>₹ {cash.toFixed(0)} Cr</b></div>
            <div className="fin-out-row"><span>Payback</span><b>{payback} months</b></div>
            <p className="fin-small dim">Assumes a phased 18-month rollout with 55% of freed effort redeployed.</p>
          </div>
        </div>

        <div className="panel fin-bench">
          <h3>Your inputs against benchmark quartiles</h3>
          <Bars
            title="Touchless invoice rate"
            rows={[["You", v.touchless, "you"], ["Median", 45, "mid"], ["Top quartile", 80, "top"]]}
          />
          <Bars
            title="DSO (lower is better, as % of a 90-day ceiling)"
            rows={[["You", Math.round((v.dso / 90) * 100), "you"], ["Median", Math.round((48 / 90) * 100), "mid"], ["Top quartile", Math.round((34 / 90) * 100), "top"]]}
          />
        </div>
      </section>
    </div>
  );
}

function Bars({ title, rows }: { title: string; rows: [string, number, string][] }) {
  return (
    <div className="fin-bars">
      <div className="fin-small dim">{title}</div>
      {rows.map(([label, pct, cls]) => (
        <div key={label} className="fin-bar">
          <span>{label}</span>
          <span className="fin-bar-track"><span className={`fin-bar-fill ${cls}`} style={{ width: `${Math.min(pct, 100)}%` }} /></span>
          <b className="mono">{pct}%</b>
        </div>
      ))}
    </div>
  );
}
