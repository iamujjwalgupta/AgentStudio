"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Pagination from "@/components/Pagination";
import SkillMarkdown from "@/components/SkillMarkdown";
import { downloadSkillMarkdown } from "@/lib/skill-export";
import {
  AlertIcon, ArchiveIcon, BookIcon, CheckIcon, ClockIcon, CopyIcon, CrossIcon, EyeIcon, GridIcon, ListIcon,
  PencilIcon, RestoreIcon, SearchIcon, SparkIcon, TrashIcon,
} from "@/components/agent-ui";

type Skill = {
  id: string;
  name: string;
  label: string;
  description: string;
  instructions: string;
  author: string | null;
  used_by: number;
  created_at: string;
  updated_at: string;
  status: "active" | "retired";
  retired_at: string | null;
  /** Non-admins only: this person's latest download request for the skill. */
  myRequest?: {
    id: string;
    status: "pending" | "approved" | "rejected" | "downloaded" | "expired";
    expires_at: string | null;
    decision_note: string | null;
    decided_by_name: string | null;
  } | null;
};
type HolderAgent = { id: string; name: string; status: string; published_ver: number | null; in_draft: boolean; in_live: boolean };
type Draft = { id: string | null; label: string; description: string; instructions: string };
type Filter = "active" | "used" | "unused" | "retired";
type Sort = "name" | "updated" | "used";
type View = "list" | "grid";

const STORE_KEY = "agent-studio.skills.view";
const LABEL_MAX = 80;
const DESCRIPTION_MAX = 400;
const INSTRUCTIONS_MAX = 20000;
const BLANK: Draft = { id: null, label: "", description: "", instructions: "" };

const EXAMPLES = [
  { title: "Bank reconciliation", brief: "How we reconcile an invoice against a bank statement — match on reference first, then on date and amount within two days, and report anything left over." },
  { title: "Customer tone of voice", brief: "Our house style for writing to customers: second person, no jargon, lead with what we are doing about it rather than with the apology." },
  { title: "Ticket triage", brief: "How we grade an inbound support ticket: what counts as P1, what we promise for each level, and when to escalate rather than reply." },
];

/** The handle agents call a skill by; mirrors skillName on the server. */
const slug = (raw: string) =>
  String(raw || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const TILE_COLOURS = ["#00338d", "#0091da", "#6d2077", "#007a78", "#1e49e2", "#b36b00", "#470a68", "#005eb8"];
function tileColour(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TILE_COLOURS[h % TILE_COLOURS.length];
}
const tileText = (label: string) =>
  label.replace(/[^A-Za-z0-9 &]/g, " ").split(/\s+/).filter((w) => w && w !== "&").slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "S";

function SkillTile({ s, size = 36 }: { s: Pick<Skill, "label" | "name">; size?: number }) {
  return (
    <span className="sk-tile" style={{ width: size, height: size, background: tileColour(s.name || s.label), fontSize: size * 0.36 }} aria-hidden="true">
      {tileText(s.label)}
    </span>
  );
}

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric" }) : "—";
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const tokensOf = (s: string) => Math.ceil(s.length / 4);

function DownloadIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.5v8.5M4.8 7.8L8 11l3.2-3.2M3 13.5h10" />
    </svg>
  );
}

// Deters copying from the read-only view. Text on screen can never be fully
// protected (a screenshot still works), but selection, copy and drag are refused.
const noCopy = {
  onCopy: (e: React.ClipboardEvent) => e.preventDefault(),
  onCut: (e: React.ClipboardEvent) => e.preventDefault(),
  onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  onDragStart: (e: React.DragEvent) => e.preventDefault(),
  style: { userSelect: "none" as const, WebkitUserSelect: "none" as const },
};

export default function SkillsManager() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [canRestore, setCanRestore] = useState(false);
  const [windowDays, setWindowDays] = useState(7);

  const [filter, setFilter] = useState<Filter>("active");
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [view, setView] = useState<View>("list");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [retiring, setRetiring] = useState<Skill | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);
  const [requesting, setRequesting] = useState<Skill | null>(null);
  const [working, setWorking] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/skills", { cache: "no-store" });
      if (!res.ok) throw new Error("Skills could not be loaded.");
      const j = await res.json();
      setSkills(j.skills ?? []);
      setCanRestore(Boolean(j.canRestore));
      setCanEdit(Boolean(j.canEdit));
      if (j.downloadWindowDays) setWindowDays(j.downloadWindowDays);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved === "grid" || saved === "list") setView(saved);
    } catch {
      /* private windows and blocked site data */
    }
  }, []);
  function choose(next: View) {
    setView(next);
    try {
      localStorage.setItem(STORE_KEY, next);
    } catch {}
  }
  useEffect(() => setPage(1), [term, filter, sort]);

  const counts = useMemo(() => {
    const active = skills.filter((s) => s.status !== "retired");
    return {
      active: active.length,
      used: active.filter((s) => s.used_by > 0).length,
      unused: active.filter((s) => !s.used_by).length,
      retired: skills.length - active.length,
    };
  }, [skills]);

  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const list = skills.filter((s) => {
      const retired = s.status === "retired";
      if (filter === "retired" ? !retired : retired) return false;
      if (filter === "used" && !s.used_by) return false;
      if (filter === "unused" && s.used_by) return false;
      if (!needle) return true;
      return [s.label, s.name, s.description, s.author].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle));
    });
    return list.sort((a, b) =>
      sort === "updated" ? +new Date(b.updated_at) - +new Date(a.updated_at)
      : sort === "used" ? b.used_by - a.used_by || a.label.localeCompare(b.label)
      : a.label.localeCompare(b.label),
    );
  }, [skills, filter, term, sort]);

  const totalPages = Math.max(1, Math.ceil(shown.length / pageSize));
  const validPage = Math.min(Math.max(1, page), totalPages);
  const pageItems = shown.slice((validPage - 1) * pageSize, validPage * pageSize);
  const open = openId ? skills.find((s) => s.id === openId) ?? null : null;

  function flash(msg: string) {
    setError("");
    setNote(msg);
  }

  /** Uses the one download an approval allows, then refreshes the button state. */
  function downloadApproved(s: Skill) {
    if (!s.myRequest) return;
    window.location.href = `/api/skill-downloads/${s.myRequest.id}/file`;
    flash(`Downloading "${s.label}". That used your approval; request again if you need it another time.`);
    setTimeout(load, 1500);
  }

  /** Download: direct for admins; request-and-approve for everyone else. */
  function download(s: Skill) {
    if (canEdit) return downloadSkillMarkdown(s);
    if (s.myRequest?.status === "approved") return downloadApproved(s);
    if (s.myRequest?.status === "pending") return;
    setRequesting(s);
  }
  function downloadHint(s: Skill) {
    if (canEdit) return "Download as Markdown";
    const r = s.myRequest;
    if (r?.status === "pending") return "Download requested — waiting for an admin";
    if (r?.status === "approved") return `Approved by ${r.decided_by_name ?? "an admin"} — download once${r.expires_at ? `, by ${fmtDate(r.expires_at)}` : ""}`;
    const previous =
      r?.status === "rejected" ? ` (last request not approved${r.decision_note ? `: ${r.decision_note}` : ""})`
      : r?.status === "expired" ? " (last approval expired)"
      : r?.status === "downloaded" ? " (last approval used)" : "";
    return `Request download — an admin must approve${previous}`;
  }

  async function restore(s: Skill) {
    setWorking(s.id);
    try {
      const res = await fetch(`/api/skills/${s.id}/retire`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "That could not be done.");
      const n = Number(j.agentsAffected) || 0;
      flash(`Restored "${s.label}".${n ? ` ${n} ${n === 1 ? "agent uses" : "agents use"} it again from the next run.` : ""}`);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setWorking("");
    }
  }

  function startEdit(s: Skill) {
    setEditing({ id: s.id, label: s.label, description: s.description, instructions: s.instructions });
  }

  const actions = (s: Skill, stop = false) => {
    const halt = (e: React.MouseEvent) => stop && e.stopPropagation();
    const r = s.myRequest?.status;
    return (
      <>
        <button
          className={`icon-act ${!canEdit && r === "approved" ? "sk-approved" : ""}`}
          onClick={(e) => { halt(e); download(s); }}
          title={downloadHint(s)}
          aria-label={downloadHint(s)}
        >
          {!canEdit && r === "pending" ? <ClockIcon size={14} /> : <DownloadIcon />}
        </button>
        {canEdit ? (
          <button className="icon-act" onClick={(e) => { halt(e); startEdit(s); }} title="Edit" aria-label={`Edit ${s.label}`}><PencilIcon size={14} /></button>
        ) : (
          <button className="icon-act" onClick={(e) => { halt(e); setOpenId(s.id); }} title="View (read-only)" aria-label={`View ${s.label}`}><EyeIcon size={14} /></button>
        )}
        {s.status === "retired" ? (
          canRestore && (
            <button className="icon-act" onClick={(e) => { halt(e); restore(s); }} disabled={working === s.id} title="Restore" aria-label={`Restore ${s.label}`}><RestoreIcon size={14} /></button>
          )
        ) : (
          <button className="icon-act" onClick={(e) => { halt(e); setRetiring(s); }} title="Retire" aria-label={`Retire ${s.label}`}><ArchiveIcon size={14} /></button>
        )}
        <button className="icon-act del-btn" onClick={(e) => { halt(e); setDeleting(s); }} title="Delete" aria-label={`Delete ${s.label}`}><TrashIcon size={14} /></button>
      </>
    );
  };

  const usedPill = (s: Skill) =>
    s.status === "retired" ? (
      <span className="sk-pill grey">Retired{s.used_by ? ` · ${s.used_by} held` : ""}</span>
    ) : s.used_by ? (
      <span className="sk-pill green">{s.used_by} {s.used_by === 1 ? "agent" : "agents"}</span>
    ) : (
      <span className="sk-pill muted">Unattached</span>
    );

  const STATS: { key: Filter; label: string; n: number; tone?: string }[] = [
    { key: "active", label: "Active skills", n: counts.active },
    { key: "used", label: "In use by agents", n: counts.used, tone: "ok" },
    { key: "unused", label: "Not attached yet", n: counts.unused, tone: counts.unused ? "warn" : "" },
    { key: "retired", label: "Retired", n: counts.retired },
  ];

  return (
    <div className="page sk">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Skills</h1>
          <p className="sub" style={{ maxWidth: 760 }}>
            How your team does a piece of work, written down once and attached to any agent that needs it. A tool decides
            what an agent may do; a skill tells it how the work is done here.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({ ...BLANK })}>
          <SparkIcon size={13} /> Write a skill
        </button>
      </header>

      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}
      {note && !error && (
        <div className="sk-note">
          <CheckIcon size={13} />
          <span className="grow">{note}</span>
          <button onClick={() => setNote("")} aria-label="Dismiss"><CrossIcon size={11} /></button>
        </div>
      )}

      {skills.length > 0 && (
        <>
          <div className="sk-stats">
            {STATS.map((st) => (
              <button key={st.key} className={`sk-stat ${st.tone ?? ""} ${filter === st.key ? "on" : ""}`} onClick={() => setFilter(st.key)} aria-pressed={filter === st.key}>
                <span className="v">{st.n}</span>
                <span className="l">{st.label}</span>
              </button>
            ))}
          </div>

          <div className="sk-toolbar">
            <label className="sk-search">
              <SearchIcon size={14} />
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name, summary, identifier or author" aria-label="Search skills" />
              {term && <button type="button" onClick={() => setTerm("")} aria-label="Clear search"><CrossIcon size={11} /></button>}
            </label>
            <select className="select-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="name">Name A–Z</option>
              <option value="updated">Recently updated</option>
              <option value="used">Most used</option>
            </select>
            <div className="seg sk-view" role="group" aria-label="View">
              <button className={`seg-opt ${view === "list" ? "on" : ""}`} onClick={() => choose("list")} aria-pressed={view === "list"} title="List"><ListIcon size={14} /></button>
              <button className={`seg-opt ${view === "grid" ? "on" : ""}`} onClick={() => choose("grid")} aria-pressed={view === "grid"} title="Grid"><GridIcon size={14} /></button>
            </div>
          </div>
          <div className="sk-count">
            {shown.length} {shown.length === 1 ? "skill" : "skills"}
            {term.trim() && <> matching “{term.trim()}” · <button className="sk-link" onClick={() => setTerm("")}>clear</button></>}
          </div>
        </>
      )}

      {loading ? (
        <div className="sk-list">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="sk-row skeleton" />)}</div>
      ) : skills.length === 0 ? (
        <div className="sk-empty">
          <span className="sk-empty-ic"><BookIcon size={22} /></span>
          <h3>No skills yet</h3>
          <p>
            Write down something your team knows and every agent can be given it. Attach skills to an agent under{" "}
            <Link href="/agents">Agents</Link>, on the Instructions step.
          </p>
          <button className="btn btn-primary" onClick={() => setEditing({ ...BLANK })}>Write the first skill</button>
        </div>
      ) : shown.length === 0 ? (
        <div className="sk-empty">
          <h3>{term.trim() ? "Nothing matches" : filter === "retired" ? "No retired skills" : filter === "unused" ? "Every skill is in use" : "Nothing here"}</h3>
          <p>
            {term.trim()
              ? "No skill matches that search. Try another word, or clear it."
              : filter === "retired"
                ? "Skills you retire appear here, and can be restored from here."
                : "Choose another view above."}
          </p>
          {term.trim() && <button className="btn btn-sm" onClick={() => setTerm("")}>Clear search</button>}
        </div>
      ) : view === "list" ? (
        <div className="sk-list">
          <div className="sk-row head">
            <span />
            <span>Skill</span>
            <span>When an agent reaches for it</span>
            <span>Used by</span>
            <span>Updated</span>
            <span />
          </div>
          {pageItems.map((s) => (
            <div
              key={s.id}
              className={`sk-row ${s.status === "retired" ? "retired" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(s.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenId(s.id))}
            >
              <SkillTile s={s} />
              <span className="sk-name">
                <b title={s.label}>{s.label}</b>
                <code title={s.name}>{s.name}</code>
              </span>
              <span className={`sk-desc ${s.description ? "" : "missing"}`} title={s.description || undefined}>
                {s.description || "No summary — an agent has nothing to judge on."}
              </span>
              <span>{usedPill(s)}</span>
              <span className="sk-meta">
                {fmtDate(s.updated_at)}
                {s.author && <em>{s.author}</em>}
              </span>
              <span className="sk-actions">{actions(s, true)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="sk-grid">
          {pageItems.map((s) => (
            <div
              key={s.id}
              className={`sk-card ${s.status === "retired" ? "retired" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(s.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenId(s.id))}
            >
              <div className="sk-card-top">
                <SkillTile s={s} size={40} />
                {usedPill(s)}
              </div>
              <b className="sk-card-title" title={s.label}>{s.label}</b>
              <code className="sk-card-id">{s.name}</code>
              <p className={`sk-card-desc ${s.description ? "" : "missing"}`}>{s.description || "No summary — an agent has nothing to judge on."}</p>
              <div className="sk-card-foot">
                <span className="sk-meta-inline">
                  {words(s.instructions).toLocaleString("en-US")} words · updated {fmtDate(s.updated_at)}
                </span>
                <span className="sk-actions">{actions(s, true)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {shown.length > pageSize && (
        <Pagination
          currentPage={validPage}
          totalItems={shown.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          pageSizeOptions={[12, 24, 48]}
          itemLabel="skill"
          itemLabelPlural="skills"
        />
      )}

      {open && (
        <SkillDrawer
          skill={open}
          canEdit={canEdit}
          canRestore={canRestore}
          working={working === open.id}
          downloadHint={downloadHint(open)}
          onClose={() => setOpenId(null)}
          onEdit={() => { setOpenId(null); startEdit(open); }}
          onDownload={() => download(open)}
          onRetire={() => setRetiring(open)}
          onRestore={() => restore(open)}
          onDelete={() => setDeleting(open)}
        />
      )}

      {editing && (
        <SkillEditor
          initial={editing}
          usedBy={editing.id ? skills.find((s) => s.id === editing.id)?.used_by ?? 0 : 0}
          canDownload={canEdit}
          onClose={() => setEditing(null)}
          onSaved={(label, created) => {
            setEditing(null);
            flash(created ? `Created "${label}". Attach it to an agent on the agent's Instructions step.` : `Saved "${label}". Agents holding it use the new wording from their next run.`);
            load();
          }}
        />
      )}

      {retiring && (
        <RetireDialog
          skill={retiring}
          onClose={() => setRetiring(null)}
          onDone={(n) => {
            flash(`Retired "${retiring.label}".${n ? ` ${n} ${n === 1 ? "agent stops" : "agents stop"} using it from the next run.` : ""} You can restore it from Retired.`);
            setRetiring(null);
            if (openId === retiring.id) setOpenId(null);
            load();
          }}
        />
      )}

      {deleting && (
        <DeleteDialog
          skill={deleting}
          onClose={() => setDeleting(null)}
          onDone={(label) => {
            flash(`Deleted "${label}".`);
            if (openId === deleting.id) setOpenId(null);
            setDeleting(null);
            load();
          }}
        />
      )}

      {requesting && (
        <RequestDialog
          skill={requesting}
          windowDays={windowDays}
          onClose={() => setRequesting(null)}
          onDone={() => {
            flash(`Download of "${requesting.label}" requested. An admin will review it; a download button appears here once it is approved.`);
            setRequesting(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/* ================================================================================== */
/* Detail panel                                                                        */
/* ================================================================================== */

function SkillDrawer({
  skill: s, canEdit, canRestore, working, downloadHint, onClose, onEdit, onDownload, onRetire, onRestore, onDelete,
}: {
  skill: Skill; canEdit: boolean; canRestore: boolean; working: boolean; downloadHint: string;
  onClose: () => void; onEdit: () => void; onDownload: () => void; onRetire: () => void; onRestore: () => void; onDelete: () => void;
}) {
  const [tab, setTab] = useState<"instructions" | "agents" | "history">("instructions");
  const [agents, setAgents] = useState<HolderAgent[] | null>(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setAgents(null);
    setHistory(null);
    setTab("instructions");
    fetch(`/api/skills/${s.id}`, { cache: "no-store" }).then((r) => r.json()).then((j) => setAgents(j.agents ?? [])).catch(() => setAgents([]));
    fetch(`/api/audit?days=0&limit=30&entity=skill&entityId=${s.id}`, { cache: "no-store" }).then((r) => r.json()).then((j) => setHistory(j.events ?? [])).catch(() => setHistory([]));
  }, [s.id]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const req = s.myRequest?.status;
  const protect = canEdit ? {} : noCopy;

  return (
    <div className="sk-drawer-back" onMouseDown={onClose}>
      <aside className="sk-drawer" role="dialog" aria-modal="true" aria-labelledby="sk-drawer-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sk-drawer-head">
          <SkillTile s={s} size={44} />
          <div className="grow">
            <div className="sk-drawer-kicker">
              Skill {s.status === "retired" ? <span className="sk-pill grey">Retired</span> : s.used_by ? <span className="sk-pill green">In use</span> : <span className="sk-pill muted">Unattached</span>}
            </div>
            <h2 id="sk-drawer-title">{s.label}</h2>
            <button
              className="sk-id"
              onClick={() => navigator.clipboard?.writeText(s.name).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1300); }).catch(() => {})}
              title="Agents load it by this name — copy"
            >
              <code>{s.name}</code> {copied ? <em>Copied</em> : <CopyIcon size={11} />}
            </button>
          </div>
          <button className="sk-close" onClick={onClose} aria-label="Close"><CrossIcon size={13} /></button>
        </div>

        <div className="sk-drawer-facts">
          <div><span>Used by</span><b>{s.used_by} {s.used_by === 1 ? "agent" : "agents"}</b></div>
          <div><span>Length</span><b>{words(s.instructions).toLocaleString("en-US")} words</b><em>≈{tokensOf(s.instructions).toLocaleString("en-US")} tokens when loaded</em></div>
          <div><span>Updated</span><b>{fmtDate(s.updated_at)}</b><em>{s.author ? `written by ${s.author}` : ""}</em></div>
        </div>

        <div className="sk-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "instructions"} className={tab === "instructions" ? "on" : ""} onClick={() => setTab("instructions")}>Instructions</button>
          <button role="tab" aria-selected={tab === "agents"} className={tab === "agents" ? "on" : ""} onClick={() => setTab("agents")}>
            Agents <span>{agents ? agents.length : s.used_by}</span>
          </button>
          <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History</button>
        </div>

        <div className="sk-drawer-body">
          {tab === "instructions" && (
            <div {...protect}>
              {!canEdit && (
                <div className="sk-readonly">
                  <EyeIcon size={13} /> Read-only. Only the workspace owner and admins can edit or copy a skill; you can attach it to your agents.
                </div>
              )}
              <div className="sk-summary">
                <span>When an agent reaches for it</span>
                <p className={s.description ? "" : "missing"}>{s.description || "No summary — an agent has nothing to judge on. Add one so agents know when to use it."}</p>
              </div>
              <SkillMarkdown source={s.instructions} className="sk-md" />
            </div>
          )}

          {tab === "agents" && (
            agents === null ? <p className="dim">Loading…</p>
            : !agents.length ? (
              <div className="sk-none">
                <p>No agent holds this skill yet.</p>
                <p className="dim">Attach it on an agent&apos;s Instructions step. Only the name and summary sit in the agent&apos;s prompt; the body is loaded when the work calls for it.</p>
              </div>
            ) : (
              <ul className="sk-agents">
                {agents.map((a) => (
                  <li key={a.id}>
                    <Link href={`/agents/${a.id}`} className="grow">
                      <b>{a.name}</b>
                      <span>
                        {a.in_live && a.published_ver ? `Live in v${a.published_ver}` : ""}
                        {a.in_live && a.in_draft ? " · " : ""}
                        {a.in_draft ? (a.in_live ? "and in the draft" : "In the draft only — not live yet") : a.in_live ? " · removed from the draft" : ""}
                      </span>
                    </Link>
                    <span className={`sk-pill ${a.status === "published" ? "green" : a.status === "retired" ? "grey" : "muted"}`}>{a.status}</span>
                  </li>
                ))}
              </ul>
            )
          )}

          {tab === "history" && (
            history === null ? <p className="dim">Loading…</p>
            : !history.length ? <p className="dim">No recorded history.</p>
            : (
              <ol className="sk-history">
                {history.map((h: any) => (
                  <li key={h.id} className={h.destructive ? "bad" : ""}>
                    <b>{h.action}</b>
                    <span>{h.actor_name} · {new Date(h.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    {h.detail?.renamedFrom && <em>Renamed from {h.detail.renamedFrom}</em>}
                    {h.detail?.reason && <em>“{h.detail.reason}”</em>}
                  </li>
                ))}
              </ol>
            )
          )}
        </div>

        <div className="sk-drawer-foot">
          <div className="sk-foot-left">
            {s.status === "retired" ? (
              canRestore && <button className="btn btn-sm" onClick={onRestore} disabled={working}><RestoreIcon size={13} /> Restore</button>
            ) : (
              <button className="btn btn-sm" onClick={onRetire}><ArchiveIcon size={13} /> Retire</button>
            )}
            <button className="btn btn-sm btn-danger" onClick={onDelete}><TrashIcon size={13} /> Delete</button>
          </div>
          <div className="sk-foot-right">
            <button className={`btn btn-sm ${!canEdit && req === "approved" ? "sk-approved-btn" : ""}`} onClick={onDownload} disabled={!canEdit && req === "pending"} title={downloadHint}>
              {!canEdit && req === "pending" ? <><ClockIcon size={13} /> Download requested</>
                : !canEdit && req === "approved" ? <><DownloadIcon size={13} /> Download (approved)</>
                : canEdit ? <><DownloadIcon size={13} /> Download .md</>
                : <><DownloadIcon size={13} /> Request download</>}
            </button>
            {canEdit && <button className="btn btn-sm btn-primary" onClick={onEdit}><PencilIcon size={13} /> Edit skill</button>}
          </div>
        </div>
      </aside>
    </div>
  );
}

/* ================================================================================== */
/* Editor                                                                              */
/* ================================================================================== */

function SkillEditor({
  initial, usedBy, canDownload, onClose, onSaved,
}: {
  initial: Draft; usedBy: number; canDownload: boolean; onClose: () => void; onSaved: (label: string, created: boolean) => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [brief, setBrief] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [aiOpen, setAiOpen] = useState(!initial.id && !initial.instructions);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [pane, setPane] = useState<"write" | "preview">("write");
  const [drafted, setDrafted] = useState(false);
  const start = useRef(JSON.stringify(initial));
  const dirty = JSON.stringify(d) !== start.current;
  const isNew = !d.id;

  function close() {
    if (dirty && !confirm("Discard your changes to this skill?")) return;
    onClose();
  }
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !saving && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  });

  // Drafting fills the fields and nothing else; nothing is stored until save.
  async function compose() {
    if (!brief.trim()) return setErr("Describe the skill you want drafted.");
    setDrafting(true);
    setErr("");
    try {
      const res = await fetch("/api/skills/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The skill could not be drafted.");
      setD({ ...d, label: j.draft.label, description: j.draft.description, instructions: j.draft.instructions });
      setDrafted(true);
      setAiOpen(false);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (!d.label.trim()) return setErr("Give the skill a name.");
    if (!d.instructions.trim()) return setErr("A skill with no instructions has nothing to teach. Write the body.");
    setSaving(true);
    setErr("");
    try {
      const res = await fetch(d.id ? `/api/skills/${d.id}` : "/api/skills", {
        method: d.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: d.label, description: d.description, instructions: d.instructions }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The skill could not be saved.");
      onSaved(j.skill.label, !d.id);
    } catch (e: any) {
      setErr(e.message);
      setSaving(false);
    }
  }

  const id = slug(d.label);
  const renamed = !isNew && initial.label && slug(initial.label) !== id;
  const descLeft = DESCRIPTION_MAX - d.description.length;
  const summaryHint =
    !d.description.trim() ? "Agents decide from this line alone whether to load the skill. Write it."
    : !/^use (this )?when/i.test(d.description.trim()) ? "Tip: start with “Use when…” so agents can judge it at a glance."
    : "";

  return (
    <div className="modal-back sk-editor-back" onMouseDown={() => !saving && close()}>
      <div className="sk-editor" role="dialog" aria-modal="true" aria-labelledby="sk-editor-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sk-editor-head">
          <div>
            <div className="eyebrow">{isNew ? "New skill" : "Edit skill"}</div>
            <h2 id="sk-editor-title">{d.label.trim() || (isNew ? "Untitled skill" : initial.label)}</h2>
          </div>
          <button className="sk-close" onClick={close} aria-label="Close"><CrossIcon size={13} /></button>
        </div>

        {!isNew && usedBy > 0 && (
          <div className="sk-warn">
            <AlertIcon size={13} />
            {usedBy} {usedBy === 1 ? "agent holds" : "agents hold"} this skill. Saving changes how {usedBy === 1 ? "it works" : "they work"} from the next run — without a new publish.
          </div>
        )}

        <div className="sk-editor-body">
          <div className="sk-editor-form">
            {isNew && (
              <div className={`sk-ai ${aiOpen ? "open" : ""}`}>
                <button className="sk-ai-toggle" onClick={() => setAiOpen(!aiOpen)} aria-expanded={aiOpen}>
                  <SparkIcon size={13} />
                  <span className="grow">{drafted ? "Drafted from your description — read it through before saving" : "Describe it and let it be drafted"}</span>
                  <span className="sk-chev">{aiOpen ? "−" : "+"}</span>
                </button>
                {aiOpen && (
                  <div className="sk-ai-body">
                    <textarea className="textarea" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="How does your team do this piece of work? Rules, thresholds, order of steps, what to report…" />
                    <div className="sk-examples">
                      <span>Try:</span>
                      {EXAMPLES.map((x) => <button key={x.title} type="button" onClick={() => setBrief(x.brief)}>{x.title}</button>)}
                    </div>
                    <div className="sk-ai-go">
                      <span className="dim">The draft fills the fields below. Nothing is saved until you say so.</span>
                      <button className="btn btn-sm" onClick={compose} disabled={drafting || !brief.trim()}>
                        {drafting && <span className="spin" />} {drafting ? "Drafting…" : "Draft it"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <label className="sk-field">
              <span className="sk-label">Name</span>
              <input className="input" value={d.label} maxLength={LABEL_MAX} placeholder="Invoice reconciliation" onChange={(e) => setD({ ...d, label: e.target.value })} />
              <span className="sk-under">
                <span>{id ? <>Agents load it as <code>{id}</code>{renamed && <em> · renamed from {slug(initial.label)}</em>}</> : "Agents load a skill by a handle made from its name."}</span>
              </span>
            </label>

            <label className="sk-field">
              <span className="sk-label">When an agent should reach for it <em>— always in the agent&apos;s prompt</em></span>
              <textarea className="textarea" rows={2} value={d.description} maxLength={DESCRIPTION_MAX} placeholder="Use when matching a ledger export against a bank statement and reporting what does not line up." onChange={(e) => setD({ ...d, description: e.target.value })} />
              <span className="sk-under">
                <span className={summaryHint && !d.description.trim() ? "sk-bad" : ""}>{summaryHint}</span>
                <span className={`sk-counter ${descLeft < 40 ? "low" : ""}`}>{d.description.length}/{DESCRIPTION_MAX}</span>
              </span>
            </label>

            <div className="sk-field grow">
              <span className="sk-label-row">
                <span className="sk-label">Instructions <em>— markdown, loaded when the work calls for it</em></span>
                <span className="seg sk-pane-seg">
                  <button type="button" className={`seg-opt ${pane === "write" ? "on" : ""}`} onClick={() => setPane("write")}>Write</button>
                  <button type="button" className={`seg-opt ${pane === "preview" ? "on" : ""}`} onClick={() => setPane("preview")}>Preview</button>
                </span>
              </span>
              {pane === "write" ? (
                <textarea
                  className="textarea mono sk-body"
                  value={d.instructions}
                  maxLength={INSTRUCTIONS_MAX}
                  placeholder={"## Matching\n1. Normalise both files to date, amount and reference.\n2. Match on reference first, then date and amount within two days.\n\n## Reporting\n- List anything left unmatched, with the reason."}
                  onChange={(e) => setD({ ...d, instructions: e.target.value })}
                />
              ) : (
                <div className="sk-body sk-preview-inline">
                  {d.instructions.trim() ? <SkillMarkdown source={d.instructions} className="sk-md" /> : <p className="dim">Nothing to preview yet.</p>}
                </div>
              )}
              <span className="sk-under">
                <span className="dim">## headings, - lists, 1. steps, **bold**, `codes`</span>
                <span className={`sk-counter ${INSTRUCTIONS_MAX - d.instructions.length < 1000 ? "low" : ""}`}>
                  {words(d.instructions).toLocaleString("en-US")} words · ≈{tokensOf(d.instructions).toLocaleString("en-US")} tokens · {d.instructions.length.toLocaleString("en-US")}/{INSTRUCTIONS_MAX.toLocaleString("en-US")}
                </span>
              </span>
            </div>
          </div>

          <div className="sk-editor-preview">
            <div className="sk-prev-label">What an agent sees</div>
            <div className="sk-prev-card">
              <span className="sk-prev-tag">Always in its prompt</span>
              <div className="sk-prev-line">
                <code>{id || "skill-name"}</code>
                <span>{d.description.trim() || <i className="dim">No summary — the agent has nothing to judge on.</i>}</span>
              </div>
            </div>
            <div className="sk-prev-card grow">
              <span className="sk-prev-tag">Loaded when the work calls for it</span>
              {d.instructions.trim() ? <SkillMarkdown source={d.instructions} className="sk-md sm" /> : <p className="dim" style={{ margin: 0 }}>The instructions appear here as you write them.</p>}
            </div>
          </div>
        </div>

        {err && <div className="error" style={{ margin: "0 22px 12px" }}>{err}</div>}
        <div className="sk-editor-foot">
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={close} disabled={saving}>Cancel</button>
            {canDownload && d.instructions && (
              <button className="btn btn-ghost" onClick={() => downloadSkillMarkdown(d)}><DownloadIcon size={13} /> Download .md</button>
            )}
          </div>
          <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : isNew ? "Create skill" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================================== */
/* Dialogs                                                                             */
/* ================================================================================== */

function Dialog({ title, kicker, children, onClose, busy, width }: { title: string; kicker: string; children: React.ReactNode; onClose: () => void; busy?: boolean; width?: number }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [busy, onClose]);
  return (
    <div className="modal-back" onMouseDown={() => !busy && onClose()} style={{ zIndex: 80 }}>
      <div className="panel modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined} onMouseDown={(e) => e.stopPropagation()}>
        <div className="eyebrow">{kicker}</div>
        <h2 style={{ margin: "2px 0 8px", fontSize: 17 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function RetireDialog({ skill, onClose, onDone }: { skill: Skill; onClose: () => void; onDone: (n: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/skills/${skill.id}/retire`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retire" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "That could not be done.");
      onDone(Number(j.agentsAffected) || 0);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <Dialog kicker="Retire skill" title={`Retire “${skill.label}”?`} onClose={onClose} busy={busy}>
      {skill.used_by > 0 ? (
        <div className="sk-warn inline"><AlertIcon size={13} /> {skill.used_by} {skill.used_by === 1 ? "agent holds" : "agents hold"} it and will carry on without it from the next run.</div>
      ) : null}
      <p className="help" style={{ marginTop: 8 }}>
        The skill and its instructions are kept, and every agent keeps its reference to it, so restoring it puts everything back as it was.
      </p>
      {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
      <div className="panel-foot">
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={go} disabled={busy}><ArchiveIcon size={13} /> {busy ? "Retiring…" : "Retire skill"}</button>
      </div>
    </Dialog>
  );
}

function DeleteDialog({ skill, onClose, onDone }: { skill: Skill; onClose: () => void; onDone: (label: string) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    if (!password) return setErr("Enter your password to confirm.");
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/skills/${skill.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The skill could not be deleted.");
      onDone(j.label || skill.label);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <Dialog kicker="Confirm deletion" title={`Delete “${skill.label}”?`} onClose={onClose} busy={busy}>
      {skill.used_by > 0 && (
        <div className="sk-warn inline danger">
          <AlertIcon size={13} /> {skill.used_by} {skill.used_by === 1 ? "agent holds" : "agents hold"} this skill and will carry on without it from the next run.
        </div>
      )}
      <p className="help" style={{ marginTop: 8 }}>
        This removes the skill and its instructions for good. The audit trail keeps the record of the deletion. If you may want it back, retire it instead.
      </p>
      <label className="field" style={{ marginTop: 12 }}>
        <span className="eyebrow">Your password</span>
        <input className="input mono" type="password" autoFocus value={password} placeholder="Re-enter your password to confirm" onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !busy && go()} />
      </label>
      {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
      <div className="panel-foot">
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-danger-solid" onClick={go} disabled={busy || !password}>{busy ? "Deleting…" : "Delete skill"}</button>
      </div>
    </Dialog>
  );
}

function RequestDialog({ skill, windowDays, onClose, onDone }: { skill: Skill; windowDays: number; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    if (!reason.trim()) return setErr("Say why you need the file.");
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/skills/${skill.id}/download-request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The request could not be sent.");
      onDone();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <Dialog kicker="Request download" title={`Download “${skill.label}”?`} onClose={onClose} busy={busy}>
      <p className="help" style={{ marginTop: 0 }}>
        Taking a skill out of the workspace needs an admin&apos;s approval. Your request goes to the workspace owner and admins.
        If they approve it, a download button appears here: it works once, within {windowDays} days, and gives you the skill as it was when they approved it.
      </p>
      <label className="field" style={{ marginTop: 12 }}>
        <span className="eyebrow">Why do you need the file?</span>
        <textarea className="textarea" rows={3} autoFocus maxLength={500} value={reason} placeholder="e.g. Sharing the reconciliation steps with the audit team for the Q3 review" onChange={(e) => setReason(e.target.value)} />
      </label>
      {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
      <div className="panel-foot">
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={go} disabled={busy || !reason.trim()}>{busy ? "Sending…" : "Send request"}</button>
      </div>
    </Dialog>
  );
}
