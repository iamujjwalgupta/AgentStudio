"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatWhen } from "@/lib/format";
import ExportAgentModal from "@/components/ExportAgentModal";
import Pagination from "@/components/Pagination";
import type { AgentListFacets, AgentListPage, AgentListSummary, AgentRow } from "@/lib/agent-list";
import { canDeleteAgent, deleteDeniedReason, type DeleteActor } from "@/lib/agent-perms";
import {
  ArchiveIcon, ChatIcon, DomainTags, EyeIcon, ExportIcon, GridIcon, LayersIcon, ListIcon, MoreIcon, RestoreIcon, RunIcon, ShareIcon, TrashIcon,
  processColour,
} from "@/components/agent-ui";

export type { AgentRow };

// Formatted in the workspace timezone so the server and the browser agree.
const when = (v: string | null | undefined, tz: string) => formatWhen(v ?? null, tz);

type View = "list" | "grid" | "process";
const STORE_KEY = "agent-studio.agents.view";
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const TYPES = ["analyst", "author", "operator", "sentinel"];
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const statusOf = (a: { status: string; published_ver: number | null }) =>
  a.status === "retired"
    ? { cls: "grey", label: "Retired" }
    : a.status === "published"
      ? { cls: "green", label: `v${a.published_ver} live` }
      : { cls: "grey", label: "Draft" };

const RUN_STATE: Record<string, { label: string; cls: string }> = {
  completed: { label: "Succeeded", cls: "ok" },
  failed: { label: "Failed", cls: "bad" },
  rejected: { label: "Finished without a rejected action", cls: "bad" },
  running: { label: "Running", cls: "live" },
  awaiting_approval: { label: "Waiting for approval", cls: "wait" },
};

function LastRun({ a, tz }: { a: AgentRow; tz: string }) {
  if (!a.last_run_at) return null;
  const s = RUN_STATE[a.last_run_status ?? ""] ?? { label: a.last_run_status ?? "", cls: "" };
  return (
    <span className="al-lastrun" title={`${s.label} · ${a.run_count} ${a.run_count === 1 ? "run" : "runs"} in total`}>
      <span className={`al-dot ${s.cls}`} />
      <span className="al-small">{when(a.last_run_at, tz)}</span>
    </span>
  );
}

export default function AgentList({
  initial,
  me,
  timezone,
}: {
  /** The first page, rendered on the server with the default filters. */
  initial: AgentListPage;
  /** Who is looking, for who may delete what (lib/agent-perms). */
  me: DeleteActor;
  timezone: string;
}) {
  // Starts on the list so the first paint matches the server render; the stored
  // preference is applied after mount.
  const [view, setView] = useState<View>("list");
  const [target, setTarget] = useState<AgentRow | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState("");

  // Filters. Search waits for a pause in typing so each keystroke is not a request.
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [archetype, setArchetype] = useState("all");
  const [status, setStatus] = useState("all");
  const [industry, setIndustry] = useState("");
  const [process, setProcess] = useState("");
  const [flag, setFlag] = useState("");
  const [sort, setSort] = useState("updated");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initial.pageSize);

  const [data, setData] = useState<AgentListPage>(initial);
  const [summary, setSummary] = useState<AgentListSummary>(initial.summary!);
  const [facets, setFacets] = useState<AgentListFacets>(initial.facets!);
  const [loading, setLoading] = useState(false);

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);

  const [shareOf, setShareOf] = useState<AgentRow | null>(null);
  const [exportOf, setExportOf] = useState<AgentRow | null>(null);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState("");
  const [shareErr, setShareErr] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedTerm(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved === "grid" || saved === "list" || saved === "process") setView(saved);
    } catch {
      /* private windows and blocked site data are fine — the default stands */
    }
  }, []);

  // ---- data --------------------------------------------------------------------
  // The server filters, sorts and pages; only the rows on screen come back. The
  // summary and filter counts come back only when asked for (first load, after a change).
  const seq = useRef(0);
  const fetchPage = useCallback(
    async (p: number, withMeta = false) => {
      const mine = ++seq.current;
      setLoading(true);
      try {
        const qs = new URLSearchParams({
          q: debouncedTerm,
          archetype,
          status,
          industry,
          process,
          flag,
          sort,
          page: String(p),
          pageSize: String(pageSize),
          meta: withMeta ? "1" : "0",
        });
        const res = await fetch(`/api/agents/list?${qs}`, { cache: "no-store" });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "Agents could not be loaded.");
        if (mine !== seq.current) return; // overtaken by a newer request
        setData(j);
        if (j.summary) setSummary(j.summary);
        if (j.facets) setFacets(j.facets);
      } catch (e: any) {
        if (mine === seq.current) setError(e.message);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [debouncedTerm, archetype, status, industry, process, flag, sort, pageSize],
  );

  // A new search, filter, sort or page size starts again at page 1.
  const filterKey = `${debouncedTerm}|${archetype}|${status}|${industry}|${process}|${flag}|${sort}|${pageSize}`;
  const lastKey = useRef(filterKey);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false; // the server already rendered page 1 with these defaults
      return;
    }
    if (lastKey.current !== filterKey) {
      lastKey.current = filterKey;
      if (page !== 1) {
        setPage(1); // the page change re-runs this effect, which fetches page 1
        return;
      }
    }
    fetchPage(page);
  }, [filterKey, page, fetchPage]);

  /** Re-reads the current page and the counts after something changed an agent. */
  const reload = () => fetchPage(page, true);

  // ---- menus, dialogs, keyboard ---------------------------------------------------
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (target) close();
      else if (shareOf) closeShare();
      else if (menuFor) setMenuFor(null);
      else if (peekId) setPeekId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function choose(next: View) {
    setView(next);
    try {
      localStorage.setItem(STORE_KEY, next);
    } catch {
      /* the choice still applies for this visit */
    }
  }

  function ask(a: AgentRow) {
    setMenuFor(null);
    setTarget(a);
    setPassword("");
    setError("");
  }

  function askShare(a: AgentRow) {
    setMenuFor(null);
    setShareOf(a);
    setEmail("");
    setNote("");
    setSent("");
    setShareErr("");
  }

  function closeShare() {
    setShareOf(null);
    setEmail("");
    setNote("");
    setSent("");
    setShareErr("");
  }

  async function send() {
    if (!shareOf || !email.trim()) {
      setShareErr("Enter the person's email address.");
      return;
    }
    setBusy(true);
    setShareErr("");
    try {
      const res = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: shareOf.id, email, note }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The agent could not be shared.");
      setSent(`Sent to ${j.to.name} at ${j.to.org}. It waits there until they accept it.`);
      reload();
    } catch (e: any) {
      setShareErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function setRetired(a: AgentRow, action: "retire" | "restore") {
    setMenuFor(null);
    if (action === "retire" && !confirm(`Retire "${a.name}"? It stops running, on a schedule or by hand. Every version, run and approval it produced is kept, and you can restore it at any time.`)) return;
    setWorking(a.id);
    setError("");
    try {
      const res = await fetch(`/api/agents/${a.id}/retire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "That could not be done.");
      reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setWorking("");
    }
  }

  function close() {
    setTarget(null);
    setPassword("");
    setError("");
  }

  async function confirmDelete() {
    if (!target || !password) {
      setError("Enter your password to confirm.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/agents/${target.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The agent could not be deleted.");
      if (peekId === target.id) setPeekId(null);
      close();
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // ---- summary bar shortcuts -----------------------------------------------------
  type Shortcut = "live" | "drafts" | "scheduled" | "recent" | "awaiting" | "retired";
  const activeShortcut: Shortcut | null =
    flag === "scheduled" ? "scheduled"
      : flag === "recent" ? "recent"
        : flag === "awaiting" ? "awaiting"
          : status === "published" ? "live"
            : status === "draft" ? "drafts"
              : status === "retired" ? "retired"
                : null;

  function shortcut(s: Shortcut) {
    if (activeShortcut === s) {
      setStatus("all");
      setFlag("");
      return;
    }
    const map: Record<Shortcut, [string, string]> = {
      live: ["published", ""],
      drafts: ["draft", ""],
      scheduled: ["all", "scheduled"],
      recent: ["all", "recent"],
      awaiting: ["all", "awaiting"],
      retired: ["retired", ""],
    };
    setStatus(map[s][0]);
    setFlag(map[s][1]);
    if (view === "process") choose("list");
  }

  function clearAll() {
    setTerm("");
    setDebouncedTerm("");
    setArchetype("all");
    setStatus("all");
    setIndustry("");
    setProcess("");
    setFlag("");
  }

  const FLAG_LABEL: Record<string, string> = { scheduled: "Scheduled", recent: "Ran this week", awaiting: "Waiting for approval" };
  const STATUS_LABEL: Record<string, string> = { published: "Live", draft: "Drafts", retired: "Retired", all: "All (incl. retired)" };
  const chips: { label: string; clear: () => void }[] = [
    ...(debouncedTerm ? [{ label: `“${debouncedTerm}”`, clear: () => { setTerm(""); setDebouncedTerm(""); } }] : []),
    ...(archetype !== "all" ? [{ label: cap(archetype), clear: () => setArchetype("all") }] : []),
    ...(industry ? [{ label: industry, clear: () => setIndustry("") }] : []),
    ...(process ? [{ label: process === "other" ? "Other cycles" : process, clear: () => setProcess("") }] : []),
    ...(status !== "all" ? [{ label: STATUS_LABEL[status] ?? status, clear: () => setStatus("all") }] : []),
    ...(flag ? [{ label: FLAG_LABEL[flag] ?? flag, clear: () => setFlag("") }] : []),
  ];

  const total = data.total;
  const totalPages = Math.max(1, Math.ceil(total / data.pageSize));
  const rows = data.agents;
  const typeTotal = TYPES.reduce((n, t) => n + (facets.types[t] ?? 0), 0);

  // ---- row pieces --------------------------------------------------------------
  const openPeek = (e: React.MouseEvent, a: AgentRow) => {
    // Clicks on links and buttons inside the row keep their own meaning.
    if ((e.target as HTMLElement).closest("a, button")) return;
    setPeekId(a.id);
  };

  function moreMenu(a: AgentRow) {
    const open = menuFor === a.id;
    return (
      <div className="al-menu-wrap">
        <button
          className="icon-act"
          aria-label={`More actions for ${a.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          title="More actions"
          onClick={(e) => {
            e.stopPropagation();
            setMenuFor(open ? null : a.id);
          }}
        >
          <MoreIcon />
        </button>
        {open && (
          <div className="al-menu" role="menu" onClick={(e) => e.stopPropagation()}>
            <button role="menuitem" onClick={() => setRetired(a, a.status === "retired" ? "restore" : "retire")} disabled={working === a.id}>
              {a.status === "retired" ? <RestoreIcon /> : <ArchiveIcon />}
              {a.status === "retired" ? "Restore" : "Retire"}
            </button>
            <button role="menuitem" onClick={() => { setMenuFor(null); setExportOf(a); }}>
              <ExportIcon /> Export to cloud
            </button>
            <button role="menuitem" onClick={() => askShare(a)}>
              <ShareIcon /> Share
            </button>
            <div className="al-menu-sep" />
            {/* Always listed so people know it exists; who may use it is lib/agent-perms,
                and the server enforces the same rule as well as asking for a password. */}
            {(() => {
              const allowed = canDeleteAgent(me, a);
              return (
                <>
                  <button
                    role="menuitem"
                    className="danger"
                    onClick={() => allowed && ask(a)}
                    disabled={!allowed}
                    title={allowed ? "Delete permanently — asks for your password" : deleteDeniedReason(me, a)}
                  >
                    <TrashIcon /> Delete…
                  </button>
                  {!allowed && (
                    <div className="al-menu-note">
                      {a.published_ver != null ? "Published: only an admin can delete" : "Only its creator or an admin can delete"}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
    );
  }

  function actions(a: AgentRow) {
    return (
      <div className="al-actions">
        {a.status !== "retired" && (
          <Link href={`/agents/${a.id}/chat`} className="btn sm al-run" title={`Talk to ${a.name}`}>
            <ChatIcon /> Chat
          </Link>
        )}
        <button className="icon-act" onClick={() => setPeekId(a.id)} aria-label={`Quick look at ${a.name}`} title="Quick look">
          <EyeIcon />
        </button>
        {moreMenu(a)}
      </div>
    );
  }

  const skeleton = (n: number) =>
    Array.from({ length: Math.min(n, 8) }, (_, i) => (
      <div key={i} className="al-row al-skel" aria-hidden="true">
        <div><span className="al-bar w60" /><span className="al-bar w90 thin" /></div>
        <div><span className="al-bar w40" /></div>
        <div><span className="al-bar w30" /></div>
        <div><span className="al-bar w40" /></div>
        <div><span className="al-bar w50" /></div>
        <div />
      </div>
    ));

  const shortcuts: { key: Shortcut; label: string; value: number; tone?: string }[] = [
    { key: "live", label: "Live", value: summary.live, tone: "ok" },
    { key: "drafts", label: "Drafts", value: summary.drafts },
    { key: "scheduled", label: "Scheduled", value: summary.scheduled },
    { key: "recent", label: "Ran this week", value: summary.ranThisWeek },
    { key: "awaiting", label: "Waiting for approval", value: summary.awaiting, tone: summary.awaiting ? "warn" : undefined },
    ...(summary.retired ? [{ key: "retired" as Shortcut, label: "Retired", value: summary.retired }] : []),
  ];

  return (
    <>
      <div className="al-summary" role="group" aria-label="Agent summary">
        {shortcuts.map((s) => (
          <button
            key={s.key}
            className={`al-stat ${s.tone ?? ""} ${activeShortcut === s.key ? "on" : ""}`}
            onClick={() => shortcut(s.key)}
            aria-pressed={activeShortcut === s.key}
            title={activeShortcut === s.key ? "Show all again" : `Show ${s.label.toLowerCase()}`}
          >
            <span className="v">{s.value}</span>
            <span className="l">{s.label}</span>
          </button>
        ))}
      </div>

      {error && !target && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="al-toolbar">
        <div className="al-toolbar-row">
          <input
            className="input search al-search"
            value={term}
            placeholder="Search by name, description or domain"
            onChange={(e) => setTerm(e.target.value)}
            aria-label="Search agents"
          />
          <select className="select-sm" value={industry} onChange={(e) => setIndustry(e.target.value)} aria-label="Industry">
            <option value="">All industries</option>
            {facets.industries.map((i) => (
              <option key={i.name} value={i.name}>
                {i.name} ({i.count})
              </option>
            ))}
          </select>
          <select className="select-sm" value={process} onChange={(e) => { setProcess(e.target.value); if (view === "process" && e.target.value) choose("list"); }} aria-label="Cycle">
            <option value="">All cycles</option>
            {facets.processes.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} ({p.count})
              </option>
            ))}
            {facets.otherProcess > 0 && <option value="other">Other ({facets.otherProcess})</option>}
          </select>
          <button
            type="button"
            className={`al-cycle-btn ${view === "process" ? "on" : ""}`}
            onClick={() => choose(view === "process" ? "list" : "process")}
            aria-pressed={view === "process"}
            title={view === "process" ? "Back to the list of agents" : "See agents grouped into their cycles (O2C, P2P, R2R…)"}
          >
            <LayersIcon size={14} /> {view === "process" ? "Close cycles" : "Browse by cycle"}
          </button>
          <select className="select-sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="all">All (incl. retired)</option>
            <option value="published">Live</option>
            <option value="draft">Drafts</option>
            <option value="retired">Retired{data.retiredCount ? ` (${data.retiredCount})` : ""}</option>
          </select>
          <select className="select-sm" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="updated">Recently updated</option>
            <option value="lastrun">Last run</option>
            <option value="name">Name</option>
            <option value="runs">Most runs</option>
            <option value="domain">Domain</option>
          </select>
          {/* Layout only; browsing by cycle is a different way in, so it has its own button by the Cycle filter. */}
          <div className="seg" role="group" aria-label="Layout">
            {(["list", "grid"] as View[]).map((v) => {
              const label = v === "list" ? "List" : "Grid";
              return (
                <button
                  key={v}
                  className={`seg-opt icon ${view === v ? "on" : ""}`}
                  onClick={() => choose(v)}
                  aria-pressed={view === v}
                  aria-label={label}
                  title={label}
                >
                  {v === "list" ? <ListIcon size={16} /> : <GridIcon size={16} />}
                </button>
              );
            })}
          </div>
        </div>
        <div className="al-toolbar-row">
          <div className="chips">
            <button className={`chip ${archetype === "all" ? "on" : ""}`} onClick={() => setArchetype("all")}>
              All types <span className="al-n">{typeTotal}</span>
            </button>
            {TYPES.map((t) => (
              <button key={t} className={`chip ${archetype === t ? "on" : ""}`} onClick={() => setArchetype(t)}>
                {cap(t)} <span className="al-n">{facets.types[t] ?? 0}</span>
              </button>
            ))}
          </div>
          <span className="al-count">
            {view !== "process" && (
              <>
                {total} {total === 1 ? "agent" : "agents"}
                {chips.length > 0 && <span className="dim"> of {data.totalAll}</span>}
                {totalPages > 1 && <span className="dim"> · page {data.page} of {totalPages}</span>}
              </>
            )}
            {loading && <span className="spin" style={{ marginLeft: 8 }} aria-label="Loading" />}
          </span>
        </div>
        {chips.length > 0 && (
          <div className="al-active">
            {chips.map((c) => (
              <button key={c.label} className="al-chip" onClick={c.clear} aria-label={`Remove filter ${c.label}`}>
                {c.label} <span aria-hidden="true">×</span>
              </button>
            ))}
            <button className="link-btn" onClick={clearAll}>Clear all</button>
          </div>
        )}
      </div>

      {view === "process" ? (
        <div className="al-procs">
          {facets.processes.map((p) => (
            <button
              key={p.code}
              className="al-proc-tile"
              style={{ ["--pc" as any]: processColour(p.code) }}
              onClick={() => { setProcess(p.code); choose("list"); }}
              title={`Show the ${p.count} ${p.code} agents`}
            >
              <div className="al-proc-head">
                <span className="al-proc-code">{p.code}</span>
                <span className="al-proc-n">{p.count}</span>
              </div>
              <div className="al-proc-live">{p.live} live</div>
              <div className="al-proc-fns">{p.functions.slice(0, 3).join(" · ") || "—"}</div>
              <div className="al-proc-inds">{p.industries.join(", ")}</div>
            </button>
          ))}
          {facets.otherProcess > 0 && (
            <button className="al-proc-tile" style={{ ["--pc" as any]: processColour(null) }} onClick={() => { setProcess("other"); choose("list"); }}>
              <div className="al-proc-head">
                <span className="al-proc-code">Other</span>
                <span className="al-proc-n">{facets.otherProcess}</span>
              </div>
              <div className="al-proc-fns">Agents whose domain names a function rather than a cycle code</div>
            </button>
          )}
        </div>
      ) : total === 0 && !loading ? (
        <div className="empty">
          <h3>Nothing matches</h3>
          <p>No agent matches those filters. Widen the search or clear them.</p>
          <button className="btn mt-s" onClick={clearAll}>Clear all filters</button>
        </div>
      ) : view === "list" ? (
        <div className="al-table" role="table" aria-busy={loading}>
          <div className="al-row al-head" role="row">
            <div>Agent</div>
            <div>Domain</div>
            <div>Type</div>
            <div>Status</div>
            <div>Last run</div>
            <div />
          </div>
          {loading
            ? skeleton(rows.length || pageSize)
            : rows.map((a) => {
                const s = statusOf(a);
                return (
                  <div
                    key={a.id}
                    className={`al-row ${a.status === "retired" ? "is-retired" : ""} ${peekId === a.id ? "peeked" : ""}`}
                    role="row"
                    onClick={(e) => openPeek(e, a)}
                  >
                    <div className="al-main">
                      <Link href={`/agents/${a.id}`} className="al-name" title={a.name}>{a.name}</Link>
                      <div className="al-desc" title={a.description || undefined}>{a.description || "No description yet"}</div>
                    </div>
                    <div><DomainTags a={a} /></div>
                    <div><span className="al-type">{cap(a.archetype)}</span></div>
                    <div>
                      <span className={`pill ${s.cls}`}>{s.label}</span>
                      {a.pending_approvals > 0 && (
                        <Link href="/approvals" className="al-waiting" title="Waiting for approval">
                          {a.pending_approvals} waiting
                        </Link>
                      )}
                      {a.next_run_at && a.status === "published" && (
                        <div className="al-small dim" title={a.schedule_caveat || undefined}>next {when(a.next_run_at, timezone)}</div>
                      )}
                    </div>
                    <div><LastRun a={a} tz={timezone} /></div>
                    {actions(a)}
                  </div>
                );
              })}
        </div>
      ) : (
        <div className="al-cards">
          {rows.map((a) => {
            const s = statusOf(a);
            return (
              <div
                key={a.id}
                className={`al-card ${a.status === "retired" ? "is-retired" : ""}`}
                style={{ ["--pc" as any]: processColour(a.process) }}
                onClick={(e) => openPeek(e, a)}
              >
                <div className="al-card-head">
                  <DomainTags a={a} />
                  <span className={`pill ${s.cls}`}>{s.label}</span>
                </div>
                <Link href={`/agents/${a.id}`} className="al-card-name" title={a.name}>{a.name}</Link>
                <p className="al-card-desc" title={a.description || undefined}>{a.description || "No description yet"}</p>
                <div className="al-card-meta">
                  <span className="al-type">{cap(a.archetype)}</span>
                  <LastRun a={a} tz={timezone} />
                </div>
                <div className="al-card-foot">
                  {a.pending_approvals > 0 ? (
                    <Link href="/approvals" className="al-waiting">{a.pending_approvals} waiting</Link>
                  ) : a.next_run_at && a.status === "published" ? (
                    <span className="al-small dim">next {when(a.next_run_at, timezone)}</span>
                  ) : (
                    <span />
                  )}
                  {actions(a)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view !== "process" && total > 0 && (
        <Pagination
          currentPage={data.page}
          totalItems={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          itemLabel="agent"
          itemLabelPlural="agents"
        />
      )}

      {peekId && <QuickLook id={peekId} timezone={timezone} onClose={() => setPeekId(null)} />}

      {shareOf && (
        <div className="modal-back" onMouseDown={closeShare}>
          <div className="panel modal" role="dialog" aria-modal="true" aria-labelledby="share-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="eyebrow">Share agent</div>
            <h2 id="share-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>
              Send “{shareOf.name}”
            </h2>
            <p className="help" style={{ marginTop: 0 }}>
              They must already have an account. It waits for them to accept, then lands in their workspace as a
              draft. Its connections are not sent — no credential leaves this workspace, and they grant their own
              before publishing.
            </p>
            {sent ? (
              <div className="ok-note" style={{ marginTop: 4 }}>{sent}</div>
            ) : (
              <>
                <label className="field">
                  <span className="eyebrow">Their email address</span>
                  <input
                    className="input mono"
                    type="email"
                    autoFocus
                    value={email}
                    placeholder="colleague@example.com"
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !busy && send()}
                  />
                </label>
                <label className="field mt-s">
                  <span className="eyebrow">Note (optional)</span>
                  <input
                    className="input"
                    value={note}
                    placeholder="Why you are sending it"
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !busy && send()}
                  />
                </label>
              </>
            )}
            {shareErr && <div className="error" style={{ marginTop: 12 }}>{shareErr}</div>}
            <div className="panel-foot">
              <button className="btn" onClick={closeShare}>{sent ? "Done" : "Cancel"}</button>
              {!sent && (
                <button className="btn btn-primary" onClick={send} disabled={busy || !email.trim()}>
                  {busy ? "Sending…" : "Send"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {target && (
        <div className="modal-back" onMouseDown={close}>
          <div className="panel modal" role="dialog" aria-modal="true" aria-labelledby="del-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="eyebrow">Confirm deletion</div>
            <h2 id="del-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>
              Delete “{target.name}”?
            </h2>
            <p className="help" style={{ marginTop: 0 }}>
              <strong>Retiring is almost always what you want.</strong> It stops the agent running and keeps
              everything it produced, and it can be undone. Deleting cannot.
              <br />
              <br />
              This removes the agent, its {target.published_ver ? `${target.published_ver} published ` : ""}
              version history and its {target.run_count} {target.run_count === 1 ? "run" : "runs"}, with the steps and
              approvals recorded against them. The audit trail keeps the record of the deletion itself. This cannot be
              undone.
            </p>
            <label className="field" style={{ marginTop: 14 }}>
              <span className="eyebrow">Your password</span>
              <input
                className="input mono"
                type="password"
                autoFocus
                value={password}
                placeholder="Re-enter your password to confirm"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && confirmDelete()}
              />
            </label>
            {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
            <div className="panel-foot">
              <button className="btn" onClick={close} disabled={busy}>Cancel</button>
              <button className="btn btn-danger-solid" onClick={confirmDelete} disabled={busy || !password}>
                {busy ? "Deleting…" : "Delete agent"}
              </button>
            </div>
          </div>
        </div>
      )}

      {exportOf && (
        <ExportAgentModal agentId={exportOf.id} agentName={exportOf.name} isOpen={Boolean(exportOf)} onClose={() => setExportOf(null)} />
      )}
    </>
  );
}

// ---- quick look ----------------------------------------------------------------

type Summary = {
  agent: {
    id: string;
    name: string;
    description: string;
    archetype: string;
    status: string;
    published_ver: number | null;
    next_run_at: string | null;
    schedule_caveat: string;
    owner_name: string | null;
    updated_at: string;
    domain: string | null;
    trigger: { type?: string; schedule?: string } | null;
    steps: number;
    inputs: string[];
  };
  tools: { id: string; label: string; risk: string; gate: string }[];
  sources: { name: string; kind: string }[];
  skills: { label: string; status: string }[];
  runs: { id: string; status: string; trigger: string; started_at: string; ended_at: string | null; cost: number }[];
  runCount: number;
};

/** A side panel with what an agent does and how it has been running, without leaving the list. */
function QuickLook({ id, timezone, onClose }: { id: string; timezone: string; onClose: () => void }) {
  const [d, setD] = useState<Summary | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    setD(null);
    setErr("");
    fetch(`/api/agents/${id}/summary`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "This agent could not be loaded.");
        if (live) setD(j);
      })
      .catch((e) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [id]);

  const a = d?.agent;
  const s = a ? statusOf(a) : null;
  return (
    <>
      <div className="al-peek-back" onClick={onClose} />
      <aside className="al-peek" role="dialog" aria-label="Agent quick look">
        <div className="al-peek-head">
          <div className="eyebrow">Quick look</div>
          <button className="icon-act" onClick={onClose} aria-label="Close quick look" title="Close">✕</button>
        </div>
        {err && <div className="error">{err}</div>}
        {!a && !err && <div className="note">Loading…</div>}
        {a && d && (
          <div className="al-peek-body">
            <h2 className="al-peek-title">{a.name}</h2>
            <div className="al-peek-line">
              <span className={`pill ${s!.cls}`}>{s!.label}</span>
              <span className="al-type">{cap(a.archetype)}</span>
              {a.domain && <span className="al-small dim">{a.domain}</span>}
            </div>
            {a.description && <p className="al-peek-desc">{a.description}</p>}

            <dl className="al-peek-facts">
              <dt>Trigger</dt>
              <dd>
                {a.trigger?.type === "schedule"
                  ? `${a.trigger.schedule || "On a schedule"}${a.next_run_at ? ` · next ${when(a.next_run_at, timezone)}` : ""}`
                  : a.trigger?.type === "event"
                    ? "On an event"
                    : "Run by hand"}
              </dd>
              <dt>Owner</dt>
              <dd>{a.owner_name ?? "—"}</dd>
              <dt>Updated</dt>
              <dd>{when(a.updated_at, timezone)}</dd>
              <dt>Steps</dt>
              <dd>{a.steps}</dd>
            </dl>

            <div className="eyebrow al-peek-h">Tools ({d.tools.length})</div>
            {d.tools.length ? (
              <ul className="al-peek-list">
                {d.tools.map((t) => (
                  <li key={t.id}>
                    {t.label}
                    <span className={`al-gate ${t.gate === "approval" ? "gated" : ""}`}>
                      {t.gate === "approval" ? "needs approval" : "automatic"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="al-small dim">No tools granted.</p>
            )}

            <div className="eyebrow al-peek-h">Data &amp; skills</div>
            <p className="al-small">
              {d.sources.length ? d.sources.map((x) => x.name).join(", ") : "No connections"}
              {" · "}
              {d.skills.length
                ? d.skills.map((x) => `${x.label}${x.status === "retired" ? " (retired)" : ""}`).join(", ")
                : "no skills"}
            </p>
            {a.inputs.length > 0 && <p className="al-small dim">Asks for: {a.inputs.join(", ")}</p>}

            <div className="eyebrow al-peek-h">Recent runs ({d.runCount})</div>
            {d.runs.length ? (
              <ul className="al-peek-list">
                {d.runs.map((r) => {
                  const st = RUN_STATE[r.status] ?? { label: r.status, cls: "" };
                  return (
                    <li key={r.id}>
                      <Link href={`/runs/${r.id}`} className="al-peek-run">
                        <span className={`al-dot ${st.cls}`} /> {st.label}
                      </Link>
                      <span className="al-small dim">{when(r.started_at, timezone)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="al-small dim">It has not run yet.</p>
            )}

            <div className="al-peek-foot">
              <Link href={`/agents/${a.id}`} className="btn">Open builder</Link>
              {a.status !== "retired" && (
                <>
                  <Link href={`/agents/${a.id}/run`} className="btn">
                    <RunIcon /> Run form
                  </Link>
                  <Link href={`/agents/${a.id}/chat`} className="btn btn-primary">
                    <ChatIcon /> Chat
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
