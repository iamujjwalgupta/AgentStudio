"use client";

import { formatCompact, formatValue, type Chart } from "@/lib/deliverable";

/**
 * The dashboard's charts, drawn as SVG so they need no chart library and look
 * the same in the app and in screenshots. Values show on hover (native
 * tooltips), and in the legend for donuts.
 */

export const SERIES_COLOURS = ["#00338d", "#0091da", "#00a3a1", "#483698", "#c6007e", "#f68d2e"];

/** Round axis steps: 1, 2, 2.5 or 5 times a power of ten. */
function niceTicks(min: number, max: number, count = 5): number[] {
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  // The axis always reaches past the largest (and below the smallest) value.
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step * 0.001; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function ChartView({ chart, currency, wide = false }: { chart: Chart; currency: string; wide?: boolean }) {
  if (chart.kind === "donut") return <Donut chart={chart} currency={currency} />;
  return <Cartesian chart={chart} currency={currency} wide={wide} />;
}

function Cartesian({ chart, currency, wide }: { chart: Chart; currency: string; wide: boolean }) {
  // A chart across the full row gets a wider drawing, not a bigger one.
  const W = wide ? 1280 : 640, H = 280, L = 64, R = 16, T = 16;
  const many = chart.categories.length > (wide ? 14 : 7);
  const B = many ? 70 : 40;
  const pw = W - L - R, ph = H - T - B;
  const all = chart.series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const y = (v: number) => T + ph - ((v - lo) / (hi - lo || 1)) * ph;
  const n = Math.max(chart.categories.length, 1);
  const band = pw / n;
  const fmt = (v: number) => formatValue(v, chart.format, currency);

  return (
    <svg className="dv-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chart.title}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t === 0 ? "dv-axis0" : "dv-grid"} />
          <text x={L - 8} y={y(t) + 4} className="dv-tick" textAnchor="end">{formatCompact(t, chart.format, currency)}</text>
        </g>
      ))}
      {chart.kind === "bar"
        ? chart.categories.map((cat, i) => {
            const m = chart.series.length;
            const gw = band * 0.72, bw = gw / m;
            return chart.series.map((s, j) => {
              const v = s.values[i] ?? 0;
              const x = L + i * band + (band - gw) / 2 + j * bw;
              const top = y(Math.max(v, 0)), bottom = y(Math.min(v, 0));
              return (
                <rect key={`${i}-${j}`} x={x + 1} y={top} width={Math.max(bw - 2, 1)} height={Math.max(bottom - top, 1)} rx={3} fill={SERIES_COLOURS[j % SERIES_COLOURS.length]} className="dv-bar">
                  <title>{`${cat} · ${s.name}: ${fmt(v)}`}</title>
                </rect>
              );
            });
          })
        : chart.series.map((s, j) => {
            const pts = s.values.map((v, i) => [L + i * band + band / 2, y(v)] as const);
            const colour = SERIES_COLOURS[j % SERIES_COLOURS.length];
            const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
            return (
              <g key={j}>
                {j === 0 && pts.length > 1 && (
                  <path d={`${d} L${pts[pts.length - 1][0].toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)} L${pts[0][0].toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)} Z`} fill={colour} opacity={0.08} />
                )}
                <path d={d} fill="none" stroke={colour} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
                {pts.map(([px, py], i) => (
                  <circle key={i} cx={px} cy={py} r={3.6} fill="#fff" stroke={colour} strokeWidth={2}>
                    <title>{`${chart.categories[i]} · ${s.name}: ${fmt(s.values[i])}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
      {chart.categories.map((cat, i) => {
        const x = L + i * band + band / 2;
        return many ? (
          <text key={i} className="dv-cat" textAnchor="end" transform={`translate(${x},${T + ph + 12}) rotate(-35)`}>{clip(cat, 16)}</text>
        ) : (
          <text key={i} className="dv-cat" textAnchor="middle" x={x} y={T + ph + 18}>{clip(cat, 14)}</text>
        );
      })}
    </svg>
  );
}

function Donut({ chart, currency }: { chart: Chart; currency: string }) {
  const values = (chart.series[0]?.values ?? []).map((v) => Math.max(v, 0));
  const total = values.reduce((a, b) => a + b, 0);
  const R = 90, r = 58, C = 110;
  let angle = -Math.PI / 2;
  const arcs = values.map((v, i) => {
    const sweep = total ? (v / total) * Math.PI * 2 : 0;
    const a0 = angle, a1 = angle + sweep;
    angle = a1;
    const large = sweep > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${(C + rad * Math.cos(a)).toFixed(2)},${(C + rad * Math.sin(a)).toFixed(2)}`;
    const d =
      sweep >= Math.PI * 2 - 1e-6
        ? `M${p(R, 0)} A${R},${R} 0 1 1 ${p(R, Math.PI)} A${R},${R} 0 1 1 ${p(R, 0)} M${p(r, 0)} A${r},${r} 0 1 0 ${p(r, Math.PI)} A${r},${r} 0 1 0 ${p(r, 0)} Z`
        : `M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z`;
    return { d, v, i };
  });
  return (
    <div className="dv-donut">
      <svg viewBox="0 0 220 220" role="img" aria-label={chart.title}>
        {arcs.map((a) =>
          a.v > 0 ? (
            <path key={a.i} d={a.d} fillRule="evenodd" fill={SERIES_COLOURS[a.i % SERIES_COLOURS.length]} className="dv-arc">
              <title>{`${chart.categories[a.i]}: ${formatValue(a.v, chart.format, currency)}`}</title>
            </path>
          ) : null,
        )}
        <text x={C} y={C - 2} textAnchor="middle" className="dv-donut-total">{formatCompact(total, chart.format, currency)}</text>
        <text x={C} y={C + 16} textAnchor="middle" className="dv-donut-label">Total</text>
      </svg>
      <ul className="dv-legend">
        {chart.categories.map((cat, i) => (
          <li key={i}>
            <i style={{ background: SERIES_COLOURS[i % SERIES_COLOURS.length] }} />
            <span className="dv-legend-name">{cat}</span>
            <b>{formatValue(values[i], chart.format, currency)}</b>
            <em>{total ? `${Math.round((values[i] / total) * 1000) / 10}%` : "—"}</em>
          </li>
        ))}
      </ul>
    </div>
  );
}
