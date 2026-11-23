"use client";

import { useState } from "react";
import Link from "next/link";
import FinIcon from "./FinIcon";
import { useFinance } from "./FinanceProvider";
import { CopilotBar, FinHead, MetricTile, Signal, SignalLegend } from "./parts";
import { ACTION_LIBRARY, DRILLDOWN, NEWS_TABS, PERSONAS, PLACEHOLDER_PERSONAS, personaHref, type Level, type Persona } from "@/lib/finance";

const INSIGHT_MARK: Record<Level, string> = { red: "▲", amber: "●", green: "▼" };

/* ── Finance Personas ───────────────────────────────────────────────────── */

export function PersonasView() {
  const { notify } = useFinance();
  return (
    <div className="page fin">
      <FinHead
        eyebrow="Finance"
        title="Finance personas"
        sub="Five finance leadership roles, each with a cockpit of the metrics they own and the actions waiting on them. Open a cockpit to see live signals, or go straight to the open actions."
      />

      <div className="fin-grid fin-grid-3">
        {PERSONAS.map((p) => {
          const open = (ACTION_LIBRARY[p.id] || []).length;
          return (
            <article key={p.id} className="panel fin-persona">
              <header className="fin-persona-head">
                <span className="fin-avatar" aria-hidden="true">{p.avatar}</span>
                <div>
                  <h2>{p.name}</h2>
                  <div className="eyebrow bare">{p.role}</div>
                </div>
              </header>
              <p className="fin-persona-focus">{p.focus}</p>

              <div className="eyebrow">Key insights</div>
              <ul className="fin-insights">
                {p.insights.map((it, i) => (
                  <li key={i} className={it.level}>
                    <span className="fin-insight-mark" aria-hidden="true">{INSIGHT_MARK[it.level]}</span>
                    <span>{it.text}</span>
                  </li>
                ))}
              </ul>

              <div className="fin-persona-foot">
                <Link href={personaHref(p.id)} className="btn btn-primary btn-sm">
                  Open cockpit <FinIcon name="arrow-right" size={13} />
                </Link>
                <Link href={`${personaHref(p.id)}/actions`} className="btn btn-sm">
                  {open} open action{open === 1 ? "" : "s"}
                </Link>
              </div>
            </article>
          );
        })}

        {PLACEHOLDER_PERSONAS.map((name) => (
          <article key={name} className="fin-persona soon">
            <header className="fin-persona-head">
              <span className="fin-avatar off" aria-hidden="true">{name.charAt(0)}</span>
              <div>
                <h2>{name}</h2>
                <div className="eyebrow bare">Coming soon</div>
              </div>
            </header>
            <p className="fin-persona-focus">This persona&rsquo;s cockpit, decision workflows and actions are being built.</p>
            <div className="fin-persona-foot">
              <button className="btn btn-sm" onClick={() => notify(`${name} notifications enabled for future updates.`, "ok")}>
                <FinIcon name="bell" size={13} /> Notify me
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ── one list of actions, used on the cockpit and the actions page ─────── */

function ActionRows({ persona }: { persona: Persona }) {
  const { openAction, isDone, toggleDone } = useFinance();
  const actions = ACTION_LIBRARY[persona.id] || [];
  if (!actions.length) return <p className="dim fin-small fin-pad">No open actions for this role.</p>;
  return (
    <ul className="fin-actions">
      {actions.map((a, i) => {
        const done = isDone(persona.id, i);
        return (
          <li key={i} className={`fin-action${done ? " done" : ""}`}>
            <label className="fin-check" title={done ? "Mark as not done" : "Mark as done"}>
              <input type="checkbox" checked={done} onChange={() => toggleDone(persona.id, i)} aria-label={`Done: ${a.title}`} />
              <span aria-hidden="true" />
            </label>
            <button className="fin-action-main" onClick={() => openAction(persona.id, i)}>
              <span className={`fin-sev ${a.sev}`} title={a.sev === "high" ? "High severity" : a.sev === "med" ? "Medium severity" : "Low severity"} />
              <span className="fin-action-text">
                <b>{a.title}</b>
                <span>{a.meta}</span>
              </span>
              <FinIcon name="arrow-right" size={14} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function findPersona(id: string) {
  return PERSONAS.find((p) => p.id === id) || null;
}

/* ── Cockpit ─────────────────────────────────────────────────────────────── */

export function CockpitView({ personaId }: { personaId: string }) {
  const persona = findPersona(personaId);
  const [tab, setTab] = useState(NEWS_TABS[0]?.id);
  if (!persona) return <MissingPersona />;
  const actions = ACTION_LIBRARY[persona.id] || [];
  const news = NEWS_TABS.find((t) => t.id === tab) || NEWS_TABS[0];

  return (
    <div className="page fin">
      <FinHead
        eyebrow={<><Link href="/finance/personas" className="fin-crumb">Finance personas</Link> · Cockpit</>}
        title={persona.name}
        sub={persona.focus}
      >
        <Link href={`${personaHref(persona.id)}/actions`} className="btn btn-sm">All open actions</Link>
      </FinHead>

      <CopilotBar placeholder={`Ask ${persona.name}’s cockpit, e.g. “Why did CCC move this week?”`} />

      <section className="fin-section">
        <div className="fin-section-head">
          <h2>Instrument panel</h2>
          <span className="fin-count">{persona.metrics.length} metrics · select one to drill in</span>
        </div>
        <div className="fin-tiles">
          {persona.metrics.map((m) => (
            <MetricTile key={m} metricId={m} personaId={persona.id} />
          ))}
        </div>
      </section>

      <div className="fin-two">
        <section className="fin-section">
          <div className="fin-section-head">
            <h2>Action centre</h2>
            <span className="fin-count">{actions.length} open</span>
          </div>
          <div className="panel fin-flush">
            <ActionRows persona={persona} />
          </div>
        </section>

        <section className="fin-section">
          <div className="fin-section-head">
            <h2>Company &amp; sector intelligence</h2>
          </div>
          <div className="panel fin-news">
            <div className="seg fin-seg" role="tablist" aria-label="News">
              {NEWS_TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={t.id === news.id} className={`seg-opt${t.id === news.id ? " on" : ""}`} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            {news.items.map((n, i) => (
              <div key={i} className="fin-news-row">
                <span className="tag static">{n.tag}</span>
                <div>
                  {/* News text is static demo content with <b> emphasis only. */}
                  <div className="fin-news-text" dangerouslySetInnerHTML={{ __html: n.text }} />
                  <div className="fin-small dim">{n.meta}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ── Open actions ───────────────────────────────────────────────────────── */

export function ActionListView({ personaId }: { personaId: string }) {
  const persona = findPersona(personaId);
  if (!persona) return <MissingPersona />;
  return (
    <div className="page fin">
      <FinHead
        eyebrow={<><Link href="/finance/personas" className="fin-crumb">Finance personas</Link> · <Link href={personaHref(persona.id)} className="fin-crumb">{persona.name}</Link></>}
        title="Open actions"
        sub="Every flagged exception and strategic action for this role. Open one to see its root-cause breakdown and the steps to resolve it, linked to the process it belongs to."
      >
        <Link href={personaHref(persona.id)} className="btn btn-sm">
          <FinIcon name="arrow-left" size={13} /> Back to cockpit
        </Link>
      </FinHead>
      <div className="panel fin-flush fin-narrow">
        <ActionRows persona={persona} />
      </div>
    </div>
  );
}

/* ── Driver tree ────────────────────────────────────────────────────────── */

const DRILL_LABELS: Record<Level, string> = { red: "Dragging the metric", amber: "Watch closely", green: "Driving outperformance" };
const ROW_LABELS: Record<Level, string> = { red: "Focus", amber: "Watch", green: "Strong" };

export function DrilldownView({ personaId, metricId }: { personaId: string; metricId: string }) {
  const persona = findPersona(personaId);
  const dd = DRILLDOWN[metricId];
  const dims = dd ? Object.keys(dd.dims) : [];
  const [dim, setDim] = useState(dims[0]);
  if (!persona || !dd) return <MissingPersona what="metric" />;
  const rows = dd.dims[dim] || [];

  return (
    <div className="page fin">
      <FinHead
        eyebrow={<><Link href="/finance/personas" className="fin-crumb">Finance personas</Link> · <Link href={personaHref(persona.id)} className="fin-crumb">{persona.name}</Link> · Driver tree</>}
        title={dd.title}
        sub={dd.note}
      >
        <span className="tag static">Company benchmark {dd.metricVal}</span>
        <Link href={personaHref(persona.id)} className="btn btn-sm">
          <FinIcon name="arrow-left" size={13} /> Back to cockpit
        </Link>
      </FinHead>

      <div className="fin-toolbar">
        <div className="chips" role="tablist" aria-label="Break down by">
          {dims.map((d) => (
            <button key={d} role="tab" aria-selected={d === dim} className={`chip${d === dim ? " on" : ""}`} onClick={() => setDim(d)}>
              By {d.toLowerCase()}
            </button>
          ))}
        </div>
        <SignalLegend labels={DRILL_LABELS} />
      </div>

      <div className="panel fin-flush">
        <div className="fin-table" role="table" aria-label={`${dd.title} by ${dim}`}>
          <div className="fin-tr fin-th" role="row">
            <span role="columnheader">Segment</span>
            {dd.cols.slice(0, 3).map((c) => <span key={c} role="columnheader">{c}</span>)}
            <span role="columnheader">Signal</span>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="fin-tr" role="row">
              <b role="cell">{r.seg}</b>
              <span role="cell" className="mono">{r.share}</span>
              <span role="cell" className="mono">{r.growth}</span>
              <span role="cell" className="mono">{r.marginChg}</span>
              <span role="cell"><Signal level={r.level} labels={ROW_LABELS} /></span>
            </div>
          ))}
        </div>
      </div>
      <p className="fin-small dim fin-note">
        Illustrative segment data for a diversified manufacturing enterprise. Live ERP sub-ledger feeds can replace it.
      </p>
    </div>
  );
}

function MissingPersona({ what = "persona" }: { what?: string }) {
  return (
    <div className="page fin">
      <div className="empty">
        <h3>That {what} isn&rsquo;t available</h3>
        <p>The link may be out of date. Pick a persona to continue.</p>
        <Link href="/finance/personas" className="btn btn-primary">See all personas</Link>
      </div>
    </div>
  );
}
