"use client";

import { useMemo, useState } from "react";
import { formatValue, type Deliverable, type Table, type Tone } from "@/lib/deliverable";
import { ChartView, SERIES_COLOURS } from "./Charts";

/**
 * An agent's presented result as a dashboard: header with downloads, headline
 * figures, charts, the detailed tables, findings and next actions. Used on the
 * run page, in chat, and full-screen.
 */
export default function DeliverableView({
  d,
  id,
  compact = false,
  fullHref,
}: {
  d: Deliverable;
  /** The stored result's id, for the download links. */
  id?: string;
  /** In a chat or a run page: fewer table rows to start with. */
  compact?: boolean;
  /** "Open full screen" link, when shown inside another page. */
  fullHref?: string;
}) {
  const when = new Date(d.generatedAt);
  return (
    <article className={`dv${compact ? " compact" : ""}`}>
      <header className="dv-head">
        <div className="dv-head-text">
          <div className="dv-eyebrow">Agent result</div>
          <h2>{d.title}</h2>
          {d.subtitle && <p className="dv-sub">{d.subtitle}</p>}
          <div className="dv-meta">
            {!Number.isNaN(when.getTime()) && <span>{when.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
            {d.sources.map((s) => (
              <span key={s} className="dv-src">{s}</span>
            ))}
          </div>
        </div>
        {id && (
          <div className="dv-downloads">
            <a className="dv-dl xlsx" href={`/api/deliverables/${id}/xlsx`}><FileIcon /> Excel</a>
            <a className="dv-dl pdf" href={`/api/deliverables/${id}/pdf`}><FileIcon /> PDF</a>
            <a className="dv-dl pptx" href={`/api/deliverables/${id}/pptx`}><FileIcon /> PowerPoint</a>
            {fullHref && <a className="dv-dl open" href={fullHref} target="_blank" rel="noreferrer">Open full screen ↗</a>}
          </div>
        )}
      </header>

      {d.summary && <p className="dv-summary">{d.summary}</p>}

      {d.kpis.length > 0 && (
        <section className="dv-kpis" style={{ ["--n" as any]: Math.min(d.kpis.length, 4) }}>
          {d.kpis.map((k, i) => (
            <div key={i} className={`dv-kpi ${k.tone ?? "neutral"}`}>
              <span className="dv-kpi-label">{k.label}</span>
              <b className="dv-kpi-value">{formatValue(k.value, k.format, d.currency)}</b>
              {k.note && <span className="dv-kpi-note">{k.note}</span>}
            </div>
          ))}
        </section>
      )}

      {d.charts.length > 0 && (
        <section className={`dv-charts${d.charts.length === 1 ? " one" : ""}`}>
          {d.charts.map((c, i) => (
            <figure key={i} className="dv-card dv-chart">
              <figcaption>
                <b>{c.title}</b>
                {c.kind !== "donut" && c.series.length > 1 && (
                  <span className="dv-series">
                    {c.series.map((s, j) => (
                      <span key={j}><i style={{ background: SERIES_COLOURS[j % SERIES_COLOURS.length] }} />{s.name}</span>
                    ))}
                  </span>
                )}
              </figcaption>
              <ChartView chart={c} currency={d.currency} wide={d.charts.length % 2 === 1 && i === d.charts.length - 1} />
              {c.note && <p className="dv-note">{c.note}</p>}
            </figure>
          ))}
        </section>
      )}

      {(d.findings.length > 0 || d.actions.length > 0) && (
        <section className="dv-two">
          {d.findings.length > 0 && (
            <div className="dv-card">
              <h3>Findings</h3>
              <ul className="dv-findings">
                {d.findings.map((f, i) => (
                  <li key={i} className={f.tone}>
                    <ToneIcon tone={f.tone} />
                    <div>
                      <b>{f.title}</b>
                      {f.detail && <p>{f.detail}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.actions.length > 0 && (
            <div className="dv-card">
              <h3>Next actions</h3>
              <ol className="dv-actions">
                {d.actions.map((a, i) => (
                  <li key={i}>
                    <span>{a.text}</span>
                    {a.owner && <em>{a.owner}</em>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {d.tables.map((t, i) => (
        <TableCard key={i} t={t} currency={d.currency} compact={compact} />
      ))}
    </article>
  );
}

function TableCard({ t, currency, compact }: { t: Table; currency: string; compact: boolean }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  const shownByDefault = compact ? 8 : 15;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = q ? t.rows.filter((row) => t.columns.some((c) => String(row[c.key] ?? "").toLowerCase().includes(q))) : t.rows;
    if (sort) {
      const col = t.columns.find((c) => c.key === sort.key);
      const numeric = col && ["currency", "number", "integer", "percent"].includes(col.format ?? "");
      r = [...r].sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        const cmp = numeric ? (Number(x) || 0) - (Number(y) || 0) : String(x ?? "").localeCompare(String(y ?? ""), "en", { numeric: true });
        return cmp * sort.dir;
      });
    }
    return r;
  }, [t, sort, query]);
  const visible = all ? rows : rows.slice(0, shownByDefault);
  const numericCol = (f?: string) => ["currency", "number", "integer", "percent"].includes(f ?? "");

  return (
    <section className="dv-card dv-table-card">
      <div className="dv-table-head">
        <h3>
          {t.title} <span className="dv-count">{t.rows.length}</span>
        </h3>
        {t.rows.length > shownByDefault && (
          <input className="dv-search" placeholder="Filter rows…" value={query} onChange={(e) => setQuery(e.target.value)} />
        )}
      </div>
      {t.rows.length === 0 ? (
        <p className="dv-empty">Nothing to show.</p>
      ) : (
        <div className="dv-scroll">
          <table className="dv-table">
            <thead>
              <tr>
                {t.columns.map((c) => (
                  <th
                    key={c.key}
                    className={numericCol(c.format) ? "num" : ""}
                    onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}
                    aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                  >
                    {c.label}
                    <span className="dv-sort">{sort?.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, ri) => (
                <tr key={ri}>
                  {t.columns.map((c) => (
                    <td key={c.key} className={numericCol(c.format) ? "num" : ""}>
                      {formatValue(row[c.key], c.format, currency)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="dv-table-foot">
        {rows.length > shownByDefault && (
          <button type="button" className="dv-more" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${rows.length} rows`}
          </button>
        )}
        {t.truncated && <span className="dv-note">Showing the first {t.rows.length} of {t.truncated}+ rows.</span>}
        {t.note && <span className="dv-note">{t.note}</span>}
      </div>
    </section>
  );
}

const ToneIcon = ({ tone }: { tone: Tone }) => (
  <span className={`dv-tone ${tone}`} aria-hidden="true">
    {tone === "good" ? "✓" : tone === "bad" ? "!" : tone === "warn" ? "▲" : "i"}
  </span>
);

const FileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M12 12v6M9 15l3 3 3-3" />
  </svg>
);
