"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

const BLANK: Draft = { id: null, label: "", description: "", instructions: "" };

const EXAMPLES = [
  "How we reconcile an invoice against a bank statement — match on reference first, then on date and amount within two days, and report anything left over.",
  "Our house style for writing to customers: second person, no jargon, lead with what we are doing about it rather than with the apology.",
  "How we grade an inbound support ticket: what counts as P1, what we promise for each level, and when to escalate rather than reply.",
];

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [brief, setBrief] = useState("");
  const [drafting, setDrafting] = useState(false);

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
            <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : draft.id ? "Save changes" : "Create skill"}
            </button>
          </div>
        </div>
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
      ) : (
        <div className="table">
          <div className="tr th" style={{ gridTemplateColumns: "2fr 3fr 1fr .8fr" }}>
            <div>Name</div>
            <div>When it is used</div>
            <div>Attached to</div>
            <div />
          </div>
          {skills.map((s) => (
            <div className="tr" key={s.id} style={{ gridTemplateColumns: "2fr 3fr 1fr .8fr" }}>
              <div>
                <div className="name">{s.label}</div>
                <div className="sub-line mono">{s.name}</div>
              </div>
              <div className="sub-line">{s.description || "No summary — an agent has nothing to judge on."}</div>
              <div className="sub-line">
                {s.used_by ? `${s.used_by} agent${s.used_by > 1 ? "s" : ""}` : "No agent yet"}
              </div>
              <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setNote("");
                    setDraft({ id: s.id, label: s.label, description: s.description, instructions: s.instructions });
                  }}
                >
                  Edit
                </button>
                <button className="btn btn-ghost" onClick={() => remove(s)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
