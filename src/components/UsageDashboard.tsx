"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { KindIcon } from "@/components/ConnectorIcons";
import { AlertIcon, CheckIcon, CrossIcon, PencilIcon, TrashIcon } from "@/components/agent-ui";
import type { LimitStatus, UsageOverview } from "@/lib/usage-report";

type Data = UsageOverview & { canManage: boolean; timezone: string };
type Provider = "anthropic" | "gemini";

const PROVIDER_NAME: Record<Provider, string> = { anthropic: "Anthropic (Claude)", gemini: "Google Gemini" };

export const fmtTokens = (n: number) => {
  const v = Math.round(Number(n) || 0);
  if (v >= 1e9) return `${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
  return String(v);
};
const fmtUsd = (n: number) => {
  const v = Number(n) || 0;
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 100) return `$${v.toFixed(2)}`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
};
const fmtDate = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "short" }).format(new Date(iso));
const fmtWhen = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const limitText = (l: Pick<LimitStatus, "max_tokens" | "max_usd">) =>
  [l.max_tokens ? `${fmtTokens(l.max_tokens)} tokens` : "", l.max_usd ? fmtUsd(l.max_usd) : ""].filter(Boolean).join(" or ");
const level = (share: number) => (share >= 1 ? "over" : share >= 0.8 ? "warn" : "ok");

export default function UsageDashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [days, setDays] = useState(30);
  const [series, setSeries] = useState<Provider>("anthropic");
  const [tab, setTab] = useState<"agent" | "feature" | "user" | "model">("agent");
  const [editing, setEditing] = useState<Partial<LimitStatus> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/usage?days=${days}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Usage could not be loaded.");
      setData(j);
    } catch (e: any) {
      setError(e.message);
    }
  }, [days]);
  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    const p = data?.providers ?? [];
    const sum = (k: "tokens" | "usd" | "calls" | "runs" | "cacheSavingsUsd") => p.reduce((a, x) => a + (x[k] as number), 0);
    return { tokens: sum("tokens"), usd: sum("usd"), calls: sum("calls"), runs: sum("runs"), savings: sum("cacheSavingsUsd") };
  }, [data]);

  if (error && !data) return <div className="page"><div className="error">{error}</div></div>;
  if (!data) return <div className="page"><div className="note">Loading usage…</div></div>;
  const tz = data.timezone || "UTC";

  return (
    <div className="page ux">
      <header className="page-head">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Usage &amp; limits</h1>
          <p className="sub" style={{ maxWidth: "none" }}>
            Every model call the workspace makes, on the Anthropic and Gemini keys, and the limits that stop it.
            This month runs from {fmtDate(data.monthStart, tz)} to {fmtDate(new Date(new Date(data.nextMonth).getTime() - 1).toISOString(), tz)}.
          </p>
        </div>
        <div className="ux-head-actions">
          <a className="btn" href="/api/usage/export">Export this month</a>
          <a className="btn btn-ghost" href="/api/usage/export?month=previous">Last month</a>
        </div>
      </header>

      {/* ---- the two keys ---- */}
      <div className="ux-keys">
        {data.providers.map((p) => {
          const keyLimits = data.limits.filter((l) => l.scope === "provider" && l.target === p.provider);
          const month = keyLimits.find((l) => l.period === "month");
          const worst = keyLimits.reduce((m, l) => Math.max(m, l.share), 0);
          const projectedShare = month ? Math.max(month.max_tokens ? p.projectedTokens / month.max_tokens : 0, month.max_usd ? p.projectedUsd / month.max_usd : 0) : 0;
          return (
            <section key={p.provider} className={`ux-key ${p.configured ? level(worst) : "off"}`}>
              <div className="ux-key-head">
                <span className="ux-ic"><KindIcon kind={p.provider} size={26} /></span>
                <div className="grow">
                  <b>{PROVIDER_NAME[p.provider]}</b>
                  <span>{p.configured ? (p.provider === "anthropic" ? "Runs every agent" : "Runs the Google ADK sandbox") : "No key added"}</span>
                </div>
                <span className={`ux-pill ${!p.configured ? "muted" : level(worst)}`}>
                  {!p.configured ? "Not set up" : worst >= 1 ? "Limit reached" : worst >= 0.8 ? "Near the limit" : keyLimits.length ? "Within limits" : "No limit set"}
                </span>
              </div>

              <div className="ux-key-nums">
                <div><span className="v">{fmtTokens(p.tokens)}</span><span className="l">tokens this month</span></div>
                <div><span className="v">{fmtUsd(p.usd)}</span><span className="l">estimated cost</span></div>
                <div><span className="v">{fmtTokens(p.today.tokens)}</span><span className="l">today</span></div>
              </div>

              {keyLimits.length ? (
                keyLimits.map((l) => (
                  <div key={l.period} className="ux-meter">
                    <div className="ux-meter-top">
                      <span>{l.period === "day" ? "Daily" : "Monthly"} limit · {limitText(l)}</span>
                      <b>{Math.min(999, Math.round(l.share * 100))}%</b>
                    </div>
                    <div className={`ux-bar ${level(l.share)}`}><i style={{ width: `${Math.min(100, l.share * 100)}%` }} /></div>
                    <div className="ux-meter-foot">
                      <span>{fmtTokens(l.used.tokens)} tokens · {fmtUsd(l.used.usd)} used</span>
                      <span>Resets {fmtWhen(l.resetsAt, tz)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="ux-nolimit">No limit on this key: usage is recorded but never stopped.</p>
              )}

              <div className="ux-key-foot">
                <span>
                  Projected month-end: <b>{fmtTokens(p.projectedTokens)} tokens · {fmtUsd(p.projectedUsd)}</b>
                  {month && projectedShare >= 1 && <em className="ux-warn-text"> — on course to pass the monthly limit</em>}
                </span>
                {p.cacheSavingsUsd > 0 && <span>Caching saved {fmtUsd(p.cacheSavingsUsd)}</span>}
              </div>
              {data.canManage && (
                <div className="ux-key-actions">
                  {!p.configured ? (
                    <Link className="btn btn-sm" href={`/connections?add=${p.provider}`}>Add the key</Link>
                  ) : (
                    <>
                      <button className="btn btn-sm" onClick={() => setEditing(month ?? { scope: "provider", target: p.provider, period: "month" })}>
                        {month ? "Edit monthly limit" : "Set a monthly limit"}
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(keyLimits.find((l) => l.period === "day") ?? { scope: "provider", target: p.provider, period: "day" })}>
                        {keyLimits.some((l) => l.period === "day") ? "Edit daily limit" : "Add a daily limit"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* ---- headline numbers ---- */}
      <div className="ux-stats">
        <div className="ux-stat"><span className="v">{fmtTokens(totals.tokens)}</span><span className="l">Tokens this month</span></div>
        <div className="ux-stat"><span className="v">{fmtUsd(totals.usd)}</span><span className="l">Estimated cost</span></div>
        <div className="ux-stat"><span className="v">{totals.calls.toLocaleString("en-US")}</span><span className="l">Model calls</span></div>
        <div className="ux-stat"><span className="v">{totals.runs.toLocaleString("en-US")}</span><span className="l">Agent runs</span></div>
        <div className="ux-stat"><span className="v">{totals.runs ? fmtTokens(totals.tokens / totals.runs) : "—"}</span><span className="l">Tokens per run</span></div>
        <div className="ux-stat ok"><span className="v">{fmtUsd(totals.savings)}</span><span className="l">Saved by caching</span></div>
      </div>

      {/* ---- daily chart ---- */}
      <section className="ux-card">
        <div className="ux-card-head">
          <div>
            <h2>Daily tokens</h2>
            <span>Input, output and cached tokens per day, in {tz}.</span>
          </div>
          <div className="ux-card-tools">
            <span className="seg">
              {(["anthropic", "gemini"] as Provider[]).map((p) => (
                <button key={p} className={`seg-opt ${series === p ? "on" : ""}`} onClick={() => setSeries(p)}>{p === "anthropic" ? "Anthropic" : "Gemini"}</button>
              ))}
            </span>
            <select className="select-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Range">
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
        </div>
        <DailyChart rows={data.daily.filter((d) => d.provider === series)} dailyLimit={data.limits.find((l) => l.scope === "provider" && l.target === series && l.period === "day")?.max_tokens ?? null} />
      </section>

      {/* ---- limits ---- */}
      <section className="ux-card">
        <div className="ux-card-head">
          <div>
            <h2>Limits</h2>
            <span>At a limit, new model calls on that key or by that agent are refused until it is raised or the period turns. Owner and admins are told at 80% and 100%.</span>
          </div>
          {data.canManage && (
            <button className="btn btn-sm" onClick={() => setEditing({ scope: "agent", target: "", period: "month" })}>+ Limit an agent</button>
          )}
        </div>
        {data.limits.length === 0 ? (
          <p className="dim" style={{ margin: 0 }}>No limits yet. Set one on a key above, or limit a single agent.</p>
        ) : (
          <div className="ux-table">
            <div className="ux-tr head ux-limits-row">
              <span>On</span><span>Period</span><span>Limit</span><span>Used</span><span>Resets</span><span>Set by</span><span />
            </div>
            {data.limits.map((l) => (
              <div key={`${l.scope}-${l.target}-${l.period}`} className="ux-tr ux-limits-row">
                <span className="ux-on">
                  {l.scope === "provider" ? <KindIcon kind={l.target} size={16} /> : <span className="ux-agent-dot" />}
                  {l.scope === "agent" ? <Link href={`/agents/${l.target}`}>{l.name}</Link> : l.name}
                </span>
                <span>{l.period === "day" ? "Daily" : "Monthly"}</span>
                <span>{limitText(l)}</span>
                <span className="ux-used">
                  <span className={`ux-bar sm ${level(l.share)}`}><i style={{ width: `${Math.min(100, l.share * 100)}%` }} /></span>
                  <b>{Math.min(999, Math.round(l.share * 100))}%</b>
                </span>
                <span className="dim">{fmtWhen(l.resetsAt, tz)}</span>
                <span className="dim">{l.updated_by || "—"}</span>
                <span className="ux-row-actions">
                  {data.canManage && (
                    <>
                      <button className="ux-icon-btn" onClick={() => setEditing(l)} aria-label="Edit limit" title="Edit"><PencilIcon size={13} /></button>
                      <button className="ux-icon-btn danger" onClick={async () => { await saveLimit({ scope: l.scope, target: l.target, period: l.period, maxTokens: null, maxUsd: null }); load(); }} aria-label="Remove limit" title="Remove"><TrashIcon size={13} /></button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- breakdowns and heaviest runs ---- */}
      <div className="ux-split">
        <section className="ux-card">
          <div className="ux-card-head">
            <div>
              <h2>Where the tokens went</h2>
              <span>This month.</span>
            </div>
            <span className="seg">
              {(["agent", "feature", "user", "model"] as const).map((t) => (
                <button key={t} className={`seg-opt ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
                  {t === "agent" ? "Agent" : t === "feature" ? "Feature" : t === "user" ? "Person" : "Model"}
                </button>
              ))}
            </span>
          </div>
          <Breakdown
            rows={
              tab === "agent"
                ? data.byAgent.map((r) => ({ key: r.id, name: r.name, href: `/agents/${r.id}`, sub: `${r.runs} ${r.runs === 1 ? "run" : "runs"}`, tokens: r.tokens, usd: r.usd }))
                : tab === "feature"
                  ? data.byFeature.map((r) => ({ key: r.feature, name: r.label, sub: `${r.calls} calls`, tokens: r.tokens, usd: r.usd }))
                  : tab === "user"
                    ? data.byUser.map((r) => ({ key: r.id ?? "system", name: r.name, sub: `${r.calls} calls`, tokens: r.tokens, usd: r.usd }))
                    : data.byModel.map((r) => ({ key: `${r.provider}-${r.model}`, name: r.model || "Unrecorded model", sub: PROVIDER_NAME[r.provider], tokens: r.tokens, usd: r.usd }))
            }
          />
        </section>

        <section className="ux-card">
          <div className="ux-card-head">
            <div>
              <h2>Heaviest runs</h2>
              <span>This month, by tokens.</span>
            </div>
          </div>
          {data.heaviestRuns.length === 0 ? (
            <p className="dim" style={{ margin: 0 }}>No runs yet this month.</p>
          ) : (
            <ol className="ux-runs">
              {data.heaviestRuns.map((r) => (
                <li key={r.id}>
                  <Link href={`/runs/${r.id}`} className="grow">
                    <b>{r.agent}</b>
                    <span>{fmtWhen(r.started_at, tz)} · {r.status.replace("_", " ")}</span>
                  </Link>
                  <span className="ux-num">{fmtTokens(r.tokens)}</span>
                  <span className="ux-num dim">{fmtUsd(r.usd)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* ---- alerts ---- */}
      <section className="ux-card">
        <div className="ux-card-head">
          <div>
            <h2>Limit alerts</h2>
            <span>Sent to the owner and admins, once per threshold per period.</span>
          </div>
        </div>
        {data.alerts.length === 0 ? (
          <p className="dim" style={{ margin: 0 }}>None so far.</p>
        ) : (
          <ul className="ux-alerts">
            {data.alerts.map((a, i) => (
              <li key={i} className={a.level >= 100 ? "over" : "warn"}>
                <span className="ux-alert-ic">{a.level >= 100 ? <CrossIcon size={12} /> : <AlertIcon size={12} />}</span>
                <span className="grow">
                  <b>{a.name} · {a.level >= 100 ? "limit reached" : "80% of its limit"}</b>
                  <span>{a.period === "day" ? "Daily" : "Monthly"} · {a.detail}</span>
                </span>
                <span className="dim">{fmtWhen(a.at, tz)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <LimitDialog
          initial={editing}
          agents={data.agents}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

async function saveLimit(body: { scope: string; target: string; period: string; maxTokens: number | null; maxUsd: number | null }) {
  const res = await fetch("/api/usage/limits", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "The limit could not be saved.");
}

/** Stacked daily bars in plain SVG: input, output, cached. */
function DailyChart({ rows, dailyLimit }: { rows: { day: string; input: number; output: number; cache: number; usd: number }[]; dailyLimit: number | null }) {
  const W = 1000;
  const H = 220;
  const pad = { l: 46, r: 10, t: 10, b: 26 };
  const totals = rows.map((r) => r.input + r.output + r.cache);
  const max = Math.max(1, ...totals, dailyLimit ?? 0) * 1.1;
  const bw = (W - pad.l - pad.r) / Math.max(1, rows.length);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const empty = totals.every((t) => t === 0);
  return (
    <div className="ux-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Tokens per day">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 4} className="axis" textAnchor="end">{fmtTokens(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = pad.l + i * bw + bw * 0.15;
          const w = bw * 0.7;
          const parts: [number, string][] = [[r.input, "in"], [r.output, "out"], [r.cache, "cache"]];
          let acc = 0;
          return (
            <g key={r.day}>
              <title>{`${r.day}: ${fmtTokens(r.input)} input · ${fmtTokens(r.output)} output · ${fmtTokens(r.cache)} cached · ${fmtUsd(r.usd)}`}</title>
              {parts.map(([v, cls]) => {
                const top = y(acc + v);
                const h = y(acc) - top;
                acc += v;
                return v > 0 ? <rect key={cls} x={x} y={top} width={w} height={Math.max(0.5, h)} className={cls} rx={1.5} /> : null;
              })}
              {(i % Math.ceil(rows.length / 10) === 0 || i === rows.length - 1) && (
                <text x={x + w / 2} y={H - 8} className="axis" textAnchor="middle">{r.day.slice(5).replace("-", "/")}</text>
              )}
            </g>
          );
        })}
        {dailyLimit && <line x1={pad.l} x2={W - pad.r} y1={y(dailyLimit)} y2={y(dailyLimit)} className="limit" />}
      </svg>
      <div className="ux-legend">
        <span><i className="in" /> Input</span>
        <span><i className="out" /> Output</span>
        <span><i className="cache" /> Cached</span>
        {dailyLimit && <span><i className="limit" /> Daily limit</span>}
        {empty && <span className="dim">No usage in this range.</span>}
      </div>
    </div>
  );
}

function Breakdown({ rows }: { rows: { key: string; name: string; href?: string; sub: string; tokens: number; usd: number }[] }) {
  const top = Math.max(1, ...rows.map((r) => r.tokens));
  if (!rows.length) return <p className="dim" style={{ margin: 0 }}>Nothing yet this month.</p>;
  return (
    <ul className="ux-breakdown">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="grow">
            {r.href ? <Link href={r.href}>{r.name}</Link> : <b>{r.name}</b>}
            <span>{r.sub}</span>
          </span>
          <span className="ux-share"><i style={{ width: `${(r.tokens / top) * 100}%` }} /></span>
          <span className="ux-num">{fmtTokens(r.tokens)}</span>
          <span className="ux-num dim">{fmtUsd(r.usd)}</span>
        </li>
      ))}
    </ul>
  );
}

function LimitDialog({
  initial,
  agents,
  onClose,
  onSaved,
}: {
  initial: Partial<LimitStatus>;
  agents: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [scope] = useState(initial.scope ?? "provider");
  const [target, setTarget] = useState(initial.target ?? "anthropic");
  const [period, setPeriod] = useState(initial.period ?? "month");
  const [tokens, setTokens] = useState(initial.max_tokens ? String(initial.max_tokens) : "");
  const [usd, setUsd] = useState(initial.max_usd ? String(initial.max_usd) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const existing = initial.max_tokens != null || initial.max_usd != null;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [busy, onClose]);

  async function save(remove = false) {
    setBusy(true);
    setErr("");
    try {
      if (!target) throw new Error("Choose an agent.");
      if (!remove && !tokens.trim() && !usd.trim()) throw new Error("Enter a token limit, a dollar limit, or both.");
      await saveLimit({
        scope,
        target,
        period,
        maxTokens: remove || !tokens.trim() ? null : Number(tokens),
        maxUsd: remove || !usd.trim() ? null : Number(usd),
      });
      onSaved();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  const title = scope === "provider" ? `${PROVIDER_NAME[target as Provider] ?? target} key` : "An agent";
  return (
    <div className="modal-back" onMouseDown={() => !busy && onClose()}>
      <div className="panel modal ux-modal" role="dialog" aria-modal="true" aria-labelledby="ux-limit-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="eyebrow">{existing ? "Edit limit" : "New limit"}</div>
        <h2 id="ux-limit-title" style={{ margin: "2px 0 6px", fontSize: 18 }}>{title}</h2>
        <p className="help" style={{ marginTop: 0 }}>
          Whichever is reached first applies. At the limit, new model calls {scope === "provider" ? "on this key" : "by this agent"} are refused until the limit is raised or the period turns.
        </p>
        <div className="stack-sm">
          {scope === "agent" && (
            <label className="field">
              <span className="ux-label">Agent</span>
              <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} disabled={existing}>
                <option value="">Choose an agent…</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
          <div className="field">
            <span className="ux-label">Period</span>
            <span className="seg">
              {(["month", "day"] as const).map((p) => (
                <button key={p} type="button" className={`seg-opt ${period === p ? "on" : ""}`} onClick={() => setPeriod(p)} disabled={existing}>
                  {p === "month" ? "Per month" : "Per day"}
                </button>
              ))}
            </span>
          </div>
          <div className="ux-limit-grid">
            <label className="field">
              <span className="ux-label">Tokens <em>— optional</em></span>
              <input className="input mono" type="number" min={1} value={tokens} onChange={(e) => setTokens(e.target.value)} placeholder="e.g. 5000000" />
              <span className="ux-quick">
                {[100_000, 1_000_000, 5_000_000, 20_000_000].map((n) => (
                  <button key={n} type="button" onClick={() => setTokens(String(n))}>{fmtTokens(n)}</button>
                ))}
              </span>
            </label>
            <label className="field">
              <span className="ux-label">Dollars <em>— optional</em></span>
              <input className="input mono" type="number" min={0.01} step="0.01" value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="e.g. 250" />
              <span className="ux-quick">
                {[10, 50, 250, 1000].map((n) => (
                  <button key={n} type="button" onClick={() => setUsd(String(n))}>${n}</button>
                ))}
              </span>
            </label>
          </div>
        </div>
        {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
        <div className="panel-foot">
          {existing ? (
            <button className="btn btn-danger" onClick={() => save(true)} disabled={busy}><TrashIcon size={12} /> Remove limit</button>
          ) : (
            <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          )}
          <button className="btn btn-primary" onClick={() => save(false)} disabled={busy}>
            {busy ? "Saving…" : <><CheckIcon size={13} /> Save limit</>}
          </button>
        </div>
      </div>
    </div>
  );
}
