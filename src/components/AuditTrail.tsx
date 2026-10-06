"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertIcon, ArrowRightIcon, BookIcon, CopyIcon, CrossIcon, DocIcon, ExportIcon, GridIcon, PlugIcon, RunIcon,
  SearchIcon, ShieldIcon, SparkIcon, TrashIcon, WrenchIcon,
} from "@/components/agent-ui";
import type { AuditEvent, AuditSummary } from "@/lib/audit-report";

type Filters = { q: string; category: string; actor: string; flag: string; days: number };
const DEFAULTS: Filters = { q: "", category: "", actor: "", flag: "", days: 30 };

const CATEGORIES: { key: string; label: string }[] = [
  { key: "agents", label: "Agents" },
  { key: "runs", label: "Runs" },
  { key: "skills", label: "Skills" },
  { key: "connections", label: "Connections" },
  { key: "access", label: "People & access" },
  { key: "workspace", label: "Workspace & limits" },
  { key: "apps", label: "Apps" },
];
const CATEGORY_OF: Record<string, string> = {
  agent: "agents", run: "runs", cfo_run: "runs", skill: "skills", connection: "connections",
  user: "access", org: "workspace", usage_limit: "workspace", document: "workspace", app: "apps",
};
const ENTITY_LABEL: Record<string, string> = {
  agent: "Agent", run: "Run", cfo_run: "CFO run", skill: "Skill", connection: "Connection", user: "Member",
  org: "Workspace", usage_limit: "Usage limit", document: "Document", app: "App",
};
const PERIODS = [
  { v: 1, label: "Last 24 hours" },
  { v: 7, label: "Last 7 days" },
  { v: 30, label: "Last 30 days" },
  { v: 90, label: "Last 90 days" },
  { v: 0, label: "All time" },
];

function CategoryIcon({ entity, size = 14 }: { entity: string; size?: number }) {
  const c = CATEGORY_OF[entity];
  if (entity === "document") return <DocIcon size={size} />;
  if (c === "agents") return <SparkIcon size={size} />;
  if (c === "runs") return <RunIcon size={size} />;
  if (c === "skills") return <BookIcon size={size} />;
  if (c === "connections") return <PlugIcon size={size} />;
  if (c === "access") return <ShieldIcon size={size} />;
  if (c === "apps") return <GridIcon size={size} />;
  return <WrenchIcon size={size} />;
}

/** Older events used code-style names; show them as the rest read. */
const LEGACY_ACTION: Record<string, string> = { "app.create": "Created app", "app.update": "Updated app", "app.delete": "Deleted app" };
export const actionText = (a: string) => LEGACY_ACTION[a] ?? a;

const KEY_LABEL: Record<string, string> = {
  name: "Name", label: "Label", version: "Version", input: "Input", agentId: "Agent", kind: "Type", scopes: "Scopes",
  role: "Role", email: "Email", member: "Member", capUsd: "Monthly cap (USD)", runsRemoved: "Runs removed",
  strategy: "Strategy", workerCount: "Workers", url: "Address", category: "Category", archetype: "Archetype",
  framework: "Framework", toolsCount: "Tools", hasSource: "Source included", requestId: "Request ID",
  requestedBy: "Requested by", reason: "Reason", note: "Note", maxTokens: "Token limit", maxUsd: "Dollar limit",
  scope: "Applies to", target: "Target", period: "Period", detail: "Detail", secretReplaced: "Secret replaced",
  bytes: "Size", invitedBy: "Invited by", provider: "Provider", uploads: "Uploads", agent: "Agent",
  attachedToAgentId: "Attached to agent",
};
const humanKey = (k: string) => KEY_LABEL[k] ?? k.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

function humanValue(k: string, v: any): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (k === "bytes" && typeof v === "number") return v >= 1e6 ? `${(v / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(v / 1e3))} KB`;
  if (k === "maxUsd" || k === "capUsd") return `$${Number(v).toLocaleString("en-US")}`;
  if (k === "maxTokens" && typeof v === "number") return v.toLocaleString("en-US");
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ") : "None";
  if (typeof v === "object") return Object.entries(v).map(([a, b]) => `${humanKey(a)}: ${Array.isArray(b) ? b.join(", ") : typeof b === "object" ? JSON.stringify(b) : b}`).join("\n");
  return String(v);
}

/** One or two facts worth seeing in the list without opening the event. */
function factsOf(e: AuditEvent): string[] {
  const d = e.detail || {};
  const out: string[] = [];
  if (d.version != null) out.push(`version ${d.version}`);
  if (typeof d.input === "string" && d.input.trim()) out.push(`“${d.input.trim().slice(0, 70)}${d.input.length > 70 ? "…" : ""}”`);
  if (d.role) out.push(`as ${d.role}`);
  if (d.email && e.target !== d.email) out.push(d.email);
  if (d.kind) out.push(String(d.kind));
  if (d.runsRemoved) out.push(`${d.runsRemoved} ${d.runsRemoved === 1 ? "run" : "runs"} removed`);
  if (d.reason) out.push(`reason: ${String(d.reason).slice(0, 60)}`);
  if (d.maxTokens || d.maxUsd) out.push([d.maxTokens ? `${Number(d.maxTokens).toLocaleString("en-US")} tokens` : "", d.maxUsd ? `$${d.maxUsd}` : ""].filter(Boolean).join(" or "));
  if (d.framework) out.push(String(d.framework));
  return out.slice(0, 2);
}

const initials = (n: string) =>
  n.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";

type Row = { key: string; first: AuditEvent; events: AuditEvent[] };

/** Autosaves while someone edits: folded together however they interleave. */
const EDIT_ACTIONS = new Set(["Saved draft", "Updated Multi-Agent Swarm Configuration", "Edited skill", "Edited connection"]);
const foldKey = (e: AuditEvent) => (EDIT_ACTIONS.has(e.action) ? "edit" : e.action);
/** What a folded row says it was. */
function rowTitle(r: Row) {
  const acts = new Set(r.events.map((e) => e.action));
  if (acts.size === 1) return actionText(r.first.action);
  return r.first.entity === "agent" ? "Edited draft" : `Edited ${(ENTITY_LABEL[r.first.entity] ?? "item").toLowerCase()}`;
}
/** Sign-ins are routine: counted under access, but not flagged row by row. */
const flagged = (e: AuditEvent) => e.security && e.action !== "Signed in";
const failed = (e: AuditEvent) => /failed|refused/i.test(e.action);
const LINKABLE = ["agent", "run", "skill", "connection", "app"];

/** Folds back-to-back repeats (the same person saving the same draft) into one row. */
function fold(events: AuditEvent[], dayOf: (iso: string) => string): Row[] {
  const rows: Row[] = [];
  for (const e of events) {
    const prev = rows[rows.length - 1];
    if (
      prev && prev.first.actor_name === e.actor_name && foldKey(prev.first) === foldKey(e) && prev.first.entity_id === e.entity_id &&
      !!e.entity_id && dayOf(prev.first.at) === dayOf(e.at) && !e.destructive && !e.security
    ) {
      prev.events.push(e);
    } else {
      rows.push({ key: e.id, first: e, events: [e] });
    }
  }
  return rows;
}

function readUrl(): Filters {
  if (typeof window === "undefined") return DEFAULTS;
  const sp = new URLSearchParams(window.location.search);
  const days = Number(sp.get("days") ?? DEFAULTS.days);
  return {
    q: sp.get("q") ?? "",
    category: sp.get("category") ?? "",
    actor: sp.get("actor") ?? "",
    flag: sp.get("flag") ?? "",
    days: PERIODS.some((p) => p.v === days) ? days : DEFAULTS.days,
  };
}
const toQuery = (f: Filters) => {
  const sp = new URLSearchParams();
  if (f.q.trim()) sp.set("q", f.q.trim());
  if (f.category) sp.set("category", f.category);
  if (f.actor) sp.set("actor", f.actor);
  if (f.flag) sp.set("flag", f.flag);
  sp.set("days", String(f.days));
  return sp.toString();
};

export default function AuditTrail() {
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [search, setSearch] = useState("");
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [tz, setTz] = useState("UTC");
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Row | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const f = readUrl();
    setFilters(f);
    setSearch(f.q);
    setReady(true);
  }, []);

  // Search waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), 250);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async (f: Filters) => {
    const id = ++reqId.current;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/audit?${toQuery(f)}&summary=1`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The audit trail could not be loaded.");
      if (id !== reqId.current) return;
      setEvents(j.events);
      setCursor(j.nextCursor);
      setSummary(j.summary);
      setTz(j.timezone || "UTC");
    } catch (e: any) {
      if (id === reqId.current) setError(e.message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.history.replaceState(null, "", `${window.location.pathname}?${toQuery(filters)}`);
    load(filters);
  }, [filters, ready, load]);

  async function loadMore() {
    if (!cursor) return;
    setMore(true);
    try {
      const res = await fetch(`/api/audit?${toQuery(filters)}&cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" });
      const j = await res.json();
      if (res.ok) {
        setEvents((ev) => [...ev, ...j.events]);
        setCursor(j.nextCursor);
      }
    } finally {
      setMore(false);
    }
  }

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = !!(filters.q || filters.category || filters.actor || filters.flag);

  const dayKey = useMemo(() => {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    return (iso: string) => f.format(new Date(iso));
  }, [tz]);
  const timeOf = useMemo(() => {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
    return (iso: string) => f.format(new Date(iso));
  }, [tz]);
  const dayTitle = useMemo(() => {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return (key: string, iso: string) => {
      const today = dayKey(new Date().toISOString());
      const yesterday = dayKey(new Date(Date.now() - 864e5).toISOString());
      const label = f.format(new Date(iso));
      return key === today ? `Today · ${label}` : key === yesterday ? `Yesterday · ${label}` : label;
    };
  }, [tz, dayKey]);

  const days = useMemo(() => {
    const groups: { key: string; iso: string; rows: Row[]; count: number }[] = [];
    for (const e of events) {
      const k = dayKey(e.at);
      let g = groups[groups.length - 1];
      if (!g || g.key !== k) groups.push((g = { key: k, iso: e.at, rows: [], count: 0 }));
      g.count++;
      g.rows.push({ key: e.id, first: e, events: [e] });
    }
    for (const g of groups) g.rows = fold(g.rows.map((r) => r.first), dayKey);
    return groups;
  }, [events, dayKey]);

  const periodLabel = PERIODS.find((p) => p.v === filters.days)?.label.toLowerCase() ?? "";

  return (
    <div className="page au">
      <header className="page-head">
        <div>
          <div className="eyebrow">Governance</div>
          <h1>Audit trail</h1>
          <p className="sub" style={{ maxWidth: "none" }}>
            Who did what, and when: every change to agents, skills and connections, every run, publish, approval and sign-in.
            Append-only — nothing here can be edited or removed.
          </p>
        </div>
        <a className="btn" href={`/api/audit?${toQuery(filters)}&format=csv`}>
          <ExportIcon size={13} /> Export {filtered ? "filtered " : ""}CSV
        </a>
      </header>

      {/* ---- the period at a glance ---- */}
      <div className="au-stats">
        <div className="au-stat">
          <span className="v">{summary ? summary.total.toLocaleString("en-US") : "—"}</span>
          <span className="l">Events, {periodLabel}</span>
        </div>
        <div className="au-stat">
          <span className="v">{summary?.people ?? "—"}</span>
          <span className="l">People active</span>
        </div>
        <div className="au-stat">
          <span className="v">{summary?.publishes ?? "—"}</span>
          <span className="l">Agents published</span>
        </div>
        <button className={`au-stat btn-like danger ${filters.flag === "destructive" ? "on" : ""}`} onClick={() => set({ flag: filters.flag === "destructive" ? "" : "destructive" })}>
          <span className="v">{summary?.destructive ?? "—"}</span>
          <span className="l">Deletions &amp; removals</span>
        </button>
        <button className={`au-stat btn-like warn ${filters.flag === "security" ? "on" : ""}`} onClick={() => set({ flag: filters.flag === "security" ? "" : "security" })}>
          <span className="v">{summary?.security ?? "—"}</span>
          <span className="l">
            Access &amp; security
            {summary && summary.failedChecks > 0 && <em> · {summary.failedChecks} failed</em>}
          </span>
        </button>
      </div>

      {/* ---- filters ---- */}
      <div className="au-toolbar">
        <label className="au-search">
          <SearchIcon size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search actions, people, agents, details…" aria-label="Search the audit trail" />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search"><CrossIcon size={11} /></button>
          )}
        </label>
        <select className="select-sm" value={filters.actor} onChange={(e) => set({ actor: e.target.value })} aria-label="Person">
          <option value="">Everyone</option>
          {(summary?.actors ?? []).map((a) => (
            <option key={a.key} value={a.key}>{a.name}{a.system ? " (system)" : ""} · {a.count}</option>
          ))}
          {filters.actor && !(summary?.actors ?? []).some((a) => a.key === filters.actor) && <option value={filters.actor}>Selected person</option>}
        </select>
        <select className="select-sm" value={filters.days} onChange={(e) => set({ days: Number(e.target.value) })} aria-label="Period">
          {PERIODS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
        </select>
      </div>
      <div className="au-chips">
        <button className={`au-chip ${!filters.category ? "on" : ""}`} onClick={() => set({ category: "" })}>
          All <span>{summary?.total ?? ""}</span>
        </button>
        {CATEGORIES.map((c) => {
          const n = summary?.categories?.[c.key] ?? 0;
          if (!n && filters.category !== c.key) return null;
          return (
            <button key={c.key} className={`au-chip cat-${c.key} ${filters.category === c.key ? "on" : ""}`} onClick={() => set({ category: filters.category === c.key ? "" : c.key })}>
              {c.label} <span>{n}</span>
            </button>
          );
        })}
        {filtered && (
          <button className="au-clear" onClick={() => { setSearch(""); setFilters({ ...DEFAULTS, days: filters.days }); }}>
            Clear filters
          </button>
        )}
      </div>

      {/* ---- the timeline ---- */}
      {error ? (
        <div className="error">{error}</div>
      ) : loading && !events.length ? (
        <div className="au-day">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="au-row skeleton" />)}
        </div>
      ) : !events.length ? (
        <div className="au-empty">
          <h3>{filtered ? "Nothing matches these filters" : "No events in this period"}</h3>
          <p>{filtered ? "Try a wider period, or clear the filters." : "Build, run or publish an agent and it lands here."}</p>
          {filtered && <button className="btn btn-sm" onClick={() => { setSearch(""); setFilters({ ...DEFAULTS, days: filters.days }); }}>Clear filters</button>}
        </div>
      ) : (
        <div className={loading ? "au-loading" : ""}>
          {days.map((g) => (
            <section key={g.key} className="au-day">
              <h2 className="au-day-head">
                <span>{dayTitle(g.key, g.iso)}</span>
                <em>{g.count} {g.count === 1 ? "event" : "events"}</em>
              </h2>
              {g.rows.map((r) => (
                <EventRow key={r.key} row={r} time={timeOf} onOpen={() => setOpen(r)} />
              ))}
            </section>
          ))}
          <div className="au-foot">
            <span className="dim">Showing {events.length.toLocaleString("en-US")} {events.length === 1 ? "event" : "events"} · times in {tz}</span>
            {cursor && (
              <button className="btn btn-sm" onClick={loadMore} disabled={more}>{more ? "Loading…" : "Load older events"}</button>
            )}
          </div>
        </div>
      )}

      {open && <EventDrawer row={open} tz={tz} onClose={() => setOpen(null)} onFilterActor={(key) => { setOpen(null); set({ actor: key }); }} />}
    </div>
  );
}

function EventRow({ row, time, onOpen }: { row: Row; time: (iso: string) => string; onOpen: () => void }) {
  const e = row.first;
  const n = row.events.length;
  const facts = factsOf(e);
  const cat = CATEGORY_OF[e.entity] ?? "workspace";
  const oldest = row.events[n - 1];
  return (
    <div className={`au-row ${e.destructive ? "destructive" : ""} ${flagged(e) ? "security" : ""}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(k) => (k.key === "Enter" || k.key === " ") && (k.preventDefault(), onOpen())}>
      <span className="au-time">{n > 1 ? `${time(oldest.at)}–${time(e.at)}` : time(e.at)}</span>
      <span className={`au-ic cat-${cat}`}>
        {e.destructive ? <TrashIcon size={13} /> : failed(e) ? <AlertIcon size={13} /> : <CategoryIcon entity={e.entity} size={13} />}
      </span>
      <span className="au-main">
        <span className="au-line">
          <b>{rowTitle(row)}</b>
          {e.target && (
            e.href ? (
              <Link href={e.href} className="au-target" onClick={(x) => x.stopPropagation()}>{e.target}</Link>
            ) : e.entity_id && LINKABLE.includes(e.entity) ? (
              <span className="au-target gone" title="No longer in the workspace">{e.target}</span>
            ) : (
              <span className="au-target plain">{e.target}</span>
            )
          )}
          {n > 1 && <span className="au-times">×{n}</span>}
          {e.destructive && <span className="au-tag danger">Removal</span>}
          {flagged(e) && <span className={`au-tag ${failed(e) ? "danger" : "warn"}`}>{failed(e) ? "Failed check" : "Access"}</span>}
        </span>
        <span className="au-sub">
          <span className={`au-avatar ${e.actor_id ? "" : "system"}`}>{e.actor_id ? initials(e.actor_name) : "⚙"}</span>
          <span className="au-actor">{e.actor_name}</span>
          <span className="au-dot">·</span>
          <span>{ENTITY_LABEL[e.entity] ?? e.entity}</span>
          {facts.map((f, i) => (
            <span key={i} className="au-fact"><span className="au-dot">·</span>{f}</span>
          ))}
        </span>
      </span>
      <span className="au-go" aria-hidden="true"><ArrowRightIcon size={13} /></span>
    </div>
  );
}

function EventDrawer({ row, tz, onClose, onFilterActor }: { row: Row; tz: string; onClose: () => void; onFilterActor: (key: string) => void }) {
  const e = row.first;
  const [history, setHistory] = useState<AuditEvent[] | null>(null);
  const historyRows = useMemo(() => (history ? fold(history, (iso) => iso.slice(0, 10)).slice(0, 10) : null), [history]);
  const [copied, setCopied] = useState("");
  const [allTimes, setAllTimes] = useState(false);

  useEffect(() => {
    const esc = (k: KeyboardEvent) => k.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  useEffect(() => {
    setHistory(null);
    if (!e.entity_id) return setHistory([]);
    fetch(`/api/audit?days=0&limit=120&entity=${encodeURIComponent(e.entity)}&entityId=${encodeURIComponent(e.entity_id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setHistory((j.events ?? []).filter((x: AuditEvent) => !row.events.some((r) => r.id === x.id))))
      .catch(() => setHistory([]));
  }, [e.id, e.entity, e.entity_id, row.events]);

  const full = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const short = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const fields = Object.entries(e.detail || {}).filter(([k, v]) => v !== "" && v != null && !(Array.isArray(v) && !v.length) && k !== "name" && k !== "label");
  const actorKey = e.actor_id ?? `name:${e.actor_name}`;
  const copy = (label: string, v: string) => {
    navigator.clipboard?.writeText(v).then(() => { setCopied(label); setTimeout(() => setCopied(""), 1400); }).catch(() => {});
  };
  const cat = CATEGORY_OF[e.entity] ?? "workspace";

  return (
    <div className="au-drawer-back" onMouseDown={onClose}>
      <aside className="au-drawer" role="dialog" aria-modal="true" aria-labelledby="au-drawer-title" onMouseDown={(x) => x.stopPropagation()}>
        <div className="au-drawer-head">
          <span className={`au-ic lg cat-${cat} ${e.destructive ? "destructive" : ""}`}>
            {e.destructive ? <TrashIcon size={16} /> : <CategoryIcon entity={e.entity} size={16} />}
          </span>
          <div className="grow">
            <div className="eyebrow">{ENTITY_LABEL[e.entity] ?? e.entity}{row.events.length > 1 ? ` · ${row.events.length} saves` : ""}</div>
            <h2 id="au-drawer-title">{rowTitle(row)}</h2>
            {e.target && <div className="au-drawer-target">{e.target}</div>}
          </div>
          <button className="au-close" onClick={onClose} aria-label="Close"><CrossIcon size={13} /></button>
        </div>

        <div className="au-drawer-body">
          <dl className="au-kv">
            <dt>When</dt>
            <dd>
              {full.format(new Date(e.at))} <span className="dim">({tz})</span>
              <div className="dim mono au-utc">{e.at.replace("T", " ").replace(/\.\d+Z$/, " UTC")}</div>
            </dd>
            <dt>Who</dt>
            <dd>
              <span className="au-who">
                <span className={`au-avatar ${e.actor_id ? "" : "system"}`}>{e.actor_id ? initials(e.actor_name) : "⚙"}</span>
                <span>{e.actor_name}{!e.actor_id && <span className="dim"> · system</span>}</span>
              </span>
              <div><button className="au-link" onClick={() => onFilterActor(actorKey)}>Show everything by this person</button></div>
            </dd>
            <dt>About</dt>
            <dd>
              {ENTITY_LABEL[e.entity] ?? e.entity}{e.target ? ` · ${e.target}` : ""}
              {e.href ? (
                <div><Link className="au-link" href={e.href}>Open {(ENTITY_LABEL[e.entity] ?? "it").toLowerCase()} <ArrowRightIcon size={11} /></Link></div>
              ) : e.entity_id && ["agent", "run", "skill", "connection", "app"].includes(e.entity) ? (
                <div className="dim">No longer in the workspace.</div>
              ) : null}
            </dd>
          </dl>

          {row.events.length > 1 && (
            <section className="au-sec">
              <h3>Each save · {row.events.length}</h3>
              <ul className="au-times-list">
                {(allTimes ? row.events : row.events.slice(0, 12)).map((x) => (
                  <li key={x.id} title={actionText(x.action)}>
                    <span className="mono">{clock.format(new Date(x.at))}</span>
                    {x.action !== "Saved draft" && <em>{x.action === "Updated Multi-Agent Swarm Configuration" ? "Team setup" : actionText(x.action)}</em>}
                  </li>
                ))}
              </ul>
              {row.events.length > 12 && !allTimes && <button className="au-link" onClick={() => setAllTimes(true)}>Show all {row.events.length}</button>}
            </section>
          )}

          <section className="au-sec">
            <h3>Details</h3>
            {fields.length ? (
              <dl className="au-kv">
                {fields.map(([k, v]) => (
                  <div key={k} className="au-kv-row">
                    <dt>{humanKey(k)}</dt>
                    <dd className={/id$/i.test(k) ? "mono" : ""} style={{ whiteSpace: "pre-wrap" }}>{humanValue(k, v)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="dim" style={{ margin: 0 }}>Nothing further was recorded.</p>
            )}
          </section>

          <section className="au-sec">
            <h3>Earlier on this {(ENTITY_LABEL[e.entity] ?? "item").toLowerCase()}</h3>
            {historyRows === null ? (
              <p className="dim" style={{ margin: 0 }}>Loading…</p>
            ) : !historyRows.length ? (
              <p className="dim" style={{ margin: 0 }}>No other events.</p>
            ) : (
              <ol className="au-history">
                {historyRows.map((h) => (
                  <li key={h.key} className={h.first.destructive ? "destructive" : ""}>
                    <b>{rowTitle(h)}{h.events.length > 1 && <span className="au-times">×{h.events.length}</span>}</b>
                    <span>{h.first.actor_name} · {short.format(new Date(h.first.at))}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="au-sec au-record">
            <h3>Record</h3>
            <div className="au-ids">
              <button onClick={() => copy("event", e.id)} title="Copy">
                <span>Event</span><code>#{e.id}</code><CopyIcon size={11} />{copied === "event" && <em>Copied</em>}
              </button>
              {e.entity_id && (
                <button onClick={() => copy("entity", e.entity_id!)} title="Copy">
                  <span>{ENTITY_LABEL[e.entity] ?? "Item"} ID</span><code>{e.entity_id}</code><CopyIcon size={11} />{copied === "entity" && <em>Copied</em>}
                </button>
              )}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
