"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Pagination from "@/components/Pagination";
import { ago, duration, money, statusOf, tokensText, TRIGGER } from "./run-meta";

type Row = {
  id: string;
  status: string;
  trigger: string;
  trigger_kind: string;
  started_at: string;
  ended_at: string | null;
  input: string;
  version: number | null;
  agent_id: string;
  agent_name: string;
  started_by_name: string | null;
  cost_usd: number;
  tokens: number;
  dry_run: boolean;
  steps: number;
  waiting: number;
  stuck: boolean;
};
type Summary = {
  total: number; running: number; stuck: number; waiting: number; failed: number; rejected: number; completed: number;
  cost: number; avg_seconds: number; agents: { id: string; name: string; n: number }[];
};

const PERIODS = [
  { v: 1, label: "Last 24 hours" },
  { v: 7, label: "Last 7 days" },
  { v: 30, label: "Last 30 days" },
  { v: 90, label: "Last 90 days" },
  { v: 0, label: "All time" },
];

export default function RunsList() {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [trigger, setTrigger] = useState("");
  const [agent, setAgent] = useState("");
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);
  useEffect(() => setPage(1), [debounced, status, trigger, agent, days, pageSize]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ q: debounced, status, trigger, agent, days: String(days), page: String(page), pageSize: String(pageSize), summary: "1" });
      const res = await fetch(`/api/runs/list?${qs}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Runs could not be loaded.");
      if (mine !== seq.current) return;
      setRows(j.runs);
      setTotal(j.total);
      setSummary(j.summary);
      setError("");
    } catch (e: any) {
      if (mine === seq.current) setError(e.message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [debounced, status, trigger, agent, days, page, pageSize]);
  useEffect(() => {
    load();
  }, [load]);
  // Keep live runs live: refresh while anything on screen is still running.
  useEffect(() => {
    if (!rows.some((r) => r.status === "running" && !r.stuck)) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [rows, load]);

  const chips = useMemo(() => {
    const list: { label: string; clear: () => void }[] = [];
    if (debounced) list.push({ label: `“${debounced}”`, clear: () => setTerm("") });
    if (status) list.push({ label: statusOf(status === "stuck" ? "running" : status, status === "stuck").label, clear: () => setStatus("") });
    if (trigger) list.push({ label: TRIGGER[trigger] ?? trigger, clear: () => setTrigger("") });
    if (agent) list.push({ label: summary?.agents.find((a) => a.id === agent)?.name ?? "Agent", clear: () => setAgent("") });
    return list;
  }, [debounced, status, trigger, agent, summary]);
  const clearAll = () => {
    setTerm("");
    setStatus("");
    setTrigger("");
    setAgent("");
  };

  const shortcuts: { key: string; label: string; value: number; tone?: string }[] = summary
    ? [
        { key: "running", label: "Running now", value: summary.running },
        { key: "awaiting_approval", label: "Waiting for approval", value: summary.waiting, tone: summary.waiting ? "warn" : "" },
        { key: "failed", label: "Failed", value: summary.failed, tone: summary.failed ? "warn" : "" },
        { key: "completed", label: "Succeeded", value: summary.completed, tone: "ok" },
        ...(summary.stuck ? [{ key: "stuck", label: "Stopped responding", value: summary.stuck, tone: "warn" }] : []),
      ]
    : [];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const periodLabel = PERIODS.find((p) => p.v === days)?.label.toLowerCase() ?? "";

  return (
    <div className="page rn">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Runs</h1>
          <p className="sub" style={{ maxWidth: "none" }}>
            Every time an agent ran — what it was asked, what it did step by step, what it produced, and what it cost.
          </p>
        </div>
      </header>

      <div className="al-summary" role="group" aria-label="Run summary">
        {shortcuts.map((s) => (
          <button key={s.key} className={`al-stat ${s.tone ?? ""} ${status === s.key ? "on" : ""}`} onClick={() => setStatus(status === s.key ? "" : s.key)} aria-pressed={status === s.key}>
            <span className="v">{s.key === "running" && s.value > 0 ? <><span className="al-dot live" /> {s.value}</> : s.value}</span>
            <span className="l">{s.label}</span>
          </button>
        ))}
        {summary && (
          <div className="al-stat rn-stat-static">
            <span className="v">{money(summary.cost)}</span>
            <span className="l">Model cost, {periodLabel}{summary.avg_seconds ? ` · avg ${duration(new Date(0).toISOString(), new Date(summary.avg_seconds * 1000).toISOString())}` : ""}</span>
          </div>
        )}
      </div>

      <div className="al-toolbar">
        <div className="al-toolbar-row">
          <input className="input search al-search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by agent or what it was asked" aria-label="Search runs" />
          <select className="select-sm" value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent">
            <option value="">All agents</option>
            {(summary?.agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.n})</option>)}
          </select>
          <select className="select-sm" value={trigger} onChange={(e) => setTrigger(e.target.value)} aria-label="Trigger">
            <option value="">All triggers</option>
            {Object.entries(TRIGGER).filter(([k]) => k !== "other").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            {PERIODS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
          </select>
        </div>
        <div className="al-toolbar-row">
          <span />
          <span className="al-count">
            {total} {total === 1 ? "run" : "runs"}
            {totalPages > 1 && <span className="dim"> · page {page} of {totalPages}</span>}
            {loading && <span className="spin" style={{ marginLeft: 8 }} aria-label="Loading" />}
          </span>
        </div>
        {chips.length > 0 && (
          <div className="al-active">
            {chips.map((c) => (
              <button key={c.label} className="al-chip" onClick={c.clear} aria-label={`Remove filter ${c.label}`}>{c.label} <span aria-hidden="true">×</span></button>
            ))}
            <button className="link-btn" onClick={clearAll}>Clear all</button>
          </div>
        )}
      </div>

      {error ? (
        <div className="error">{error}</div>
      ) : !loading && total === 0 ? (
        <div className="empty">
          <h3>{chips.length ? "Nothing matches" : "No runs in this period"}</h3>
          <p>{chips.length ? "No run matches those filters." : <>Run an agent from <Link href="/agents">Agents</Link> and it appears here.</>}</p>
          {chips.length > 0 && <button className="btn mt-s" onClick={clearAll}>Clear all filters</button>}
        </div>
      ) : (
        <div className="al-table rn-table" role="table" aria-busy={loading}>
          <div className="al-row al-head" role="row">
            <div>Run</div>
            <div>Status</div>
            <div>Started</div>
            <div>Trigger</div>
            <div>Took</div>
            <div>Cost</div>
          </div>
          {rows.map((r) => {
            const s = statusOf(r.status, r.stuck);
            return (
              <div
                key={r.id}
                className={`al-row ${r.stuck ? "rn-stuck" : ""}`}
                role="row"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a, button")) return;
                  router.push(`/runs/${r.id}`);
                }}
              >
                <div className="al-main">
                  <Link href={`/runs/${r.id}`} className="al-name" title={r.agent_name}>{r.agent_name}</Link>
                  <div className="al-desc" title={r.input || undefined}>{r.input || <span className="dim">No task text — it ran from its instructions</span>}</div>
                </div>
                <div>
                  <span className="al-lastrun"><span className={`al-dot ${s.dot}`} /><span className="al-small">{s.label}</span></span>
                  {r.waiting > 0 && <Link href="/approvals" className="al-waiting">{r.waiting} waiting</Link>}
                </div>
                <div className="al-small" title={new Date(r.started_at).toLocaleString()}>
                  {ago(r.started_at)}
                  <div className="dim">{new Date(r.started_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                </div>
                <div className="al-small">
                  {TRIGGER[r.trigger_kind] ?? r.trigger}
                  {r.started_by_name && r.trigger_kind === "manual" && <div className="dim">{r.started_by_name}</div>}
                  {r.trigger_kind !== "manual" && r.version != null && <div className="dim">v{r.version}</div>}
                </div>
                <div className="al-small">
                  {r.status === "running" && !r.stuck ? <span className="dim">{duration(r.started_at)} so far</span> : r.ended_at ? duration(r.started_at, r.ended_at) : "—"}
                  <div className="dim">{r.steps} {r.steps === 1 ? "step" : "steps"}</div>
                </div>
                <div className="al-small">
                  {money(r.cost_usd)}
                  {r.tokens > 0 && <div className="dim">{tokensText(r.tokens)} tokens</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {total > 0 && (
        <Pagination currentPage={page} totalItems={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} pageSizeOptions={[10, 25, 50, 100]} itemLabel="run" itemLabelPlural="runs" />
      )}
    </div>
  );
}
