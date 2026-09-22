"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ARCHETYPES, INPUT_TYPES, inputKey, normaliseInputs, specSkillIds, type AgentSpec, type SpecInput } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/format";
import VersionDiff, { DiffView } from "@/components/VersionDiff";
import { diffSpecs } from "@/lib/spec-diff";
import ExportAgentModal from "@/components/ExportAgentModal";
import SchedulePublishModal from "@/components/SchedulePublishModal";
import RunAgentModal from "@/components/RunAgentModal";
import SwarmCanvas from "./SwarmCanvas";
import LivePlayground from "./LivePlayground";
import TriggerConfigPanel from "./TriggerConfigPanel";
import AgentEvalsView from "./AgentEvalsView";
import GuardrailsConfigCard from "./GuardrailsConfigCard";
import { downloadSkillMarkdown } from "@/lib/skill-export";

type ToolInfo = { id: string; label: string; description: string; risk: "low" | "medium" | "high"; needs: string | null };
type Conn = { id: string; name: string; kind: string; config: any };
type SkillInfo = { id: string; name: string; label: string; description: string; instructions?: string };

const STEPS = ["Brief", "Data", "Instructions", "Actions", "Trigger", "Review", "Test & Run"];

const EXAMPLES = [
  "Every Monday, pull last week's support tickets from our Postgres database, group them by theme, and post the top five recurring issues to Slack with counts.",
  "Research a company I name: search the web for their recent announcements, funding and leadership changes, then write a one-page briefing as a markdown file.",
  "Read the uploaded vendor contract, compare its payment and termination terms against our standard positions, and email me a summary of anything that deviates.",
];

const riskColor = (r: string) => (r === "high" ? "var(--red)" : r === "medium" ? "var(--amber)" : "var(--muted)");

export default function Builder({
  agentId,
  initialSpec,
  status,
  publishedVer,
  updatedAt,
  tools,
  connections,
  skills,
  versions,
  runs,
  timezone,
  publishedSpec,
  canPublish,
  workspaceAgents = [],
}: {
  agentId: string;
  initialSpec: AgentSpec;
  status: string;
  publishedVer: number | null;
  updatedAt?: string | null;
  tools: ToolInfo[];
  connections: Conn[];
  skills: SkillInfo[];
  versions: any[];
  runs: any[];
  timezone: string;
  publishedSpec: AgentSpec | null;
  canPublish: boolean;
  workspaceAgents?: { id: string; name: string; description: string; archetype: string }[];
}) {
  const router = useRouter();
  const [spec, setSpec] = useState<AgentSpec>(initialSpec);
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<"build" | "swarm" | "playground" | "evals" | "runs" | "versions">("build");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [runInput, setRunInput] = useState("");
  const [compare, setCompare] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [runModalConfig, setRunModalConfig] = useState<{ useDraft: boolean; dryRun: boolean }>({
    useDraft: true,
    dryRun: false,
  });

  const nextVer = (publishedVer || 0) + 1;
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date>(() =>
    updatedAt ? new Date(updatedAt) : new Date(Date.now() - 2 * 60 * 1000)
  );
  const [autosaveText, setAutosaveText] = useState("Autosaved 2 min ago");
  const [isDirty, setIsDirty] = useState(false);
  const prevSpecRef = useRef<AgentSpec>(initialSpec);

  // Compute autosave relative timing text
  useEffect(() => {
    const updateAutosaveText = () => {
      const diffSec = Math.floor((Date.now() - lastSavedAt.getTime()) / 1000);
      if (diffSec < 45) {
        setAutosaveText("Autosaved just now");
      } else if (diffSec < 90) {
        setAutosaveText("Autosaved 1 min ago");
      } else {
        const min = Math.floor(diffSec / 60);
        setAutosaveText(`Autosaved ${min} min ago`);
      }
    };
    updateAutosaveText();
    const interval = setInterval(updateAutosaveText, 10000);
    return () => clearInterval(interval);
  }, [lastSavedAt]);

  // Handle outside click & escape to close publish dropdown
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [dropdownOpen]);

  // Track spec edits for autosaving
  useEffect(() => {
    if (JSON.stringify(prevSpecRef.current) !== JSON.stringify(spec)) {
      setIsDirty(true);
      prevSpecRef.current = spec;
    }
  }, [spec]);

  // Debounced autosave to draft
  useEffect(() => {
    if (!isDirty || busy === "save" || busy === "publish") return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/agents/${agentId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spec }),
        });
        if (res.ok) {
          setLastSavedAt(new Date());
          setAutosaveText("Autosaved just now");
          setIsDirty(false);
        }
      } catch {
        // quiet fail on background autosave
      }
    }, 3500);
    return () => clearTimeout(timer);
  }, [isDirty, spec, agentId, busy]);

  const set = (patch: Partial<AgentSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const toolOf = (id: string) => tools.find((t) => t.id === id);

  const save = async () => {
    setBusy("save");
    const res = await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec }),
    });
    setBusy(null);
    if (res.ok) {
      setLastSavedAt(new Date());
      setAutosaveText("Autosaved just now");
      setIsDirty(false);
      setMsg({ kind: "ok", text: "Draft saved." });
    } else {
      setMsg({ kind: "err", text: "The draft could not be saved." });
    }
    router.refresh();
  };

  const publish = async () => {
    setBusy("publish");
    await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec }),
    });
    const res = await fetch(`/api/agents/${agentId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "" }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return setMsg({ kind: "err", text: data.error });
    setMsg({ kind: "ok", text: `Published as version ${data.version}.` });
    router.refresh();
  };

  const handleConfirmSchedule = async (datetime: string, note: string) => {
    await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec }),
    });
    setLastSavedAt(new Date());
    setAutosaveText("Autosaved just now");

    const formattedDate = new Date(datetime).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    setMsg({
      kind: "ok",
      text: `Publication scheduled: Version v${nextVer} will automatically go live on ${formattedDate}.`,
    });
  };

  const run = async (useDraft: boolean, dryRun = false) => {
    setBusy("run");
    await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec }),
    });
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, input: runInput, useDraft, dryRun }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return setMsg({ kind: "err", text: data.error });
    router.push(`/runs/${data.runId}`);
  };

  return (
    <div className="page">
      <header className="builder-head">
        <div className="builder-title-group">
          <Link href="/agents" className="builder-back-link">
            ← Agents
          </Link>
          <div className="builder-title-row">
            <h1 className="builder-agent-title">{spec.name || "New agent"}</h1>
            <span className={`builder-draft-pill ${status === "published" && !isDirty ? "published" : ""}`}>
              {status === "published" && !isDirty ? `Live · v${publishedVer}` : `Draft · v${nextVer}`}
            </span>
          </div>
          <div className="builder-status-row">
            <svg
              className="builder-status-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <span>
              {autosaveText} · Live: {publishedVer ? `v${publishedVer}` : "none"}
            </span>
            {spec.domain && <span className="tag" style={{ marginLeft: 6 }}>{spec.domain}</span>}
            {spec.archetype && (
              <span className="tag">{ARCHETYPES.find((a) => a.id === spec.archetype)?.label}</span>
            )}
          </div>
        </div>

        <div className="builder-head-actions">
          <button
            type="button"
            className="builder-btn-subtle"
            onClick={save}
            disabled={busy === "save"}
            title="Save draft"
          >
            {busy === "save" ? "Saving..." : "Save draft"}
          </button>

          <button
            type="button"
            className="builder-btn-icon"
            onClick={() => setExportOpen(true)}
            title="Export to cloud (GCP, AWS, Azure)"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
              <path d="M12 12v9" />
              <path d="m16 16-4-4-4 4" />
            </svg>
          </button>

          <div className="builder-split-btn" ref={dropdownRef}>
            <button
              type="button"
              className="builder-split-main"
              onClick={publish}
              disabled={busy === "publish" || !canPublish}
              title={canPublish ? `Publish version v${nextVer}` : "Only the workspace owner and admins can publish"}
            >
              {busy === "publish" && <span className="spin" />}
              Publish v{nextVer}
            </button>
            <div className="builder-split-divider" />
            <button
              type="button"
              className={`builder-split-arrow ${dropdownOpen ? "open" : ""}`}
              onClick={() => setDropdownOpen((v) => !v)}
              aria-label="Publish options"
              aria-expanded={dropdownOpen}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {dropdownOpen && (
              <div className="builder-publish-menu">
                <button
                  type="button"
                  className="builder-menu-item"
                  onClick={() => {
                    setDropdownOpen(false);
                    publish();
                  }}
                  disabled={busy === "publish" || !canPublish}
                >
                  <div className="builder-menu-icon">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
                    </svg>
                  </div>
                  <div className="builder-menu-content">
                    <div className="builder-menu-title">Publish v{nextVer}</div>
                    <div className="builder-menu-sub">
                      {publishedVer ? `Replaces v${publishedVer} for all users` : "Makes agent live for all users"}
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  className="builder-menu-item"
                  onClick={() => {
                    setDropdownOpen(false);
                    setScheduleModalOpen(true);
                  }}
                >
                  <div className="builder-menu-icon">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M8 2v4" />
                      <path d="M16 2v4" />
                      <rect width="18" height="18" x="3" y="4" rx="2" />
                      <path d="M3 10h18" />
                      <circle cx="16" cy="16" r="3" />
                      <path d="M16 15v1.5l1 1" />
                    </svg>
                  </div>
                  <div className="builder-menu-content">
                    <div className="builder-menu-title">Schedule publish</div>
                    <div className="builder-menu-sub">Go live at a set time</div>
                  </div>
                </button>

                <div className="builder-menu-sep" />

                <button
                  type="button"
                  className="builder-menu-item"
                  onClick={() => {
                    setDropdownOpen(false);
                    setExportOpen(true);
                  }}
                >
                  <div className="builder-menu-icon">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                      <path d="M12 12v9" />
                      <path d="m16 16-4-4-4 4" />
                    </svg>
                  </div>
                  <div className="builder-menu-content">
                    <div className="builder-menu-title">Export to cloud</div>
                    <div className="builder-menu-sub">Download or push config</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {msg && <div className={msg.kind === "ok" ? "ok-note" : "error"} style={{ marginBottom: 14 }}>{msg.text}</div>}

      <SpecStrip spec={spec} />

      <div className="tabs">
        {(
          [
            { id: "build", label: "Build & Spec" },
            { id: "swarm", label: "⚡ Multi-Agent Swarm" },
            { id: "playground", label: "🔬 Live Playground" },
            { id: "evals", label: "🎯 Evals & Tests" },
            { id: "runs", label: `Runs (${runs.length})` },
            { id: "versions", label: `Versions (${versions.length})` },
          ] as const
        ).map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "build" && (
        <>
          <ol className="stepper">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button className={`step ${i === step ? "on" : ""} ${i < step ? "done" : ""}`} onClick={() => setStep(i)}>
                  <span className="n">{String(i + 1).padStart(2, "0")}</span>
                  {s}
                </button>
              </li>
            ))}
          </ol>

          <div className="panel">
            {step === 0 && <Brief spec={spec} set={set} onCompiled={() => setStep(1)} setMsg={setMsg} />}
            {step === 1 && <Data spec={spec} set={set} connections={connections} tools={tools} />}
            {step === 2 && <Instructions spec={spec} set={set} skills={skills} />}
            {step === 3 && <Actions spec={spec} set={set} tools={tools} connections={connections} />}
            {step === 4 && (
              <TriggerConfigPanel
                spec={spec}
                set={set}
                agentId={agentId}
                agentName={spec.name || "Agent"}
                timezone={timezone}
                agentStatus={status}
              />
            )}
            {step === 5 && (
              <Review
                spec={spec}
                tools={tools}
                connections={connections}
                skills={skills}
                publishedSpec={publishedSpec}
                publishedVer={publishedVer}
                canPublish={canPublish}
                onPublish={publish}
                onExport={() => setExportOpen(true)}
                runInput={runInput}
                setRunInput={setRunInput}
                onRun={() => {
                  setRunModalConfig({ useDraft: true, dryRun: false });
                  setRunModalOpen(true);
                }}
                onRehearse={() => {
                  setRunModalConfig({ useDraft: true, dryRun: true });
                  setRunModalOpen(true);
                }}
                busy={busy}
              />
            )}
            {step === 6 && (
              <TestAndRunStep
                agentId={agentId}
                spec={spec}
                publishedVer={publishedVer}
                onRunDraft={() => {
                  setRunModalConfig({ useDraft: true, dryRun: false });
                  setRunModalOpen(true);
                }}
                onRehearseDraft={() => {
                  setRunModalConfig({ useDraft: true, dryRun: true });
                  setRunModalOpen(true);
                }}
                onRunLive={() => {
                  setRunModalConfig({ useDraft: false, dryRun: false });
                  setRunModalOpen(true);
                }}
              />
            )}
            <div className="panel-foot">
              <button className="btn" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
                Back
              </button>
              <button className="btn primary" onClick={() => setStep(Math.min(6, step + 1))} disabled={step === 6}>
                {step === 5 ? "Proceed to Test & Run →" : "Continue"}
              </button>
            </div>
          </div>
        </>
      )}

      {tab === "swarm" && (
        <SwarmCanvas
          agentId={agentId}
          agentName={spec.name || "Agent"}
          initialSwarm={spec.swarm}
          availableAgents={workspaceAgents}
          onSaved={(newSwarm) => setSpec((prev) => ({ ...prev, swarm: newSwarm }))}
        />
      )}

      {tab === "playground" && (
        <LivePlayground
          agentId={agentId}
          agentName={spec.name || "Agent"}
          spec={spec}
          publishedVer={publishedVer}
        />
      )}


      {tab === "evals" && (
        <AgentEvalsView
          agentId={agentId}
          agentName={spec.name || "Agent"}
          spec={spec}
          publishedVer={publishedVer}
        />
      )}

      {tab === "runs" && (
        <div className="panel">
          <h2>Recent runs</h2>
          {runs.length === 0 ? (
            <div className="note mt">No runs yet.</div>
          ) : (
            <div className="table mt">
              {runs.map((r) => (
                <Link key={r.id} href={`/runs/${r.id}`} className="tr link" style={{ gridTemplateColumns: "1fr 1fr 2fr" }}>
                  <div className="mono dim">{formatDateTime(r.started_at, timezone)}</div>
                  <div>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="sub-line">{r.input || "No input"}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "versions" && (
        <div className="panel">
          <h2>Version history</h2>
          {versions.length === 0 ? (
            <div className="note mt">Not published yet. Publishing creates version 1.</div>
          ) : (
            <div className="table mt">
              {versions.map((v) => (
                <div key={v.version} className="tr static" style={{ gridTemplateColumns: "110px 1fr 200px" }}>
                  <div className="row">
                    <strong className="mono">v{v.version}</strong>
                    {v.version === publishedVer && <span className="pill green">Live</span>}
                  </div>
                  <div>
                    {v.note}
                    {v.version > 1 && (
                      <button
                        className="link-btn"
                        onClick={() => setCompare(compare === v.version ? null : v.version)}
                      >
                        {compare === v.version ? "hide changes" : `what changed from v${v.version - 1}`}
                      </button>
                    )}
                    {compare === v.version && (
                      <VersionDiff
                        agentId={agentId}
                        from={String(v.version - 1)}
                        to={String(v.version)}
                        title={`v${v.version - 1} → v${v.version}`}
                      />
                    )}
                  </div>
                  <div className="mono dim">
                    {v.by} · {formatDate(v.created_at, timezone)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ExportAgentModal
        agentId={agentId}
        agentName={spec.name || "Agent"}
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
      />

      <SchedulePublishModal
        agentId={agentId}
        agentName={spec.name || "Agent"}
        nextVer={nextVer}
        publishedVer={publishedVer}
        isOpen={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        onConfirmSchedule={handleConfirmSchedule}
      />

      <RunAgentModal
        isOpen={runModalOpen}
        onClose={() => setRunModalOpen(false)}
        agentId={agentId}
        agentName={spec.name || "Agent"}
        spec={spec}
        publishedVer={publishedVer}
        initialUseDraft={runModalConfig.useDraft}
        initialDryRun={runModalConfig.dryRun}
      />
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "green",
    running: "grey",
    awaiting_approval: "amber",
    failed: "red",
    rejected: "red",
  };
  const label: Record<string, string> = {
    completed: "Completed",
    running: "Running",
    awaiting_approval: "Waiting on you",
    failed: "Failed",
    rejected: "Rejected",
  };
  return <span className={`pill ${map[status] || "grey"}`}>{label[status] || status}</span>;
}

function SpecStrip({ spec }: { spec: AgentSpec }) {
  const gated = spec.tools.filter((t) => t.gate === "approval").length;
  const cells = [
    { label: "Sources", value: spec.sources.length ? `${spec.sources.length} connected` : "None", on: spec.sources.length > 0 },
    { label: "Instructions", value: spec.steps.length ? `${spec.steps.length} steps` : "None", on: spec.steps.length > 0 },
    { label: "Actions", value: spec.tools.length ? `${spec.tools.length} granted · ${gated} gated` : "None", on: spec.tools.length > 0 },
    { label: "Guardrails", value: `${spec.guardrails.maxSteps} step budget`, on: true },
  ];
  return (
    <div className="strip">
      {cells.map((c, i) => (
        <div key={c.label} style={{ display: "contents" }}>
          <div className={`strip-cell ${c.on ? "on" : ""}`}>
            <div className="eyebrow">{c.label}</div>
            <div className="strip-val">{c.value}</div>
          </div>
          {i < cells.length - 1 && <div className={`strip-link ${c.on ? "on" : ""}`} />}
        </div>
      ))}
    </div>
  );
}

/* ── step 1 ───────────────────────────────────────────────── */

function Brief({
  spec,
  set,
  onCompiled,
  setMsg,
}: {
  spec: AgentSpec;
  set: (p: Partial<AgentSpec>) => void;
  onCompiled: () => void;
  setMsg: (m: any) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");

  const compile = async () => {
    setBusy(true);
    setMsg(null);
    const phases = ["Reading the brief", "Matching your connections", "Choosing tools and risk levels", "Assembling the specification"];
    let i = 0;
    setPhase(phases[0]);
    const tick = setInterval(() => setPhase(phases[(i = Math.min(i + 1, phases.length - 1))]), 1500);
    try {
      const res = await fetch("/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief: spec.brief }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      set({ ...data.spec, guardrails: spec.guardrails });
      onCompiled();
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message || "The brief could not be compiled." });
    } finally {
      clearInterval(tick);
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>Describe the work</h2>
      <p className="help">
        Write it the way you would explain it to a new colleague. Name the systems, the rule, and what you want at the end.
      </p>
      <textarea
        className="textarea"
        rows={6}
        placeholder="Every Monday morning…"
        value={spec.brief}
        onChange={(e) => set({ brief: e.target.value })}
      />
      <div className="eyebrow mt">Start from one of these</div>
      <div className="stack mt-s">
        {EXAMPLES.map((b, i) => (
          <button key={i} className="example" onClick={() => set({ brief: b })}>
            {b}
          </button>
        ))}
      </div>
      <div className="row mt">
        <button className="btn primary" onClick={compile} disabled={busy || !spec.brief.trim()}>
          {busy && <span className="spin" />}
          {busy ? "Drafting" : "Draft this agent"}
        </button>
        {busy && <span className="mono dim">{phase}</span>}
      </div>
    </div>
  );
}

/* ── step 2 helper functions ─────────────────────────────── */

type ConnectionRecommendation = {
  kind: string;
  label: string;
  reason: string;
};

function getRecommendedConnectionKinds(spec: AgentSpec, tools: ToolInfo[]): ConnectionRecommendation[] {
  const corpus = `${spec.brief || ""} ${spec.purpose || ""} ${(spec.steps || []).join(" ")}`.toLowerCase();
  const recs: ConnectionRecommendation[] = [];
  const added = new Set<string>();

  // Check required connections from already selected tools
  for (const t of spec.tools || []) {
    const def = tools.find((x) => x.id === t.id);
    if (def?.needs && !added.has(def.needs)) {
      added.add(def.needs);
      recs.push({
        kind: def.needs,
        label: def.needs.toUpperCase(),
        reason: `Required by granted tool "${def.label}"`,
      });
    }
  }

  // Check text corpus keywords
  const checks: { kind: string; label: string; keywords: string[]; reason: string }[] = [
    {
      kind: "postgres",
      label: "PostgreSQL Database",
      keywords: ["postgres", "postgresql", "sql", "database", "query", "table", "schema", "records"],
      reason: "Querying relational data and tables",
    },
    {
      kind: "slack",
      label: "Slack Workspace",
      keywords: ["slack", "channel", "#", "post message", "chat alert", "bot message"],
      reason: "Posting updates and alerts to Slack",
    },
    {
      kind: "smtp",
      label: "Email / SMTP",
      keywords: ["email", "mail", "gmail", "smtp", "send email", "inbox"],
      reason: "Dispatching reports or notifications by email",
    },
    {
      kind: "jira",
      label: "Jira Software",
      keywords: ["jira", "ticket", "issue", "sprint", "backlog", "epic"],
      reason: "Creating or querying Jira tickets",
    },
    {
      kind: "github",
      label: "GitHub",
      keywords: ["github", "repo", "repository", "pull request", "pr", "commit", "git"],
      reason: "Inspecting repositories, code, and PRs",
    },
    {
      kind: "google_drive",
      label: "Google Drive",
      keywords: ["google drive", "drive", "gdrive", "docs", "sheets", "spreadsheet"],
      reason: "Reading documents, sheets, and drive files",
    },
    {
      kind: "google_calendar",
      label: "Google Calendar",
      keywords: ["calendar", "schedule", "meeting", "events", "invite"],
      reason: "Managing events and schedule availability",
    },
    {
      kind: "canva",
      label: "Canva",
      keywords: ["canva", "design", "graphic", "banner", "social post"],
      reason: "Generating or updating visual brand assets",
    },
    {
      kind: "msteams",
      label: "Microsoft Teams",
      keywords: ["teams", "microsoft teams", "msteams"],
      reason: "Posting notifications to Microsoft Teams",
    },
    {
      kind: "s3",
      label: "Amazon S3",
      keywords: ["s3", "bucket", "object storage", "cloud storage"],
      reason: "Storing files or data artifacts in cloud storage",
    },
    {
      kind: "http",
      label: "REST API (HTTP)",
      keywords: ["api", "endpoint", "rest", "webhook", "http", "curl"],
      reason: "Calling external REST services and webhooks",
    },
    {
      kind: "redis",
      label: "Redis Cache / KV",
      keywords: ["redis", "kv", "cache", "key-value"],
      reason: "Fast key-value cache and shared state",
    },
  ];

  for (const c of checks) {
    if (!added.has(c.kind) && c.keywords.some((kw) => corpus.includes(kw))) {
      added.add(c.kind);
      recs.push({ kind: c.kind, label: c.label, reason: c.reason });
    }
  }

  return recs;
}

type SuggestedInput = {
  label: string;
  hint: string;
  type: SpecInput["type"];
  required: boolean;
  options?: string[];
  description: string;
};

function getArchetypeInputSuggestions(archetype?: string): SuggestedInput[] {
  const arch = (archetype || "analyst").toLowerCase();
  if (arch === "analyst") {
    return [
      {
        label: "Source Ledger / Report",
        type: "file",
        required: true,
        hint: "Upload CSV, Excel, or PDF report to analyze",
        description: "Primary data file",
      },
      {
        label: "Analysis Cutoff Date",
        type: "date",
        required: false,
        hint: "End date for the reporting window",
        description: "Period cutoff",
      },
      {
        label: "Variance Threshold (%)",
        type: "number",
        required: false,
        hint: "Flag any variance exceeding this % (e.g. 5)",
        description: "Anomaly threshold",
      },
      {
        label: "Reporting Currency",
        type: "choice",
        required: false,
        options: ["USD", "EUR", "GBP", "CAD", "AUD"],
        hint: "Output currency denomination",
        description: "Currency standard",
      },
    ];
  }
  if (arch === "author") {
    return [
      {
        label: "Background Brief / Outline",
        type: "file",
        required: false,
        hint: "PDF, Word, or text notes with source material",
        description: "Source notes",
      },
      {
        label: "Target Audience",
        type: "choice",
        required: true,
        options: ["Executive Leadership", "Technical Engineering", "General Public", "Customer Facing"],
        hint: "Tone and depth calibration",
        description: "Audience tone",
      },
      {
        label: "Key Themes / Topics",
        type: "text",
        required: false,
        hint: "Bullet points or concepts that must be included",
        description: "Core topics",
      },
      {
        label: "Max Word Count",
        type: "number",
        required: false,
        hint: "Target length (e.g. 800)",
        description: "Length limit",
      },
    ];
  }
  if (arch === "operator") {
    return [
      {
        label: "Item / Ticket Identifier",
        type: "text",
        required: true,
        hint: "e.g. JIRA-4291 or Order #99102",
        description: "Target ID",
      },
      {
        label: "Execution Mode",
        type: "choice",
        required: true,
        options: ["Dry Run (Simulate & Report)", "Commit Changes"],
        hint: "Safety dry-run mode",
        description: "Safety mode",
      },
      {
        label: "Change Reason / Audit Note",
        type: "text",
        required: false,
        hint: "Context logged in the audit trail",
        description: "Audit compliance",
      },
    ];
  }
  if (arch === "sentinel") {
    return [
      {
        label: "Alert Severity Threshold",
        type: "choice",
        required: true,
        options: ["Low and Above (All)", "Medium & High", "Critical Only"],
        hint: "Notification filter level",
        description: "Filter level",
      },
      {
        label: "Scan Window (Hours)",
        type: "number",
        required: false,
        hint: "How many hours back to inspect (e.g. 24)",
        description: "Inspection window",
      },
      {
        label: "Notification Channel",
        type: "text",
        required: false,
        hint: "Specific Slack channel or recipient email",
        description: "Routing target",
      },
    ];
  }
  return [
    {
      label: "Reference Document",
      type: "file",
      required: false,
      hint: "Upload reference data or guidelines",
      description: "Reference file",
    },
    {
      label: "Target Scope / Department",
      type: "text",
      required: false,
      hint: "Specific domain or department name",
      description: "Scope filter",
    },
  ];
}

/* ── step 2 ───────────────────────────────────────────────── */

function Data({
  spec,
  set,
  connections,
  tools,
}: {
  spec: AgentSpec;
  set: (p: Partial<AgentSpec>) => void;
  connections: Conn[];
  tools: ToolInfo[];
}) {
  const inputs = normaliseInputs(spec.inputs as any[]);
  const setInput = (idx: number, patch: Partial<SpecInput>) =>
    set({ inputs: inputs.map((i, n) => (n === idx ? { ...i, ...patch } : i)) });
  const addInput = () =>
    set({ inputs: [...inputs, { key: `input_${inputs.length + 1}`, label: "", hint: "", type: "text", required: false }] });
  const removeInput = (idx: number) => set({ inputs: inputs.filter((_, n) => n !== idx) });

  const toggle = (c: Conn) => {
    const on = spec.sources.some((s) => s.connectionId === c.id);
    set({
      sources: on ? spec.sources.filter((s) => s.connectionId !== c.id) : [...spec.sources, { connectionId: c.id, label: c.name }],
    });
  };

  const recKinds = getRecommendedConnectionKinds(spec, tools);
  const recConns = connections.filter((c) => recKinds.some((r) => r.kind === c.kind));
  const unconfiguredKinds = recKinds.filter((r) => !connections.some((c) => c.kind === r.kind));

  const needed = new Set(spec.tools.map((t) => tools.find((x) => x.id === t.id)?.needs).filter(Boolean) as string[]);
  const missing = [...needed].filter((k) => !spec.sources.some((s) => connections.find((c) => c.id === s.connectionId)?.kind === k));

  const archetypeSuggestions = getArchetypeInputSuggestions(spec.archetype);
  const availableSuggestions = archetypeSuggestions.filter(
    (s) => !inputs.some((i) => i.label.toLowerCase() === s.label.toLowerCase() || i.key === inputKey(s.label, 0))
  );

  const addSuggestedInput = (s: SuggestedInput) => {
    const newKey = inputKey(s.label, inputs.length);
    set({
      inputs: [
        ...inputs,
        {
          key: newKey,
          label: s.label,
          hint: s.hint,
          type: s.type,
          required: s.required,
          ...(s.options ? { options: s.options } : {}),
        },
      ],
    });
  };

  const addAllSuggestions = () => {
    const toAdd = availableSuggestions.map((s, idx) => ({
      key: inputKey(s.label, inputs.length + idx),
      label: s.label,
      hint: s.hint,
      type: s.type,
      required: s.required,
      ...(s.options ? { options: s.options } : {}),
    }));
    set({ inputs: [...inputs, ...toAdd] });
  };

  const attachedCount = spec.sources.length;

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2>Data & Inputs</h2>
        <p className="help">
          Grant what information this agent has access to. Information is split into two scopes:
          <strong> Enterprise Connections</strong> (shared live databases, APIs, and cloud services) and
          <strong> Run Form Inputs</strong> (parameters and files requested from the user each time they trigger a run).
        </p>
      </div>

      {/* Smart Recommendations banner if detected */}
      {recKinds.length > 0 && (
        <div className="banner-suggest">
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span className="badge-rec">✨ Smart Suggestions</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                Recommended integrations for your prompt
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Based on your brief and selected tools, this agent may benefit from:{" "}
              {recKinds.map((r, i) => (
                <span key={r.kind} style={{ fontWeight: 550, color: "var(--ink)" }}>
                  {r.label} ({r.reason}){i < recKinds.length - 1 ? ", " : ""}
                </span>
              ))}
            </div>
          </div>
          {recConns.some((c) => !spec.sources.some((s) => s.connectionId === c.id)) && (
            <button
              className="btn btn-sm"
              onClick={() => {
                const toAttach = recConns
                  .filter((c) => !spec.sources.some((s) => s.connectionId === c.id))
                  .map((c) => ({ connectionId: c.id, label: c.name }));
                set({ sources: [...spec.sources, ...toAttach] });
              }}
            >
              Attach Recommended ({recConns.filter((c) => !spec.sources.some((s) => s.connectionId === c.id)).length})
            </button>
          )}
        </div>
      )}

      {/* Section A: Enterprise Connections */}
      <div className="subcard">
        <div className="subcard-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h3 className="subcard-title">Enterprise Connections & Integrations</h3>
              <span className="pill static" style={{ fontSize: 10 }}>
                {attachedCount} attached
              </span>
            </div>
            <p className="sub-line" style={{ marginTop: 3 }}>
              Shared across your workspace. Credentials stay encrypted on the server — the agent receives safe execution capability, never secrets.
            </p>
          </div>
          <Link href="/connections" className="sub-line" style={{ color: "var(--link)", fontWeight: 550 }}>
            Manage Connections ↗
          </Link>
        </div>

        {connections.length === 0 ? (
          <div className="note">
            No connections configured in this workspace yet. Web search, fetching a URL, and reading uploaded run form files
            work without one — integrations with external databases or services need a connection.{" "}
            <Link href="/connections" style={{ color: "var(--link)", fontWeight: 550 }}>Configure connections</Link>.
          </div>
        ) : (
          <div className="stack">
            {connections.map((c) => {
              const on = spec.sources.some((s) => s.connectionId === c.id);
              const isRec = recKinds.some((r) => r.kind === c.kind);
              const recInfo = recKinds.find((r) => r.kind === c.kind);
              return (
                <div key={c.id} className={`tool-row ${on ? "on" : ""}`}>
                  <button className="tool-main" onClick={() => toggle(c)}>
                    <span className={`check ${on ? "on" : ""}`} />
                    <span>
                      <span className="tool-label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {c.name}
                        {isRec && <span className="badge-rec">✨ Recommended</span>}
                      </span>
                      <span className="sub-line">
                        {c.kind}
                        {c.config?.baseUrl ? ` · ${c.config.baseUrl}` : ""}
                        {c.config?.host ? ` · ${c.config.host}` : ""}
                        {isRec && recInfo ? ` — ${recInfo.reason}` : ""}
                      </span>
                    </span>
                  </button>
                  <div className="row" style={{ alignItems: "center", gap: 8 }}>
                    <span className="eyebrow">{c.kind}</span>
                    <button
                      className={on ? "btn btn-ghost" : "btn"}
                      style={{ fontSize: 11, padding: "4px 10px" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(c);
                      }}
                    >
                      {on ? "Disconnect" : "Attach"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {unconfiguredKinds.length > 0 && (
          <div className="note mt-s" style={{ background: "#f8f9fa", border: "1px dashed var(--line)" }}>
            💡 <strong>Integrations to consider:</strong> Your prompt suggests using{" "}
            {unconfiguredKinds.map((u) => u.label).join(", ")}, which hasn&apos;t been connected in this workspace yet.{" "}
            <Link href="/connections" style={{ color: "var(--link)", fontWeight: 550 }}>Add it under Connections</Link>.
          </div>
        )}

        {missing.length > 0 && (
          <div className="error mt">
            ⚠️ The tools granted in Step 4 require a <strong>{missing.join(" and ")}</strong> connection.
            Please attach one above or adjust actions in Step 4.
          </div>
        )}
      </div>

      {/* Section B: Run Form Inputs */}
      <div className="subcard">
        <div className="subcard-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h3 className="subcard-title">Run Form Inputs</h3>
              <span className="pill static" style={{ fontSize: 10 }}>
                {inputs.length} fields
              </span>
            </div>
            <p className="sub-line" style={{ marginTop: 3 }}>
              Form parameters and files requested from the user each time a run is triggered.
            </p>
          </div>
          {availableSuggestions.length > 0 && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={addAllSuggestions}
            >
              + Add All Suggested ({availableSuggestions.length})
            </button>
          )}
        </div>

        {/* Archetype suggestions chips */}
        {availableSuggestions.length > 0 && (
          <div
            style={{
              marginBottom: 16,
              padding: "12px 14px",
              background: "#f9fbfe",
              borderRadius: "var(--radius)",
              border: "1px dashed rgba(0,94,184,0.3)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span className="badge-rec">✨ Suggested for {spec.archetype ? spec.archetype.toUpperCase() : "THIS AGENT"}</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Click to add parameters to the run form:</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {availableSuggestions.map((s, idx) => (
                <button
                  key={idx}
                  className="chip-suggest"
                  onClick={() => addSuggestedInput(s)}
                  title={s.hint}
                >
                  <span>+</span>
                  <span>{s.label}</span>
                  <span style={{ opacity: 0.65, fontSize: 10, textTransform: "uppercase" }}>({s.type})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {inputs.length === 0 ? (
          <div className="note">
            Nothing is asked for at run time. This agent will run strictly on attached connections and default instructions.
          </div>
        ) : (
          <div className="stack">
            {inputs.map((i, idx) => (
              <div className="panel input-row" key={idx}>
                <div className="grid2">
                  <label className="field">
                    <span className="eyebrow">Field Label</span>
                    <input
                      className="input"
                      value={i.label}
                      placeholder="e.g. Ledger Statement or Target Project"
                      onChange={(e) => setInput(idx, { label: e.target.value, key: inputKey(e.target.value, idx) })}
                    />
                  </label>
                  <label className="field">
                    <span className="eyebrow">Input Type</span>
                    <select
                      className="input"
                      value={i.type}
                      onChange={(e) => setInput(idx, { type: e.target.value as SpecInput["type"] })}
                    >
                      {INPUT_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>{t.label} — {t.blurb}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="field mt-s">
                  <span className="eyebrow">User Guidance / Hint</span>
                  <input
                    className="input"
                    value={i.hint}
                    placeholder="Instructions for the user filling out this field"
                    onChange={(e) => setInput(idx, { hint: e.target.value })}
                  />
                </label>
                {i.type === "choice" && (
                  <label className="field mt-s">
                    <span className="eyebrow">Choices (comma separated)</span>
                    <input
                      className="input"
                      value={(i.options ?? []).join(", ")}
                      placeholder="Monthly, Quarterly, Annual"
                      onChange={(e) => setInput(idx, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                    />
                  </label>
                )}
                <div className="row mt-s" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <label className="row" style={{ gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={i.required}
                      onChange={(e) => setInput(idx, { required: e.target.checked })}
                    />
                    <span className="sub-line">Required field (run cannot proceed without it)</span>
                  </label>
                  <button className="btn btn-ghost btn-danger" onClick={() => removeInput(idx)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button className="btn mt" onClick={addInput}>+ Add custom run form field</button>
      </div>
    </div>
  );
}

/* ── step 3 ───────────────────────────────────────────────── */

/* ── step 3 helper functions ─────────────────────────────── */

function classifySkill(label: string, desc: string): string {
  const text = `${label} ${desc}`.toLowerCase();
  if (text.match(/reconcil|ledger|trial balance|balance sheet|substantiat|accrual|cut-off|suspense/)) {
    return "Reconciliation";
  }
  if (text.match(/budget|forecast|variance|fpa|fp&a|modelling|scenario|kpi|board pack|valuation|appraisal|indirect spend|headcount/)) {
    return "Reporting & FP&A";
  }
  if (text.match(/risk|fraud|audit|anomaly|screening|sox|hygiene|governance|compliance|tax|vat|gst|treaty|covenant|pbc|distress/)) {
    return "Audit & Risk";
  }
  if (text.match(/cash flow|treasury|liquidity|fx|currency|sweep|bank to cash/)) {
    return "Treasury & Cash";
  }
  if (text.match(/invoice|disbursement|payment|dunning|receivable|payable|po |vendor|credit|dso|collections|procure|revenue|billing/)) {
    return "AP & AR Operations";
  }
  return "General";
}

/* ── step 3 ───────────────────────────────────────────────── */

function Instructions({
  spec,
  set,
  skills,
}: {
  spec: AgentSpec;
  set: (p: Partial<AgentSpec>) => void;
  skills: SkillInfo[];
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  const attached = specSkillIds(spec);
  const toggleSkill = (id: string) =>
    set({ skills: attached.includes(id) ? attached.filter((x) => x !== id) : [...attached, id] });
  const edit = (i: number, v: string) => set({ steps: spec.steps.map((s, x) => (x === i ? v : s)) });
  const move = (i: number, d: number) => {
    const arr = [...spec.steps];
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set({ steps: arr });
  };

  const attachedSkills = attached
    .map((id) => skills.find((s) => s.id === id))
    .filter(Boolean) as SkillInfo[];

  const categories = [
    { id: "all", label: "All Skills", count: skills.length },
    { id: "Reconciliation", label: "Reconciliation & Close", count: skills.filter((s) => classifySkill(s.label, s.description) === "Reconciliation").length },
    { id: "Reporting & FP&A", label: "Reporting & FP&A", count: skills.filter((s) => classifySkill(s.label, s.description) === "Reporting & FP&A").length },
    { id: "Audit & Risk", label: "Audit, Tax & Risk", count: skills.filter((s) => classifySkill(s.label, s.description) === "Audit & Risk").length },
    { id: "AP & AR Operations", label: "AP & AR Operations", count: skills.filter((s) => classifySkill(s.label, s.description) === "AP & AR Operations").length },
    { id: "Treasury & Cash", label: "Treasury & Cash", count: skills.filter((s) => classifySkill(s.label, s.description) === "Treasury & Cash").length },
    { id: "General", label: "General", count: skills.filter((s) => classifySkill(s.label, s.description) === "General").length },
  ].filter((c) => c.id === "all" || c.count > 0);

  const filteredSkills = skills.filter((k) => {
    if (activeCategory !== "all") {
      const cat = classifySkill(k.label, k.description);
      if (cat !== activeCategory) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchesLabel = k.label.toLowerCase().includes(q);
      const matchesDesc = (k.description || "").toLowerCase().includes(q);
      const matchesName = (k.name || "").toLowerCase().includes(q);
      if (!matchesLabel && !matchesDesc && !matchesName) return false;
    }
    return true;
  });

  return (
    <div>
      <h2>What it should do, in order</h2>
      <p className="help">Plain sentences. Edit anything that does not match how the work is actually done.</p>
      <ul className="stack" style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
        {spec.steps.map((s, i) => (
          <li key={i} className="instr">
            <span className="n">{String(i + 1).padStart(2, "0")}</span>
            <input className="input" value={s} onChange={(e) => edit(i, e.target.value)} />
            <button className="icon-btn" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
            <button className="icon-btn" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
            <button className="icon-btn" onClick={() => set({ steps: spec.steps.filter((_, x) => x !== i) })} aria-label="Remove">×</button>
          </li>
        ))}
      </ul>
      <button className="btn" onClick={() => set({ steps: [...spec.steps, ""] })}>
        Add a step
      </button>

      <div className="grid2 mt">
        <label className="field">
          <span className="eyebrow">Deliverable format</span>
          <input className="input" value={spec.output.format} onChange={(e) => set({ output: { ...spec.output, format: e.target.value } })} />
        </label>
        <label className="field">
          <span className="eyebrow">Name</span>
          <input className="input" value={spec.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
      </div>
      <label className="field mt">
        <span className="eyebrow">How the deliverable should read</span>
        <textarea
          className="textarea"
          rows={2}
          placeholder="Short, factual, one bullet per finding…"
          value={spec.output.instructions}
          onChange={(e) => set({ output: { ...spec.output, instructions: e.target.value } })}
        />
      </label>

      {/* Skills Subcard (Option A: Attached Tray + 2-Column Searchable Cards with Categories) */}
      <div className="subcard mt">
        <div className="subcard-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h3 className="subcard-title">Skills & Domain Know-How</h3>
              <span className="pill static" style={{ fontSize: 10 }}>
                {attached.length} attached
              </span>
            </div>
            <p className="sub-line" style={{ marginTop: 3 }}>
              Written once under Skills and shared across agents. The agent sees each summary and reads the
              full instructions on-demand when the work calls for it.
            </p>
          </div>
          <Link href="/skills" className="sub-line" style={{ color: "var(--link)", fontWeight: 550 }}>
            Manage Skills ↗
          </Link>
        </div>

        {skills.length === 0 ? (
          <div className="note">
            No skills written yet. <Link href="/skills">Write one</Link> and every agent can be given it.
          </div>
        ) : (
          <div>
            {/* Top Tray: Currently Attached Skills */}
            <div className="skill-tray">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span className="eyebrow" style={{ fontWeight: 600 }}>
                  Attached to this Agent ({attachedSkills.length})
                </span>
                {attachedSkills.length > 0 && (
                  <button
                    type="button"
                    onClick={() => set({ skills: [] })}
                    style={{ fontSize: 11, color: "var(--red)", cursor: "pointer", background: "none", border: "none", padding: 0 }}
                  >
                    Clear all
                  </button>
                )}
              </div>

              {attachedSkills.length === 0 ? (
                <div className="skill-tray-empty">
                  No skills attached yet. Click any skill from the catalog below to attach it to this agent.
                </div>
              ) : (
                <div className="skill-tray-chips">
                  {attachedSkills.map((s) => (
                    <div key={s.id} className="skill-attached-chip">
                      <span className="skill-chip-check">✓</span>
                      <span className="skill-chip-text" title={s.label}>{s.label}</span>
                      <button
                        type="button"
                        className="skill-chip-remove"
                        onClick={() => toggleSkill(s.id)}
                        aria-label={`Remove ${s.label}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Search & Category Filter Bar */}
            <div className="skill-filter-bar">
              <div className="skill-search-wrap">
                <span className="skill-search-icon">🔍</span>
                <input
                  type="text"
                  className="input skill-search-input"
                  placeholder={`Search ${skills.length} skills by name, procedure, or keyword...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="skill-search-clear"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="skill-category-pills">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`chip ${activeCategory === cat.id ? "on" : ""}`}
                    onClick={() => setActiveCategory(cat.id)}
                  >
                    {cat.label} ({cat.count})
                  </button>
                ))}
              </div>
            </div>

            {/* Results count & instructions */}
            <div className="skill-results-meta">
              <span>Showing {filteredSkills.length} of {skills.length} skills</span>
              <span className="dim">Click any card to toggle attachment</span>
            </div>

            {/* 2-Column Responsive Card Grid */}
            {filteredSkills.length === 0 ? (
              <div className="note" style={{ textAlign: "center", padding: "24px 16px" }}>
                No skills found matching &ldquo;{searchQuery}&rdquo; in category &ldquo;{activeCategory}&rdquo;.
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ display: "block", margin: "10px auto 0", fontSize: 12 }}
                  onClick={() => { setSearchQuery(""); setActiveCategory("all"); }}
                >
                  Reset search &amp; filters
                </button>
              </div>
            ) : (
              <div className="skill-grid-scroll">
                <div className="skill-grid">
                  {filteredSkills.map((k) => {
                    const on = attached.includes(k.id);
                    const cat = classifySkill(k.label, k.description);
                    return (
                      <div
                        key={k.id}
                        className={`skill-card ${on ? "on" : ""}`}
                        onClick={() => toggleSkill(k.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleSkill(k.id);
                          }
                        }}
                      >
                        <div className="skill-card-top">
                          <span className={`check ${on ? "on" : ""}`} />
                          <div className="skill-card-title-wrap">
                            <span className="skill-card-title">{k.label}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span className="skill-card-category">{cat}</span>
                              <button
                                type="button"
                                className="skill-card-dl"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  downloadSkillMarkdown(k);
                                }}
                                title="Download as Markdown file"
                                aria-label={`Download ${k.label} as Markdown`}
                              >
                                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M8 2.5v8.5M4.8 7.8L8 11l3.2-3.2M3 13.5h10" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>
                        <p className="skill-card-desc" title={k.description}>
                          {k.description || "No description provided."}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── step 4 helper functions ─────────────────────────────── */

function isToolRecommended(
  t: ToolInfo,
  spec: AgentSpec,
  connections: Conn[]
): { recommended: boolean; reason: string } {
  // 1. If tool requires a connection that is already attached to this agent's sources:
  if (t.needs && spec.sources.some((s) => connections.find((c) => c.id === s.connectionId)?.kind === t.needs)) {
    const conn = connections.find((c) => c.kind === t.needs && spec.sources.some((s) => s.connectionId === c.id));
    return {
      recommended: true,
      reason: `Matches attached connection (${conn?.name || t.needs})`,
    };
  }

  // 2. Keyword detection from brief & instructions
  const corpus = `${spec.brief || ""} ${spec.purpose || ""} ${(spec.steps || []).join(" ")}`.toLowerCase();

  if (t.id === "web_search" || t.id === "fetch_url") {
    if (corpus.match(/search|web|google|internet|research|lookup|browse|fetch|url|article|news/)) {
      return { recommended: true, reason: "Matches research intent in prompt" };
    }
  }
  if (t.id === "read_document") {
    const hasFileInput = (spec.inputs || []).some((i: any) => i.type === "file");
    if (hasFileInput || corpus.match(/pdf|document|contract|file|csv|excel|statement|ledger|read|upload/)) {
      return { recommended: true, reason: "Parses uploaded run form documents" };
    }
  }
  if (t.id === "write_file") {
    if (corpus.match(/write|file|markdown|export|download|save|report|briefing/)) {
      return { recommended: true, reason: "Generates exportable deliverable files" };
    }
  }
  if (t.id === "sql_query" || t.id === "sql_execute") {
    if (corpus.match(/database|postgres|sql|query|table|schema|records/)) {
      return { recommended: true, reason: "Relational database queries & operations" };
    }
  }
  if (t.id === "send_email") {
    if (corpus.match(/email|mail|gmail|smtp|send to/)) {
      return { recommended: true, reason: "Direct email notifications and reports" };
    }
  }
  if (t.id === "post_message") {
    if (corpus.match(/slack|channel|#|chat alert|post/)) {
      return { recommended: true, reason: "Slack channel updates and alerts" };
    }
  }
  if (t.id === "post_teams_message") {
    if (corpus.match(/teams|microsoft teams/)) {
      return { recommended: true, reason: "Microsoft Teams notifications" };
    }
  }
  if (t.id === "jira_create_issue" || t.id === "jira_search_issues") {
    if (corpus.match(/jira|ticket|issue|sprint/)) {
      return { recommended: true, reason: "Jira issue management and queries" };
    }
  }
  if (t.id === "github_create_issue" || t.id === "github_read_file") {
    if (corpus.match(/github|repo|pull request|pr|commit|code/)) {
      return { recommended: true, reason: "GitHub repository and issue automation" };
    }
  }
  if (t.id === "s3_upload_file") {
    if (corpus.match(/s3|bucket|cloud storage|upload/)) {
      return { recommended: true, reason: "Cloud object storage upload" };
    }
  }
  if (t.id === "http_request") {
    if (corpus.match(/api|rest|webhook|http|curl|endpoint/)) {
      return { recommended: true, reason: "External HTTP REST API integration" };
    }
  }
  if (t.id === "invoke_agent") {
    if (corpus.match(/agent|sub-agent|delegate|swarm|multi-agent/)) {
      return { recommended: true, reason: "Delegation to other workspace agents" };
    }
  }

  return { recommended: false, reason: "" };
}

/* ── step 4 ───────────────────────────────────────────────── */

function Actions({
  spec,
  set,
  tools,
  connections,
}: {
  spec: AgentSpec;
  set: (p: Partial<AgentSpec>) => void;
  tools: ToolInfo[];
  connections: Conn[];
}) {
  const toggle = (t: ToolInfo) => {
    const on = spec.tools.some((x) => x.id === t.id);
    set({
      tools: on ? spec.tools.filter((x) => x.id !== t.id) : [...spec.tools, { id: t.id, gate: t.risk === "low" ? "auto" : "approval" }],
    });
  };

  const attachConn = (conn: Conn) => {
    if (!spec.sources.some((s) => s.connectionId === conn.id)) {
      set({
        sources: [...spec.sources, { connectionId: conn.id, label: conn.name }],
      });
    }
  };

  const toolRecs = tools.map((t) => ({ tool: t, ...isToolRecommended(t, spec, connections) }));
  const recommendedTools = toolRecs.filter((r) => r.recommended).map((r) => r.tool);
  const otherTools = toolRecs.filter((r) => !r.recommended).map((r) => r.tool);

  const autoCount = spec.tools.filter((st) => st.gate === "auto").length;
  const approvalCount = spec.tools.filter((st) => st.gate === "approval").length;

  const renderToolRow = (t: ToolInfo) => {
    const sel = spec.tools.find((x) => x.id === t.id);
    const recInfo = toolRecs.find((r) => r.tool.id === t.id);

    // Connection status check
    const attachedConn = t.needs
      ? connections.find((c) => c.kind === t.needs && spec.sources.some((s) => s.connectionId === c.id))
      : null;
    const availableConn = t.needs && !attachedConn
      ? connections.find((c) => c.kind === t.needs)
      : null;

    return (
      <div key={t.id} className={`tool-row ${sel ? "on" : ""}`}>
        <button className="tool-main" onClick={() => toggle(t)}>
          <span className={`check ${sel ? "on" : ""}`} />
          <span>
            <span className="tool-label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {t.label}
              {recInfo?.recommended && <span className="badge-rec">⭐ Recommended</span>}
            </span>
            <span className="sub-line">
              {t.description}
              {recInfo?.recommended && recInfo.reason ? ` — ${recInfo.reason}` : ""}
            </span>
            {t.needs && (
              <span className="sub-line" style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                {attachedConn ? (
                  <span className="attached-pill">✓ Attached to {attachedConn.name}</span>
                ) : availableConn ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "var(--amber)", fontSize: 11, fontWeight: 550 }}>
                      ⚠️ Needs connection attached
                    </span>
                    <button
                      type="button"
                      className="quick-attach-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        attachConn(availableConn);
                      }}
                    >
                      + Attach {availableConn.name}
                    </button>
                  </span>
                ) : (
                  <span style={{ color: "var(--red)", fontSize: 11 }}>
                    ⚠️ Requires {t.needs} connection (none configured).{" "}
                    <Link href="/connections" style={{ color: "var(--link)", textDecoration: "underline" }} onClick={(e) => e.stopPropagation()}>
                      Add one
                    </Link>
                  </span>
                )}
              </span>
            )}
          </span>
        </button>
        <div className="row" style={{ flex: "0 0 auto", alignItems: "center", gap: 10 }}>
          {t.risk === "low" ? (
            <span className="badge-risk-low">🛡️ Safe / Read-Only</span>
          ) : t.risk === "medium" ? (
            <span className="badge-risk-med">⚡ Medium / External</span>
          ) : (
            <span className="badge-risk-high">⚠️ High / Mutating</span>
          )}

          {sel && (
            <select
              className="select-sm"
              value={sel.gate}
              disabled={t.risk !== "low"}
              title={t.risk !== "low" ? "Gated: external communication and data mutations require human sign-off" : "Configure execution policy"}
              onChange={(e) => set({ tools: spec.tools.map((x) => (x.id === t.id ? { ...x, gate: e.target.value as any } : x)) })}
            >
              <option value="auto">Autonomous</option>
              <option value="approval">Human Approval</option>
            </select>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2>Actions & Governance</h2>
        <p className="help">
          Define what active capabilities this agent is authorized to execute. Read-only actions can run autonomously.
          Operations that leave your perimeter or mutate systems require human sign-off before executing.
        </p>
      </div>

      {/* Governance policy status header */}
      <div className="banner-suggest" style={{ marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span className="badge-rec">🛡️ Policy Enforcement</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
              {spec.tools.length} Granted Capabilities
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {autoCount} autonomous (read-only) · {approvalCount} human-in-the-loop sign-off required
          </div>
        </div>
        <div className="sub-line" style={{ fontSize: 11, maxWidth: 380, textAlign: "right" }}>
          Medium and High risk actions cannot run unattended: an execution review modal will intercept them.
        </div>
      </div>

      {/* Recommended capabilities group */}
      {recommendedTools.length > 0 && (
        <div className="subcard" style={{ marginBottom: 20 }}>
          <div className="subcard-header">
            <div>
              <h3 className="subcard-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>⭐ Recommended Capabilities</span>
                <span className="pill static" style={{ fontSize: 10 }}>{recommendedTools.length}</span>
              </h3>
              <p className="sub-line" style={{ marginTop: 2 }}>
                Capabilities matching your attached data connections or task prompt.
              </p>
            </div>
          </div>
          <div className="stack">
            {recommendedTools.map(renderToolRow)}
          </div>
        </div>
      )}

      {/* Other capabilities group */}
      <div className="subcard">
        <div className="subcard-header">
          <div>
            <h3 className="subcard-title">
              {recommendedTools.length > 0 ? "Additional Available Capabilities" : "Available Capabilities"}
            </h3>
            <p className="sub-line" style={{ marginTop: 2 }}>
              Standard tool library for workspace automation, document parsing, and messaging.
            </p>
          </div>
        </div>
        <div className="stack">
          {otherTools.map(renderToolRow)}
        </div>
      </div>
    </div>
  );
}


/* ── step 6 ───────────────────────────────────────────────── */

function Review({
  spec,
  tools,
  connections,
  skills,
  publishedSpec,
  publishedVer,
  canPublish,
  onPublish,
  onExport,
  runInput,
  setRunInput,
  onRun,
  onRehearse,
  busy,
}: {
  spec: AgentSpec;
  tools: ToolInfo[];
  connections: Conn[];
  skills: SkillInfo[];
  publishedSpec: AgentSpec | null;
  publishedVer: number | null;
  canPublish: boolean;
  onPublish: () => void;
  onExport: () => void;
  runInput: string;
  setRunInput: (v: string) => void;
  onRun: () => void;
  onRehearse: () => void;
  busy: string | null;
}) {
  const checks = [
    { ok: !!spec.name.trim(), label: "The agent has a name" },
    { ok: spec.steps.length > 0 && spec.steps.every((s) => s.trim()), label: "Every instruction step is filled in" },
    { ok: spec.tools.length > 0, label: "At least one tool is granted" },
    {
      ok: spec.tools.every((t) => (tools.find((x) => x.id === t.id)?.risk === "low" ? true : t.gate === "approval")),
      label: "Every medium and high risk action is gated",
    },
    {
      ok: spec.tools.every((t) => {
        const needs = tools.find((x) => x.id === t.id)?.needs;
        return !needs || spec.sources.some((s) => connections.find((c) => c.id === s.connectionId)?.kind === needs);
      }),
      label: "Every tool has the connection it needs",
    },
    { ok: spec.trigger.type !== "schedule" || !!spec.trigger.schedule, label: "The schedule is set" },
  ];
  const failing = checks.filter((c) => !c.ok).length;

  // Diffed against the spec in the editor, so unsaved edits are included —
  // publishing saves the draft first, so this is exactly what would go live.
  const diff = publishedSpec
    ? {
        ...diffSpecs(
          publishedSpec,
          spec,
          (id) => tools.find((t) => t.id === id)?.risk ?? "low",
          (id) => skills.find((k) => k.id === id)?.label || "a skill since deleted",
        ),
        from: `v${publishedVer}`,
        to: "this draft",
      }
    : null;

  const rows: [string, string][] = [
    ["Purpose", spec.purpose],
    ["Sources", spec.sources.map((s) => connections.find((c) => c.id === s.connectionId)?.name || s.connectionId).join(" · ") || "None"],
    ["Instructions", spec.steps.map((s, i) => `${i + 1}. ${s}`).join("   ")],
    [
      "Actions",
      spec.tools.map((t) => `${tools.find((x) => x.id === t.id)?.label}${t.gate === "approval" ? " (needs approval)" : ""}`).join(" · ") || "None",
    ],
    [
      "Skills",
      specSkillIds(spec)
        .map((id) => skills.find((k) => k.id === id)?.label || "a skill since deleted")
        .join(" · ") || "None",
    ],
    [
      "Trigger",
      spec.trigger.type === "schedule" ? spec.trigger.schedule || "—" : spec.trigger.type === "event" ? spec.trigger.condition || "—" : "On demand",
    ],
    ["Deliverable", spec.output.format],
  ];

  return (
    <div>
      <h2>Review and publish</h2>
      {diff && <DiffView diff={diff} title={`What changes from v${publishedVer} to this draft`} />}
      <div className="table" style={{ marginTop: 12 }}>
        {rows.map(([label, value]) => (
          <div key={label} className="sum-row">
            <div className="eyebrow">{label}</div>
            <div>{value || "—"}</div>
          </div>
        ))}
      </div>

      <div className="eyebrow mt">Checks</div>
      <ul className="checks">
        {checks.map((c) => (
          <li key={c.label} className={c.ok ? "pass" : "fail"}>
            <span className="mono">{c.ok ? "PASS" : "FAIL"}</span>
            {c.label}
          </li>
        ))}
      </ul>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
        <button
          type="button"
          className="btn primary"
          onClick={onRun}
          disabled={busy === "run"}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          Test for real (Run Screen)…
        </button>
        <button
          type="button"
          className="btn"
          onClick={onRehearse}
          disabled={busy === "run"}
          title="Runs it safely in rehearsal mode"
        >
          {busy === "run" && <span className="spin" />}Rehearse draft…
        </button>
        <button type="button" className="btn" onClick={onExport} title="Export to GCP, AWS, or Azure">
          Export to Cloud
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={onPublish}
          disabled={failing > 0 || busy === "publish" || !canPublish}
        >
          Publish
        </button>
        {!canPublish && (
          <span className="dim">
            Only the workspace owner and admins can publish. Everything else here is yours to change — save the
            draft and ask one of them to review it.
          </span>
        )}
        {failing > 0 && <span className="dim">{failing} check{failing > 1 ? "s" : ""} still failing.</span>}
        <span className="dim">
          A rehearsal runs the agent but describes gated actions rather than carrying them out.
        </span>
      </div>
    </div>
  );
}

/* ── step 7: Test & Run ────────────────────────────────────── */

function TestAndRunStep({
  agentId,
  spec,
  publishedVer,
  onRunDraft,
  onRehearseDraft,
  onRunLive,
}: {
  agentId: string;
  spec: AgentSpec;
  publishedVer: number | null;
  onRunDraft: () => void;
  onRehearseDraft: () => void;
  onRunLive: () => void;
}) {
  const inputs = normaliseInputs(spec.inputs as any[]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 8,
              background: "rgba(0, 94, 184, 0.09)",
              color: "var(--link)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 19 }}>Test & Run Agent</h2>
            <p className="help" style={{ margin: "2px 0 0", fontSize: 13 }}>
              Execute this agent with live inputs. Required parameters and files will be requested on the Run Screen.
            </p>
          </div>
        </div>

        <Link
          href={`/agents/${agentId}/run`}
          className="dim"
          style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 500 }}
          title="Open dedicated standalone run screen"
        >
          Standalone run page ↗
        </Link>
      </div>

      {/* Input Parameters Preview */}
      {inputs.length > 0 ? (
        <div style={{ margin: "16px 0 20px", padding: "14px 18px", background: "#f8fafc", borderRadius: 8, border: "1px solid var(--line-soft)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span className="eyebrow" style={{ color: "var(--ink)", fontWeight: 600 }}>
              Required & Expected Inputs ({inputs.length})
            </span>
            <span className="dim" style={{ fontSize: 12 }}>
              Requested when launching run
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {inputs.map((inp) => (
              <span
                key={inp.key}
                className="tag"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", background: "#ffffff", border: "1px solid var(--line)", borderRadius: 6 }}
              >
                <span style={{ fontWeight: 600, color: "var(--ink)" }}>{inp.label}</span>
                <span className="dim mono" style={{ fontSize: 11 }}>({inp.type})</span>
                {inp.required && (
                  <span style={{ color: "var(--red)", fontWeight: 700 }} title="Required input">
                    *
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ margin: "16px 0 20px", padding: "14px 18px", background: "#f8fafc", borderRadius: 8, border: "1px solid var(--line-soft)", fontSize: 13, color: "var(--muted)" }}>
          This agent has no specific input parameters defined. Extra notes, instructions, or files can be supplied on the Run Screen.
        </div>
      )}

      {/* Execution Launch Modes */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginBottom: 20 }}>
        <div style={{ border: "1px solid rgba(0, 94, 184, 0.2)", borderRadius: 8, padding: 16, background: "rgba(0, 94, 184, 0.03)" }}>
          <div style={{ fontWeight: 600, color: "var(--link)", marginBottom: 4 }}>Full Draft Run</div>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px", lineHeight: 1.4 }}>
            Executes the current draft agent specification against live systems with full action permissions.
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={onRunDraft}
            disabled={!spec.steps.length}
            style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Run draft…
          </button>
        </div>

        <div style={{ border: "1px solid rgba(0, 0, 0, 0.1)", borderRadius: 8, padding: 16, background: "#ffffff" }}>
          <div style={{ fontWeight: 600, color: "#0f172a", marginBottom: 4 }}>Rehearsal (Dry Run)</div>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px", lineHeight: 1.4 }}>
            Safely simulates execution without modifying external data or sending live messages.
          </p>
          <button
            type="button"
            className="btn"
            onClick={onRehearseDraft}
            disabled={!spec.steps.length}
            style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            title="Runs safely in rehearsal mode without carrying out consequential actions"
          >
            Rehearse draft…
          </button>
        </div>

        {publishedVer && (
          <div style={{ border: "1px solid rgba(22, 163, 74, 0.2)", borderRadius: 8, padding: 16, background: "rgba(22, 163, 74, 0.03)" }}>
            <div style={{ fontWeight: 600, color: "#16a34a", marginBottom: 4 }}>Live Published v{publishedVer}</div>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px", lineHeight: 1.4 }}>
              Executes the verified, published version currently serving operational workflows.
            </p>
            <button
              type="button"
              className="btn"
              onClick={onRunLive}
              style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", borderColor: "rgba(22, 163, 74, 0.4)", color: "#15803d" }}
              title={`Run the live published version v${publishedVer}`}
            >
              Run live v{publishedVer}…
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
