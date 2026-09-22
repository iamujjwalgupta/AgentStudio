"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Pagination from "@/components/Pagination";
import { downloadSkillMarkdown } from "@/lib/skill-export";

type Skill = {
  id: string;
  name: string;
  label: string;
  description: string;
  instructions: string;
  author: string | null;
  used_by: number;
  updated_at: string;
};

type Draft = { id: string | null; label: string; description: string; instructions: string };

type View = "list" | "grid";
const STORE_KEY = "agent-studio.skills.view";

const BLANK: Draft = { id: null, label: "", description: "", instructions: "" };

const EXAMPLES = [
  "How we reconcile an invoice against a bank statement — match on reference first, then on date and amount within two days, and report anything left over.",
  "Our house style for writing to customers: second person, no jargon, lead with what we are doing about it rather than with the apology.",
  "How we grade an inbound support ticket: what counts as P1, what we promise for each level, and when to escalate rather than reply.",
];

/** Thin-stroke download icon */
function DownloadIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 2.5v8.5M4.8 7.8L8 11l3.2-3.2M3 13.5h10" />
    </svg>
  );
}

/** Thin-stroke pencil, matching icons in AgentList. */
function EditIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M11.3 2.1a1.4 1.4 0 0 1 2 2L4.9 12.5l-3.2.8.8-3.2L11.3 2.1z" />
      <path d="M9.8 3.6l2 2" />
    </svg>
  );
}

/** Thin-stroke bin, matching icons in AgentList. */
function TrashIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.6 4.2h10.8" />
      <path d="M6.5 4.2V2.9c0-.45.35-.8.8-.8h1.4c.45 0 .8.35.8.8v1.3" />
      <path d="M12.1 4.2l-.45 8.5c-.03.75-.6 1.3-1.3 1.3H5.65c-.7 0-1.27-.55-1.3-1.3L3.9 4.2" />
      <path d="M6.65 6.9v4.2M9.35 6.9v4.2" />
    </svg>
  );
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [brief, setBrief] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [view, setView] = useState<View>("list");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);

  useEffect(() => {
    setPage(1);
  }, [term]);

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

  function editSkill(s: Skill) {
    setNote("");
    setDraft({ id: s.id, label: s.label, description: s.description, instructions: s.instructions });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function load() {
    try {
      const res = await fetch("/api/skills");
      if (!res.ok) throw new Error("Skills could not be loaded.");
      const j = await res.json();
      setSkills(j.skills ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Drafting fills the editor and nothing else. Nothing is stored until the
  // person has read it and pressed save.
  async function compose() {
    if (!brief.trim()) return setError("Describe the skill you want drafted.");
    setDrafting(true);
    setError("");
    try {
      const res = await fetch("/api/skills/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The skill could not be drafted.");
      setDraft({ id: null, label: j.draft.label, description: j.draft.description, instructions: j.draft.instructions });
      setBrief("");
      setNote("Drafted. Read it through and edit anything that is not how you actually work.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(draft.id ? `/api/skills/${draft.id}` : "/api/skills", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: draft.label,
          description: draft.description,
          instructions: draft.instructions,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The skill could not be saved.");
      setNote(draft.id ? `Saved. Agents holding "${j.skill.label}" use the new wording on their next run.` : "Skill created.");
      setDraft(null);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(s: Skill) {
    const warn = s.used_by
      ? `Delete "${s.label}"? ${s.used_by} agent${s.used_by > 1 ? "s" : ""} hold it. They will carry on without it.`
      : `Delete "${s.label}"?`;
    if (!confirm(warn)) return;
    const res = await fetch(`/api/skills/${s.id}`, { method: "DELETE" });
    const j = await res.json();
    if (!res.ok) return setError(j.error || "The skill could not be deleted.");
    setNote(`Deleted "${j.label}".`);
    if (draft?.id === s.id) setDraft(null);
    load();
  }

  const needle = term.trim().toLowerCase();
  const shown = skills.filter((s) => {
    if (!needle) return true;
    return [s.label, s.name, s.description, s.author]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });

  const totalPages = Math.max(1, Math.ceil(shown.length / pageSize));
  const validPage = Math.min(Math.max(1, page), totalPages);
  const paginatedShown = shown.slice((validPage - 1) * pageSize, validPage * pageSize);

  const filtered = needle !== "";
  const rowCols = "2fr 3fr 1fr 76px";

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Skills</h1>
          <p className="sub">
            How your team does a piece of work, written down once and attached to any agent that needs it. A tool
            decides what an agent may do; a skill tells it how the work is done here.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setDraft(draft ? null : { ...BLANK })}>
          {draft ? "Cancel" : "Write a skill"}
        </button>
      </header>

      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}
      {note && !error && <div className="ok-note" style={{ marginBottom: 14 }}>{note}</div>}

      {draft && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>{draft.id ? "Edit skill" : "New skill"}</h2>
          <p className="help">
            Agents see the name and the summary at all times, and read the body only when they decide the work in
            front of them calls for it. That makes the summary the part that matters most: it is what the agent
            judges on.
          </p>

          {!draft.id && (
            <div className="note" style={{ marginBottom: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Or describe it and let it be drafted</div>
              <textarea
                className="textarea"
                rows={2}
                placeholder={EXAMPLES[0]}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
              <div className="row mt-s" style={{ alignItems: "center" }}>
                <button className="btn" onClick={compose} disabled={drafting}>
                  {drafting && <span className="spin" />}
                  {drafting ? "Drafting…" : "Draft it"}
                </button>
                <span className="dim">The draft lands in the fields below. Nothing is saved until you say so.</span>
              </div>
            </div>
          )}

          <div className="stack">
            <label className="field">
              <span className="eyebrow">Name</span>
              <input
                className="input"
                value={draft.label}
                placeholder="Invoice reconciliation"
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </label>

            <label className="field">
              <span className="eyebrow">When an agent should reach for this</span>
              <input
                className="input"
                value={draft.description}
                placeholder="Matching a ledger export against a bank statement and reporting what does not line up."
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>

            <label className="field">
              <span className="eyebrow">Instructions — markdown</span>
              <textarea
                className="textarea mono"
                rows={18}
                placeholder={"## Matching\n1. Normalise both files to date, amount and reference.\n2. Match on reference first…"}
                value={draft.instructions}
                onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
              />
            </label>
          </div>

          <div className="panel-foot">
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
              {draft.instructions && (
                <button
                  type="button"
                  className="btn"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  onClick={() => downloadSkillMarkdown(draft)}
                  title="Download as Markdown file"
                >
                  <DownloadIcon /> Download .md
                </button>
              )}
            </div>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : draft.id ? "Save changes" : "Create skill"}
            </button>
          </div>
        </div>
      )}

      {skills.length > 0 && (
        <>
          <div className="filters">
            <input
              className="input search"
              value={term}
              placeholder="Search by name, summary or identifier"
              onChange={(e) => setTerm(e.target.value)}
            />
          </div>

          <div className="list-head">
            <span className="count">
              {shown.length} {shown.length === 1 ? "skill" : "skills"}
              {filtered && <span className="dim"> of {skills.length}</span>}
              {totalPages > 1 && (
                <span className="dim" style={{ marginLeft: 6 }}>
                  · Page {validPage} of {totalPages}
                </span>
              )}
              {filtered && (
                <button
                  className="link-btn"
                  onClick={() => {
                    setTerm("");
                    setPage(1);
                  }}
                >
                  clear
                </button>
              )}
            </span>
            <div className="seg" role="group" aria-label="View">
              {(["list", "grid"] as View[]).map((v) => (
                <button
                  key={v}
                  className={`seg-opt ${view === v ? "on" : ""}`}
                  onClick={() => choose(v)}
                  aria-pressed={view === v}
                >
                  {v === "list" ? "List" : "Grid"}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {loading ? (
        <div className="note">Loading skills…</div>
      ) : skills.length === 0 ? (
        <div className="empty">
          <h3>No skills yet</h3>
          <p>
            Write down something your team knows and every agent can be given it. Attach skills to an agent under{" "}
            <Link href="/agents">Agents</Link>, on the Instructions step.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <h3>Nothing matches</h3>
          <p>No skill matches that search. Widen the search or clear it.</p>
          <button className="btn mt-s" onClick={() => setTerm("")}>
            Clear search
          </button>
        </div>
      ) : view === "list" ? (
        <div className="table">
          <div className="tr th" style={{ gridTemplateColumns: rowCols }}>
            <div>Name</div>
            <div>When it is used</div>
            <div>Attached to</div>
            <div />
          </div>
          {paginatedShown.map((s) => (
            <div className="tr skill-row" key={s.id} style={{ gridTemplateColumns: rowCols }}>
              <div>
                <div className="name" title={s.label}>{s.label}</div>
                <div className="sub-line mono" title={s.name}>{s.name}</div>
              </div>
              <div className="sub-line" title={s.description || undefined}>{s.description || "No summary — an agent has nothing to judge on."}</div>
              <div>
                <span className={`pill ${s.used_by ? "green" : "grey"}`}>
                  {s.used_by ? `${s.used_by} ${s.used_by === 1 ? "agent" : "agents"}` : "Unattached"}
                </span>
              </div>
              <div className="row-actions">
                <button
                  className="icon-act"
                  onClick={() => downloadSkillMarkdown(s)}
                  aria-label={`Download ${s.label} as Markdown`}
                  title="Download .md"
                >
                  <DownloadIcon />
                </button>
                <button
                  className="icon-act"
                  onClick={() => editSkill(s)}
                  aria-label={`Edit ${s.label}`}
                  title="Edit"
                >
                  <EditIcon />
                </button>
                <button
                  className="icon-act del-btn"
                  onClick={() => remove(s)}
                  aria-label={`Delete ${s.label}`}
                  title="Delete"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="cards">
          {paginatedShown.map((s) => (
            <div key={s.id} className="card-wrap skill-card-wrap">
              <div
                className="card clickable"
                role="button"
                tabIndex={0}
                onClick={() => editSkill(s)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    editSkill(s);
                  }
                }}
                aria-label={`Edit ${s.label}`}
              >
                <div className="card-head">
                  <span className="tag mono" title={s.name}>{s.name}</span>
                  <span className={`pill ${s.used_by ? "green" : "grey"}`}>
                    {s.used_by ? `${s.used_by} ${s.used_by === 1 ? "agent" : "agents"}` : "Unattached"}
                  </span>
                </div>
                <div className="card-name" title={s.label}>{s.label}</div>
                <p className="card-desc" title={s.description || undefined}>{s.description || "No summary — an agent has nothing to judge on."}</p>
                <div className="card-foot">
                  <span className="card-meta">
                    {s.author ? `by ${s.author}` : "Skill"}
                  </span>
                </div>
              </div>
              <div className="card-actions">
                <button
                  className="icon-act"
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadSkillMarkdown(s);
                  }}
                  aria-label={`Download ${s.label} as Markdown`}
                  title="Download .md"
                >
                  <DownloadIcon />
                </button>
                <button
                  className="icon-act"
                  onClick={(e) => {
                    e.stopPropagation();
                    editSkill(s);
                  }}
                  aria-label={`Edit ${s.label}`}
                  title="Edit"
                >
                  <EditIcon />
                </button>
                <button
                  className="icon-act del-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(s);
                  }}
                  aria-label={`Delete ${s.label}`}
                  title="Delete"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {shown.length > 0 && (
        <Pagination
          currentPage={validPage}
          totalItems={shown.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          pageSizeOptions={[8, 16, 24, 48]}
          itemLabel="skill"
          itemLabelPlural="skills"
        />
      )}
    </div>
  );
}
