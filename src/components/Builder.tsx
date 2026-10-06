"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ARCHETYPES, FILE_KINDS, INPUT_TYPES, acceptedExtensions, emptySpec, inputKey, normaliseInputs, specSkillIds, type AgentSpec, type SpecInput,
} from "@/lib/types";
import { KindIcon } from "@/components/ConnectorIcons";
import { kindLabel } from "@/lib/connection-types";
import { formatDate, formatDateTime, formatWhen } from "@/lib/format";
import VersionDiff, { DiffView } from "@/components/VersionDiff";
import { diffSpecs, type Change } from "@/lib/spec-diff";
import ExportAgentModal from "@/components/ExportAgentModal";
import RunAgentModal from "@/components/RunAgentModal";
import SwarmCanvas from "./SwarmCanvas";
import ScheduleStep from "./TriggerConfigPanel";
import { maskPII } from "@/lib/guardrails";
import { downloadSkillMarkdown } from "@/lib/skill-export";
import { parseSchedule, planFrom } from "@/lib/schedule";
import { SaveDraftDialog, useLeaveGuard } from "@/components/LeaveGuard";
import {
  AlertIcon, ArchiveIcon, ArrowLeftIcon, ArrowRightIcon, BookIcon, BracesIcon, ChatIcon, CheckIcon, ChevronIcon, CloudIcon,
  CalendarIcon, ClockIcon, CrossIcon, DocIcon, DomainTags, EyeIcon, FormIcon, LayersIcon, MailIcon, MoreIcon, PlugIcon, TableIcon, UploadIcon,
  GridIcon, ListIcon, PencilIcon, RestoreIcon, RunIcon, SearchIcon, ShieldIcon, SparkIcon, TrashIcon, WrenchIcon, parseDomain,
} from "@/components/agent-ui";
import type { SkillUsageRow, TaxonomyRow } from "@/lib/agent-list";

type ToolInfo = { id: string; label: string; description: string; risk: "low" | "medium" | "high"; needs: string | null };
type Conn = { id: string; name: string; kind: string; config: any };
type SkillInfo = { id: string; name: string; label: string; description: string; instructions?: string; status?: string };
type SetSpec = (p: Partial<AgentSpec>) => void;

export type AgentRun = {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  input: string;
  trigger: string;
  version: number | null;
  dry_run: boolean;
  cost_usd: number | null;
};

export type AgentMeta = {
  ownerName: string | null;
  createdAt: string | null;
  nextRunAt: string | null;
  scheduleCaveat: string;
  pendingApprovals: number;
  runCount: number;
  runStats: { completed: number; failed: number; awaiting: number; running: number; costUsd: number; avgMs: number | null };
};

type Tab = "overview" | "build" | "runs" | "versions";

const STEPS = ["Brief", "Instructions", "Data & inputs", "Actions & safety", "Schedule", "Review & publish"];
/** The same steps as they appear in ?step= links. */
const STEP_KEYS = ["brief", "instructions", "data", "actions", "schedule", "review"];
const REVIEW = 5;

const EXAMPLES = [
  "Every Monday, pull last week's support tickets from our Postgres database, group them by theme, and post the top five recurring issues to Slack with counts.",
  "Research a company I name: search the web for their recent announcements, funding and leadership changes, then write a one-page briefing as a markdown file.",
  "Read the uploaded vendor contract, compare its payment and termination terms against our standard positions, and email me a summary of anything that deviates.",
];

const RISK_LABEL = { low: "Read-only", medium: "External", high: "Changes data" } as const;

export const RUN_STATE: Record<string, { label: string; cls: string }> = {
  completed: { label: "Succeeded", cls: "ok" },
  failed: { label: "Failed", cls: "bad" },
  rejected: { label: "Action rejected", cls: "bad" },
  running: { label: "Running", cls: "live" },
  awaiting_approval: { label: "Waiting for approval", cls: "wait" },
};

/** Key order does not matter to a spec, so compare it with sorted keys. */
function stable(v: any): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

function duration(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!(ms >= 0)) return "—";
  if (ms < 1000) return "<1s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

const money = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(3)}` : "$0");

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
  canDelete,
  workspaceAgents = [],
  meta,
  initialTab,
  initialStep,
  taxonomy = [],
  skillUsage = [],
  engines = [],
}: {
  /** Null while a new agent exists only in this page and has not been saved. */
  agentId: string | null;
  initialSpec: AgentSpec;
  status: string;
  publishedVer: number | null;
  updatedAt?: string | null;
  tools: ToolInfo[];
  connections: Conn[];
  skills: SkillInfo[];
  versions: any[];
  runs: AgentRun[];
  timezone: string;
  publishedSpec: AgentSpec | null;
  canPublish: boolean;
  canDelete: boolean;
  workspaceAgents?: { id: string; name: string; description: string; archetype: string }[];
  meta: AgentMeta;
  initialTab?: string;
  initialStep?: number;
  /** Industries, processes and functions in use, for the Brief step's pickers. */
  taxonomy?: TaxonomyRow[];
  /** Which agents hold which skills, by process, for the Instructions step's suggestions. */
  skillUsage?: SkillUsageRow[];
  /** The models this workspace has a key for, for the Brief step's "Runs on" choice. */
  engines?: EngineInfo[];
}) {
  const router = useRouter();
  const [spec, setSpec] = useState<AgentSpec>(initialSpec);
  const set: SetSpec = (patch) => setSpec((s) => ({ ...s, ...patch }));

  const retired = status === "retired";
  const isLive = status === "published" && !!publishedVer;
  const nextVer = (publishedVer || 0) + 1;
  const drafted = spec.steps.length > 0;
  // A new agent is kept here, unsaved, until the person saves it as a draft or
  // publishes it, so nothing lands in the list unless they meant it to.
  const isNew = !agentId;

  // ---- checks: one list drives the stepper marks, the Review step and Publish ----
  const checks = useMemo(() => {
    const kindOf = (id: string) => connections.find((c) => c.id === id)?.kind;
    return [
      { ok: !!spec.name.trim(), label: "The agent has a name", step: 0 },
      { ok: spec.steps.length > 0 && spec.steps.every((s) => s.trim()), label: "Every instruction step is filled in", step: 1 },
      {
        ok: spec.tools.every((t) => {
          const needs = tools.find((x) => x.id === t.id)?.needs;
          return !needs || spec.sources.some((s) => kindOf(s.connectionId) === needs);
        }),
        label: "Every action has the connection it needs",
        step: 2,
      },
      { ok: spec.tools.length > 0, label: "At least one action is granted", step: 3 },
      {
        ok: spec.tools.every((t) => (tools.find((x) => x.id === t.id)?.risk === "low" ? true : t.gate === "approval")),
        label: "Every medium and high risk action needs approval",
        step: 3,
      },
      {
        ok: spec.trigger.type !== "schedule" || !!parseSchedule(spec.trigger.schedule || "").schedule,
        label: "The schedule is one it can run",
        step: 4,
      },
    ];
  }, [spec, tools, connections]);
  const failing = checks.filter((c) => !c.ok);

  const hasChanges = useMemo(
    () => !publishedSpec || stable({ ...emptySpec(), ...publishedSpec }) !== stable(spec),
    [publishedSpec, spec],
  );

  // ---- tabs and steps --------------------------------------------------------------
  const hasHistory = !!publishedVer || meta.runCount > 0 || retired;
  const tabs = [
    ...(hasHistory ? [{ id: "overview" as Tab, label: "Overview" }] : []),
    { id: "build" as Tab, label: "Build" },
    ...(meta.runCount > 0 ? [{ id: "runs" as Tab, label: "Runs", n: meta.runCount }] : []),
    ...(versions.length > 0 ? [{ id: "versions" as Tab, label: "Versions", n: versions.length }] : []),
  ] as { id: Tab; label: string; n?: number }[];
  const [tab, setTab] = useState<Tab>(() => {
    const wanted = tabs.find((t) => t.id === initialTab)?.id;
    return wanted ?? (hasHistory ? "overview" : "build");
  });
  const [step, setStepState] = useState<number>(() => {
    if (initialStep != null && initialStep >= 0 && initialStep <= REVIEW) return initialStep;
    // A draft picks up where it needs work; a live agent opens at the start.
    if (isLive || !drafted) return 0;
    const first = checks.find((c) => !c.ok);
    return first ? first.step : 0;
  });
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
  const topRef = useRef<HTMLDivElement>(null);
  const goStep = (i: number) => {
    setStepState(i);
    setVisited((v) => new Set(v).add(i));
    setTab("build");
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  const stepState = (i: number): { cls: "done" | "warn" | "todo"; sub: string } => {
    if (i === REVIEW) return failing.length ? { cls: "warn", sub: `${failing.length} to fix` } : { cls: "done", sub: "Ready" };
    const n = failing.filter((c) => c.step === i).length;
    // A new agent is not scolded for steps nobody has reached yet.
    if (n && (drafted || visited.has(i))) return { cls: "warn", sub: `${n} to fix` };
    const filled =
      i === 0 ? !!spec.name.trim() && !!(spec.brief.trim() || spec.purpose.trim())
        : i === 1 ? drafted
          : drafted || visited.has(i);
    return filled ? { cls: "done", sub: "" } : { cls: "todo", sub: "" };
  };

  // ---- saving: autosave after a pause, with an honest status --------------------------
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [savedAt, setSavedAt] = useState<number>(() => (updatedAt ? Date.parse(updatedAt) : Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const specRef = useRef(spec);
  specRef.current = spec;
  const saveSeq = useRef(0);
  const firstRender = useRef(true);

  async function persist(): Promise<boolean> {
    const mine = ++saveSeq.current;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec: specRef.current }),
      });
      if (!res.ok) throw new Error();
      if (mine === saveSeq.current) {
        setSaveState("saved");
        setSavedAt(Date.now());
      }
      return true;
    } catch {
      if (mine === saveSeq.current) setSaveState("error");
      return false;
    }
  }

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (isNew) return;
    setSaveState("dirty");
    const t = setTimeout(persist, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (isNew || (saveState !== "dirty" && saveState !== "saving")) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  // ---- actions ---------------------------------------------------------------------
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // The version just published from this page, for the success state on Review.
  const [publishedNow, setPublishedNow] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [runModal, setRunModal] = useState<{ useDraft: boolean; dryRun: boolean } | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [delErr, setDelErr] = useState("");

  const guard = useLeaveGuard(isNew);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveErr, setLeaveErr] = useState("");

  /** Creates the agent from what is on screen. Only for a new, unsaved agent. */
  async function createDraft(): Promise<string> {
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec: specRef.current }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.agent?.id) throw new Error(j.error || "The agent could not be saved.");
    return j.agent.id;
  }

  async function saveNewDraft() {
    setBusy("save");
    setMsg(null);
    try {
      const id = await createDraft();
      guard.release();
      router.replace(`/agents/${id}?step=${STEP_KEYS[step]}`);
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message });
      setBusy(null);
    }
  }

  async function leaveSaving() {
    if (!guard.to) return;
    setLeaveBusy(true);
    setLeaveErr("");
    try {
      await createDraft();
      guard.release();
      router.push(guard.to);
    } catch (e: any) {
      setLeaveErr(e.message);
      setLeaveBusy(false);
    }
  }

  function leaveDiscarding() {
    if (!guard.to) return;
    guard.release();
    router.push(guard.to);
  }

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("click", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", esc);
    };
  }, [menuOpen]);

  /** `noteText` is the version note; Review passes one written from the changes when none was typed. */
  async function publish(noteText?: string) {
    if (!canPublish || retired) return;
    if (failing.length) {
      goStep(REVIEW);
      setMsg({ kind: "err", text: `Fix ${failing.length === 1 ? "the check" : `the ${failing.length} checks`} below before publishing.` });
      return;
    }
    setBusy("publish");
    setMsg(null);
    let id = agentId;
    try {
      if (!id) {
        id = await createDraft();
        guard.release();
      } else if (!(await persist())) {
        throw new Error("The draft could not be saved, so it was not published.");
      }
      const res = await fetch(`/api/agents/${id}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: (noteText ?? note).trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The agent could not be published.");
      if (isNew) {
        router.replace(`/agents/${id}`);
        return;
      }
      setNote("");
      setPublishedNow(data.version);
      setMsg({ kind: "ok", text: `Published as version ${data.version}. It is live for everyone in the workspace.` });
      router.refresh();
    } catch (e: any) {
      // Saved but not published: carry on from the saved draft rather than lose it.
      if (isNew && id) return router.replace(`/agents/${id}?step=review`);
      setMsg({ kind: "err", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function openRun(useDraft: boolean, dryRun = false) {
    // A draft run reads the saved draft, so save what is on screen first.
    if (useDraft && saveState !== "saved") await persist();
    setRunModal({ useDraft, dryRun });
  }

  async function setRetired(action: "retire" | "restore") {
    setMenuOpen(false);
    if (
      action === "retire" &&
      !confirm(`Retire "${spec.name || "this agent"}"? It stops running, on a schedule or by hand. Every version, run and approval is kept, and you can restore it at any time.`)
    ) {
      return;
    }
    setBusy(action);
    setMsg(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/retire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "That could not be done.");
      setMsg({ kind: "ok", text: action === "retire" ? "Retired. It no longer runs." : "Restored." });
      router.refresh();
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function confirmDelete() {
    if (!password) return setDelErr("Enter your password to confirm.");
    setBusy("delete");
    setDelErr("");
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The agent could not be deleted.");
      // Nothing left to save; leave without the unsaved-changes prompt.
      saveSeq.current++;
      setSaveState("saved");
      router.push("/agents");
      router.refresh();
    } catch (e: any) {
      setDelErr(e.message);
      setBusy(null);
    }
  }

  // ---- header pieces -----------------------------------------------------------------
  const domain = parseDomain(spec.domain);
  // Before drafting the type may still be left to the draft, so it is not shown yet.
  const typeLabel = drafted ? ARCHETYPES.find((a) => a.id === spec.archetype)?.label : undefined;
  const saveLabel =
    saveState === "saving" ? "Saving…"
      : saveState === "dirty" ? "Unsaved changes"
        : saveState === "error" ? "Not saved"
          : `Saved ${ago(savedAt, now)}`;

  const publishTitle = !canPublish
    ? "Only the workspace owner and admins can publish"
    : retired
      ? "Restore the agent before publishing"
      : isLive && !hasChanges
        ? `No changes since v${publishedVer}`
        : failing.length
          ? `${failing.length} check${failing.length > 1 ? "s" : ""} to fix first`
          : publishedVer
            ? `Replaces v${publishedVer} for everyone`
            : "Makes the agent live for everyone";

  return (
    <div className="page">
      <header className="ab-head">
        <div className="ab-head-main">
          <Link href="/agents" className="ab-back">
            <ArrowLeftIcon size={13} /> Agents
          </Link>
          <input
            className="ab-title"
            value={spec.name}
            placeholder="Name this agent"
            aria-label="Agent name"
            onChange={(e) => set({ name: e.target.value })}
          />
          <div className="ab-meta">
            {isNew ? (
              <span className="ab-badge draft">New</span>
            ) : retired ? (
              <span className="ab-badge retired">Retired</span>
            ) : isLive ? (
              <span className="ab-badge live">Live · v{publishedVer}</span>
            ) : (
              <span className="ab-badge draft">Draft</span>
            )}
            {isLive && hasChanges && <span className="ab-badge changes">Unpublished changes</span>}
            {isNew ? (
              <span className="ab-save dirty">Not saved yet</span>
            ) : (
            <span className={`ab-save ${saveState === "dirty" ? "dirty" : saveState === "error" ? "err" : ""}`}>
              {saveState === "saving" && <span className="spin dark" />}
              {saveState === "saved" && <CheckIcon size={12} />}
              {saveLabel}
              {saveState === "error" && (
                <button className="link-btn" onClick={() => persist()}>
                  Retry
                </button>
              )}
            </span>
            )}
            {(domain.domain || typeLabel) && <span className="ab-sep" />}
            {domain.domain && <DomainTags a={domain} />}
            {typeLabel && <span className="al-tag">{typeLabel}</span>}
          </div>
        </div>

        {isNew ? (
        <div className="ab-actions">
          <button className="btn" onClick={saveNewDraft} disabled={!!busy} title="Save it to the Agents list as a draft">
            {busy === "save" && <span className="spin dark" />}
            Save as draft
          </button>
          <button className="btn btn-primary" onClick={() => publish()} disabled={!canPublish || !!busy} title={publishTitle}>
            {busy === "publish" && <span className="spin" />}
            Publish v1
          </button>
        </div>
        ) : (
        <div className="ab-actions">
          <button
            className="btn"
            onClick={() => openRun(!isLive)}
            disabled={retired || !drafted}
            title={retired ? "Restore the agent to run it" : !drafted ? "Draft the agent first" : isLive ? `Run live v${publishedVer}` : "Run the draft"}
          >
            <RunIcon size={13} /> Run
          </button>
          <button
            className="btn btn-primary"
            onClick={() => publish()}
            disabled={!canPublish || retired || busy === "publish" || (isLive && !hasChanges)}
            title={publishTitle}
          >
            {busy === "publish" && <span className="spin" />}
            {isLive && !hasChanges ? "Published" : `Publish v${nextVer}`}
          </button>
          <div className="ab-more">
            <button
              className="ab-icon-btn"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
            >
              <MoreIcon />
            </button>
            {menuOpen && (
              <div className="ab-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                <button role="menuitem" onClick={() => { setMenuOpen(false); setExportOpen(true); }}>
                  <CloudIcon /> Export to cloud
                </button>
                {retired ? (
                  <button role="menuitem" onClick={() => setRetired("restore")} disabled={!canPublish || !!busy}
                    title={canPublish ? "Put it back into use" : "Only the workspace owner and admins can restore"}>
                    <RestoreIcon /> Restore
                  </button>
                ) : (
                  <button role="menuitem" onClick={() => setRetired("retire")} disabled={!!busy}>
                    <ArchiveIcon /> Retire
                  </button>
                )}
                <div className="ab-menu-sep" />
                <button
                  role="menuitem"
                  className="danger"
                  disabled={!canDelete}
                  onClick={() => {
                    setMenuOpen(false);
                    setPassword("");
                    setDelErr("");
                    setDelOpen(true);
                  }}
                  title={
                    canDelete
                      ? "Delete permanently — asks for your password"
                      : publishedVer != null
                        ? "Only an admin can delete an agent that has been published. Retire it instead."
                        : "Only the person who created this draft, or an admin, can delete it."
                  }
                >
                  <TrashIcon /> Delete…
                </button>
                {!canDelete && (
                  <div className="ab-menu-note">
                    {publishedVer != null ? "Published: only an admin can delete" : "Only its creator or an admin can delete"}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        )}
      </header>

      {retired && (
        <div className="ab-banner">
          <span>
            <strong>This agent is retired.</strong> It does not run, on a schedule or by hand. Its versions and runs are kept.
          </span>
          {canPublish && (
            <button className="btn" onClick={() => setRetired("restore")} disabled={!!busy}>
              <RestoreIcon size={13} /> Restore
            </button>
          )}
        </div>
      )}

      {msg && (
        <div className={`ab-toast ${msg.kind === "ok" ? "ok-note" : "error"}`} role="status">
          {msg.text}
        </div>
      )}

      {tabs.length > 1 && (
        <nav className="ab-tabs" aria-label="Agent sections">
          {tabs.map((t) => (
            <button key={t.id} className={`ab-tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)} aria-current={tab === t.id}>
              {t.label}
              {t.n != null && <span className="n">{t.n}</span>}
            </button>
          ))}
        </nav>
      )}

      {tab === "overview" && (
        <Overview
          spec={isLive && publishedSpec ? { ...emptySpec(), ...publishedSpec } : spec}
          showingLive={isLive && !!publishedSpec}
          hasChanges={isLive && hasChanges}
          status={status}
          publishedVer={publishedVer}
          tools={tools}
          connections={connections}
          skills={skills}
          runs={runs}
          meta={meta}
          timezone={timezone}
          onRun={() => openRun(!isLive)}
          onRehearse={() => openRun(!isLive, true)}
          onEdit={goStep}
          onAllRuns={() => setTab("runs")}
          canRun={!retired && drafted}
        />
      )}

      {tab === "build" && (
        <div ref={topRef} style={{ scrollMarginTop: 12 }}>
          <ol className="ab-stepper">
            {STEPS.map((s, i) => {
              const st = stepState(i);
              return (
                <li key={s} className={`${st.cls} ${i === step ? "on" : ""}`}>
                  <button className="ab-step" onClick={() => goStep(i)} aria-current={i === step ? "step" : undefined}>
                    <span className="dot">
                      {i !== step && st.cls === "done" ? <CheckIcon size={14} /> : i !== step && st.cls === "warn" ? "!" : i + 1}
                    </span>
                    <span className="lbl">{s}</span>
                    <span className="sub">{st.sub}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="ab-panel">
            {step === 0 && (
              <Brief
                spec={spec}
                set={set}
                drafted={drafted}
                onDrafted={() => goStep(1)}
                setMsg={setMsg}
                taxonomy={taxonomy}
                agentId={agentId}
                engines={engines}
              />
            )}
            {step === 1 && (
              <Instructions spec={spec} set={set} skills={skills} canCopy={canPublish} tools={tools} skillUsage={skillUsage} />
            )}
            {step === 2 && <Data spec={spec} set={set} connections={connections} tools={tools} />}
            {step === 3 && (
              <Actions
                spec={spec}
                set={set}
                tools={tools}
                connections={connections}
                agentId={agentId}
                workspaceAgents={workspaceAgents}
              />
            )}
            {step === 4 && (
              <ScheduleStep spec={spec} set={set} agentId={agentId ?? ""} timezone={timezone} isLive={isLive} nextRunAt={meta.nextRunAt} />
            )}
            {step === REVIEW && (
              <Review
                spec={spec}
                tools={tools}
                connections={connections}
                skills={skills}
                checks={checks}
                publishedSpec={publishedSpec}
                publishedVer={publishedVer}
                isLive={isLive}
                isNew={isNew}
                hasChanges={hasChanges}
                retired={retired}
                canPublish={canPublish}
                note={note}
                setNote={setNote}
                busy={busy}
                onFix={goStep}
                onPublish={publish}
                onRun={() => openRun(true)}
                onRehearse={() => openRun(true, true)}
                timezone={timezone}
                lastTest={runs.find((r) => r.version == null) ?? null}
                publishedNow={publishedNow != null && publishedNow === publishedVer ? publishedNow : null}
                onRunLive={() => openRun(false)}
                onOverview={() => setTab("overview")}
              />
            )}

            <div className="ab-foot">
              <button className="btn" onClick={() => goStep(Math.max(0, step - 1))} disabled={step === 0}>
                <ArrowLeftIcon size={13} /> Back
              </button>
              <div className="mid">
                Step {step + 1} of {STEPS.length} · <strong>{STEPS[step]}</strong>
              </div>
              {step < REVIEW ? (
                <button className="btn btn-primary" onClick={() => goStep(step + 1)}>
                  {STEPS[step + 1]} <ArrowRightIcon size={13} />
                </button>
              ) : (
                <span style={{ width: 90 }} />
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "runs" && <Runs runs={runs} meta={meta} timezone={timezone} />}

      {tab === "versions" && agentId && <Versions agentId={agentId} versions={versions} publishedVer={publishedVer} timezone={timezone} />}

      {agentId && (
        <ExportAgentModal agentId={agentId} agentName={spec.name || "Agent"} isOpen={exportOpen} onClose={() => setExportOpen(false)} />
      )}

      {guard.to && (
        <SaveDraftDialog
          busy={leaveBusy}
          error={leaveErr}
          onSave={leaveSaving}
          onDiscard={leaveDiscarding}
          onCancel={() => {
            setLeaveErr("");
            guard.cancel();
          }}
        />
      )}

      {runModal && agentId && (
        <RunAgentModal
          isOpen
          onClose={() => setRunModal(null)}
          agentId={agentId}
          agentName={spec.name || "Agent"}
          spec={runModal.useDraft || !publishedSpec ? spec : { ...emptySpec(), ...publishedSpec }}
          publishedVer={publishedVer}
          initialUseDraft={runModal.useDraft}
          initialDryRun={runModal.dryRun}
        />
      )}

      {delOpen && (
        <div className="modal-back" onMouseDown={() => busy !== "delete" && setDelOpen(false)}>
          <div className="panel modal" role="dialog" aria-modal="true" aria-labelledby="ab-del-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="eyebrow">Confirm deletion</div>
            <h2 id="ab-del-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>
              Delete “{spec.name || "this agent"}”?
            </h2>
            <p className="help" style={{ marginTop: 0 }}>
              <strong>Retiring is almost always what you want.</strong> It stops the agent running and keeps everything it
              produced, and it can be undone. Deleting cannot.
              <br />
              <br />
              This removes the agent, its {versions.length} {versions.length === 1 ? "version" : "versions"} and its{" "}
              {meta.runCount} {meta.runCount === 1 ? "run" : "runs"}, with the steps and approvals recorded against them.
              The audit trail keeps the record of the deletion itself.
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
                onKeyDown={(e) => e.key === "Enter" && busy !== "delete" && confirmDelete()}
              />
            </label>
            {delErr && <div className="error" style={{ marginTop: 12 }}>{delErr}</div>}
            <div className="panel-foot">
              <button className="btn" onClick={() => setDelOpen(false)} disabled={busy === "delete"}>Cancel</button>
              <button className="btn btn-danger-solid" onClick={confirmDelete} disabled={busy === "delete" || !password}>
                {busy === "delete" ? "Deleting…" : "Delete agent"}
              </button>
            </div>
          </div>
        </div>
      )}
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

function RunState({ status }: { status: string }) {
  const s = RUN_STATE[status] ?? { label: status, cls: "" };
  return <span className={`ab-state ${s.cls}`}>{s.label}</span>;
}

function RunMode({ r }: { r: AgentRun }) {
  if (r.dry_run) return <span className="ab-mode rehearsal">Rehearsal</span>;
  return <span className="ab-mode">{r.version ? `v${r.version}` : "Draft"}</span>;
}

/* ── overview ─────────────────────────────────────────────── */

function Overview({
  spec,
  showingLive,
  hasChanges,
  status,
  publishedVer,
  tools,
  connections,
  skills,
  runs,
  meta,
  timezone,
  onRun,
  onRehearse,
  onEdit,
  onAllRuns,
  canRun,
}: {
  spec: AgentSpec;
  showingLive: boolean;
  hasChanges: boolean;
  status: string;
  publishedVer: number | null;
  tools: ToolInfo[];
  connections: Conn[];
  skills: SkillInfo[];
  runs: AgentRun[];
  meta: AgentMeta;
  timezone: string;
  onRun: () => void;
  onRehearse: () => void;
  onEdit: (step: number) => void;
  onAllRuns: () => void;
  canRun: boolean;
}) {
  const sources = spec.sources.map((s) => connections.find((c) => c.id === s.connectionId)?.name || s.label || "A connection");
  const inputs = normaliseInputs(spec.inputs as any[]);
  const granted = spec.tools.map((t) => ({ label: tools.find((x) => x.id === t.id)?.label || t.id, gated: t.gate === "approval" }));
  const attached = specSkillIds(spec).map((id) => skills.find((k) => k.id === id)).filter(Boolean) as SkillInfo[];
  const last = runs[0];
  const done = meta.runStats.completed + meta.runStats.failed;
  const successRate = done ? Math.round((meta.runStats.completed / done) * 100) : null;
  const schedule = spec.trigger.type === "schedule" ? spec.trigger.schedule || "Schedule not set" : "On demand";

  return (
    <div className="ab-ov">
      <div>
        {hasChanges && (
          <div className="ab-banner info">
            <span>
              Showing the live version, v{publishedVer}. The draft has changes that are not published yet.
            </span>
            <button className="btn" onClick={() => onEdit(REVIEW)}>Review changes</button>
          </div>
        )}
        <section className="ab-card">
          <div className="ab-card-head">
            <h2 className="ab-card-title">What it does</h2>
            <button className="ab-edit" onClick={() => onEdit(0)}>Edit</button>
          </div>
          <p className="ab-purpose">{spec.purpose || spec.brief || "No description yet."}</p>
        </section>

        <section className="ab-card">
          <div className="ab-card-head">
            <h2 className="ab-card-title">How it works</h2>
            <button className="ab-edit" onClick={() => onEdit(1)}>Edit</button>
          </div>
          {spec.steps.length ? (
            <ol className="ab-olist">
              {spec.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          ) : (
            <p className="dim" style={{ margin: 0 }}>No instructions yet.</p>
          )}
          {spec.output.format && (
            <p className="sub-line" style={{ margin: "12px 0 0" }}>
              Delivers: <strong style={{ color: "var(--text)" }}>{spec.output.format}</strong>
            </p>
          )}
        </section>

        <section className="ab-card">
          <div className="ab-card-head">
            <h2 className="ab-card-title">What it uses</h2>
          </div>
          <div className="ab-caps">
            <div>
              <div className="k">Data</div>
              <div className="ab-chips">
                {sources.map((s, i) => <span key={i} className="ab-chip">{s}</span>)}
                {inputs.length > 0 && <span className="ab-chip">{inputs.length} run {inputs.length === 1 ? "input" : "inputs"}</span>}
                {!sources.length && !inputs.length && <span className="dim sub-line">Nothing attached</span>}
              </div>
            </div>
            <div>
              <div className="k">Actions</div>
              <div className="ab-chips">
                {granted.map((t, i) => (
                  <span key={i} className={`ab-chip ${t.gated ? "gated" : ""}`} title={t.gated ? "Needs approval each time" : "Runs on its own"}>
                    {t.label}{t.gated ? " · approval" : ""}
                  </span>
                ))}
                {!granted.length && <span className="dim sub-line">None granted</span>}
              </div>
            </div>
            <div>
              <div className="k">Skills</div>
              <div className="ab-chips">
                {attached.map((k) => (
                  <span key={k.id} className="ab-chip" title={k.description}>
                    {k.label}{k.status === "retired" ? " (retired)" : ""}
                  </span>
                ))}
                {!attached.length && <span className="dim sub-line">None attached</span>}
              </div>
            </div>
          </div>
        </section>

        <section className="ab-card">
          <div className="ab-card-head">
            <h2 className="ab-card-title">Recent runs</h2>
            {meta.runCount > 5 && <button className="ab-edit" onClick={onAllRuns}>All {meta.runCount} runs</button>}
          </div>
          {runs.length === 0 ? (
            <p className="dim" style={{ margin: 0 }}>It has not run yet.</p>
          ) : (
            <div className="ab-runs" style={{ boxShadow: "none" }}>
              {runs.slice(0, 5).map((r) => (
                <Link key={r.id} href={`/runs/${r.id}`} className="ab-runrow" style={{ gridTemplateColumns: "150px 150px 80px minmax(0,1fr)" }}>
                  <span className="num">{formatDateTime(r.started_at, timezone)}</span>
                  <RunState status={r.status} />
                  <RunMode r={r} />
                  <span className="in">{r.input || "No input"}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <aside>
        <section className="ab-card">
          <div className="ab-card-head">
            <h2 className="ab-card-title">At a glance</h2>
          </div>
          <div className="ab-kv">
            <div>
              <span className="k">Status</span>
              <span className="v">
                {status === "retired" ? "Retired" : publishedVer && status === "published" ? `Live · v${publishedVer}` : "Draft, not published"}
              </span>
            </div>
            <div>
              <span className="k">Runs</span>
              <span className="v">
                {meta.runCount}
                {successRate != null ? ` · ${successRate}% succeeded` : ""}
              </span>
            </div>
            <div>
              <span className="k">Last run</span>
              <span className="v">{last ? <>{formatWhen(last.started_at, timezone)} · <RunState status={last.status} /></> : "Never"}</span>
            </div>
            <div>
              <span className="k">Runs when</span>
              <span className="v">{schedule}</span>
            </div>
            {spec.trigger.type === "schedule" && (
              <div>
                <span className="k">Next run</span>
                <span className="v">{meta.nextRunAt ? formatWhen(meta.nextRunAt, timezone) : meta.scheduleCaveat || "Not scheduled"}</span>
              </div>
            )}
            <div>
              <span className="k">Waiting for approval</span>
              {meta.pendingApprovals > 0 ? (
                <Link className="v" href="/approvals">{meta.pendingApprovals}</Link>
              ) : (
                <span className="v">None</span>
              )}
            </div>
            {meta.ownerName && (
              <div>
                <span className="k">Owner</span>
                <span className="v">{meta.ownerName}</span>
              </div>
            )}
            {meta.createdAt && (
              <div>
                <span className="k">Created</span>
                <span className="v">{formatDate(meta.createdAt, timezone)}</span>
              </div>
            )}
          </div>
          <div className="ab-run-cta">
            <button className="btn btn-primary" onClick={onRun} disabled={!canRun}>
              <RunIcon size={13} /> Run {showingLive ? `v${publishedVer}` : "draft"}
            </button>
            <button className="btn" onClick={onRehearse} disabled={!canRun} title="Runs it, but describes approval-gated actions instead of carrying them out">
              Rehearse safely
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}

/* ── runs ─────────────────────────────────────────────────── */

const RUN_FILTERS = [
  { id: "all", label: "All" },
  { id: "completed", label: "Succeeded" },
  { id: "failed", label: "Failed" },
  { id: "awaiting_approval", label: "Waiting" },
  { id: "running", label: "Running" },
];

function Runs({ runs, meta, timezone }: { runs: AgentRun[]; meta: AgentMeta; timezone: string }) {
  const [filter, setFilter] = useState("all");
  const shown = runs.filter((r) => filter === "all" || r.status === filter || (filter === "failed" && r.status === "rejected"));
  const s = meta.runStats;
  return (
    <div>
      <div className="ab-stats">
        <div className="ab-stat"><div className="v">{meta.runCount}</div><div className="l">Runs</div></div>
        <div className="ab-stat ok"><div className="v">{s.completed}</div><div className="l">Succeeded</div></div>
        <div className="ab-stat bad"><div className="v">{s.failed}</div><div className="l">Failed or rejected</div></div>
        <div className="ab-stat wait"><div className="v">{s.awaiting}</div><div className="l">Waiting for approval</div></div>
        <div className="ab-stat"><div className="v">{s.avgMs != null ? duration(new Date(0).toISOString(), new Date(s.avgMs).toISOString()) : "—"}</div><div className="l">Average duration</div></div>
        <div className="ab-stat"><div className="v">{money(s.costUsd)}</div><div className="l">Model cost</div></div>
      </div>

      <div className="ab-row" style={{ marginBottom: 10 }}>
        {RUN_FILTERS.map((f) => (
          <button key={f.id} className={`chip ${filter === f.id ? "on" : ""}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="ab-runs">
        <div className="ab-runrow head">
          <span>Started</span>
          <span>Result</span>
          <span>Version</span>
          <span>Trigger</span>
          <span>Duration</span>
          <span>Cost</span>
          <span>Input</span>
        </div>
        {shown.length === 0 ? (
          <div className="ab-empty">No runs match this filter.</div>
        ) : (
          shown.map((r) => (
            <Link key={r.id} href={`/runs/${r.id}`} className="ab-runrow">
              <span className="num">{formatDateTime(r.started_at, timezone)}</span>
              <RunState status={r.status} />
              <RunMode r={r} />
              <span className="sub-line">{r.trigger === "schedule" ? "Schedule" : r.trigger === "api" ? "API" : "By hand"}</span>
              <span className="num">{duration(r.started_at, r.ended_at)}</span>
              <span className="num">{r.cost_usd ? money(Number(r.cost_usd)) : "—"}</span>
              <span className="in">{r.input || "No input"}</span>
            </Link>
          ))
        )}
      </div>
      {meta.runCount > runs.length && (
        <p className="sub-line" style={{ marginTop: 10 }}>
          Showing the latest {runs.length} of {meta.runCount} runs. <Link href="/runs">All runs</Link>
        </p>
      )}
    </div>
  );
}

/* ── versions ─────────────────────────────────────────────── */

function Versions({ agentId, versions, publishedVer, timezone }: { agentId: string; versions: any[]; publishedVer: number | null; timezone: string }) {
  const [compare, setCompare] = useState<number | null>(null);
  return (
    <div className="ab-card">
      <ul className="ab-timeline">
        {versions.map((v) => (
          <li key={v.version} className={v.version === publishedVer ? "live" : ""}>
            <div className="ab-ver-head">
              <b>v{v.version}</b>
              {v.version === publishedVer && <span className="ab-badge live">Live</span>}
              <span className="ab-ver-meta">
                {v.by || "Someone"} · {formatDateTime(v.created_at, timezone)}
              </span>
              {v.version > 1 && (
                <button className="ab-edit" onClick={() => setCompare(compare === v.version ? null : v.version)}>
                  {compare === v.version ? "Hide changes" : `What changed from v${v.version - 1}`}
                </button>
              )}
            </div>
            {v.note && <p className="ab-ver-note">{v.note}</p>}
            {compare === v.version && (
              <div style={{ marginTop: 10 }}>
                <VersionDiff agentId={agentId} from={String(v.version - 1)} to={String(v.version)} title={`v${v.version - 1} → v${v.version}`} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── step 1: brief ────────────────────────────────────────── */

/** Only the codes whose expansion is standard; others show their code and functions. */
const PROCESS_NAMES: Record<string, string> = {
  O2C: "Order to Cash",
  P2P: "Procure to Pay",
  R2R: "Record to Report",
  H2R: "Hire to Retire",
  S2P: "Source to Pay",
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  analyst: <SearchIcon size={16} />,
  author: <PencilIcon size={16} />,
  operator: <WrenchIcon size={16} />,
  sentinel: <EyeIcon size={16} />,
};
const TYPE_EXAMPLE: Record<string, string> = {
  analyst: "“Why did DSO rise this month?”",
  author: "“Draft the monthly management commentary”",
  operator: "“Match receipts to invoices and clear them”",
  sentinel: "“Flag vendors whose bank details changed”",
};

/** What a useful brief usually says. A quick read of the text, not a model call. */
const BRIEF_CHECKS = [
  {
    label: "Names the systems or data",
    add: "Uses: ",
    re: /\b(sap|oracle|erp|crm|salesforce|database|postgres|sql|excel|sheet|spreadsheet|csv|pdf|file|upload|ledger|report|system|portal|api|jira|slack|teams|email|inbox|drive|bank|statement|invoice|gl|mis)\b/i,
  },
  {
    label: "Says what it produces",
    add: "Produces: ",
    re: /\b(report|summary|summari[sz]e|email|memo|draft|dashboard|table|list|briefing|markdown|file|pdf|excel|csv|post|alert|notif|flag|reconciliation|schedule|tracker|note)\w*/i,
  },
  {
    label: "Says when it runs",
    add: "Runs: ",
    re: /\b(daily|weekly|monthly|quarterly|annually|every|each (day|week|month|quarter)|month[- ]end|year[- ]end|on demand|ad hoc|when (a|an|the)|whenever|after|before|by \d)\b/i,
  },
  {
    label: "States a rule or threshold",
    add: "Rules: ",
    re: /(%|\b(threshold|tolerance|over|above|below|more than|less than|exceed\w*|at least|at most|must|never|only|policy|rule|limit|within|older than|days?)\b)/i,
  },
  {
    label: "Says who gets the result",
    add: "Sends to: ",
    re: /\b(send|share|email|notify|post|escalate|assign|report to|for the|to the)\b.*\b(team|lead|manager|controller|cfo|head|owner|approver|finance|ops|operations|desk|channel|me|us)\b/i,
  },
];

const NAME_MAX = 80;
const DESC_MAX = 140;

/** Industry, Process and Function pickers that write the domain in the form the list parses. */
function DomainPicker({ domain, onChange, taxonomy }: { domain: string; onChange: (d: string) => void; taxonomy: TaxonomyRow[] }) {
  const industries = useMemo(() => {
    const m = new Map<string, number>();
    taxonomy.forEach((r) => r.industry && m.set(r.industry, (m.get(r.industry) ?? 0) + r.n));
    return [...m].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
  }, [taxonomy]);
  const processes = useMemo(() => {
    const m = new Map<string, { n: number; fns: Map<string, number> }>();
    taxonomy.forEach((r) => {
      if (!r.process) return;
      const e = m.get(r.process) ?? { n: 0, fns: new Map<string, number>() };
      e.n += r.n;
      if (r.process_name) e.fns.set(r.process_name, (e.fns.get(r.process_name) ?? 0) + r.n);
      m.set(r.process, e);
    });
    return [...m]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([code, e]) => ({ code, n: e.n, fns: [...e.fns].sort((a, b) => b[1] - a[1]).map(([f]) => f) }));
  }, [taxonomy]);

  const parsed = parseDomain(domain);
  // A domain that is just an industry name ("Banking") reads as that industry.
  const init = {
    ind: parsed.industry ?? (parsed.domain && !parsed.process && industries.some((i) => i.name === parsed.domain) ? parsed.domain : ""),
    proc: parsed.process ?? "",
    fn: parsed.process_name ?? "",
  };
  const [ind, setInd] = useState(init.ind);
  const [proc, setProc] = useState(init.proc);
  const [fn, setFn] = useState(init.fn);
  const [otherInd, setOtherInd] = useState(!!init.ind && !industries.some((i) => i.name === init.ind));
  const [otherProc, setOtherProc] = useState(!!init.proc && !processes.some((p) => p.code === init.proc));
  const [legacy] = useState(parsed.domain && !init.ind && !init.proc ? parsed.domain : "");

  const write = (i: string, p: string, f: string) => {
    const I = i.trim();
    const P = p.trim().toUpperCase();
    const F = f.trim();
    if (!I && !P) return onChange(legacy);
    if (!P) return onChange(I);
    onChange(`${I ? `${I} · ` : "· "}${P}${F ? ` (${F})` : ""}`);
  };

  const chosen = processes.find((p) => p.code === proc.toUpperCase());
  const fnOptions = useMemo(() => {
    const m = new Map<string, number>();
    taxonomy
      .filter((r) => r.process === proc.toUpperCase() && r.process_name)
      // Functions used in the chosen industry come first.
      .forEach((r) => m.set(r.process_name!, (m.get(r.process_name!) ?? 0) + r.n + (r.industry === ind ? 1000 : 0)));
    return [...m].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  }, [taxonomy, proc, ind]);

  return (
    <div>
      <div className="ab-grid3">
        <label className="ab-field">
          <span className="ab-label">Industry</span>
          {otherInd ? (
            <div className="ab-inline">
              <input
                className="input"
                autoFocus
                value={ind}
                placeholder="Type an industry"
                onChange={(e) => {
                  setInd(e.target.value);
                  write(e.target.value, proc, fn);
                }}
              />
              <button
                type="button"
                className="ab-edit"
                onClick={() => {
                  setOtherInd(false);
                  setInd("");
                  write("", proc, fn);
                }}
              >
                List
              </button>
            </div>
          ) : (
            <select
              className="input"
              value={ind}
              onChange={(e) => {
                if (e.target.value === "__other") {
                  setOtherInd(true);
                  setInd("");
                  return;
                }
                setInd(e.target.value);
                write(e.target.value, proc, fn);
              }}
            >
              <option value="">Choose an industry…</option>
              {industries.map((i) => (
                <option key={i.name} value={i.name}>{i.name}</option>
              ))}
              <option value="__other">Other…</option>
            </select>
          )}
        </label>

        <label className="ab-field">
          <span className="ab-label">Cycle</span>
          {otherProc ? (
            <div className="ab-inline">
              <input
                className="input mono"
                autoFocus
                maxLength={6}
                value={proc}
                placeholder="e.g. O2C"
                onChange={(e) => {
                  const v = e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
                  setProc(v);
                  write(ind, v, fn);
                }}
              />
              <button
                type="button"
                className="ab-edit"
                onClick={() => {
                  setOtherProc(false);
                  setProc("");
                  write(ind, "", fn);
                }}
              >
                List
              </button>
            </div>
          ) : (
            <select
              className="input"
              value={proc}
              onChange={(e) => {
                if (e.target.value === "__other") {
                  setOtherProc(true);
                  setProc("");
                  return;
                }
                setProc(e.target.value);
                write(ind, e.target.value, fn);
              }}
            >
              <option value="">Choose a cycle…</option>
              {processes.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code}
                  {PROCESS_NAMES[p.code] ? ` — ${PROCESS_NAMES[p.code]}` : ""}
                </option>
              ))}
              <option value="__other">Other…</option>
            </select>
          )}
        </label>

        <label className="ab-field">
          <span className="ab-label">
            Function or team <em>— optional</em>
          </span>
          <input
            className="input"
            list="ab-fn-options"
            value={fn}
            disabled={!proc}
            placeholder={proc ? "Pick or type, e.g. Collections" : "Choose a cycle first"}
            onChange={(e) => {
              setFn(e.target.value);
              write(ind, proc, e.target.value);
            }}
          />
          <datalist id="ab-fn-options">
            {fnOptions.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
      </div>
      {chosen && chosen.fns.length > 0 && (
        <p className="sub-line" style={{ margin: "6px 0 0" }}>
          {chosen.n} {chosen.n === 1 ? "agent" : "agents"} in {chosen.code}, mostly {chosen.fns.slice(0, 3).join(", ")}.
        </p>
      )}
      {legacy && !ind && !proc && (
        <p className="sub-line" style={{ margin: "6px 0 0" }}>
          Currently described as “{legacy}”. Choosing an industry or cycle replaces it, so the agent shows under the right
          filters.
        </p>
      )}
    </div>
  );
}

// ---- the model an agent runs on --------------------------------------------------------

export type EngineInfo = { id: "anthropic" | "gemini"; label: string; model: string };
const ENGINE_NAMES = { anthropic: "Claude (Anthropic)", gemini: "Gemini (Google)" } as const;
/** Kept in step with ENGINE_MODELS in lib/models.ts, with a word on what each is for. */
const ENGINE_MODEL_CHOICES: Record<"anthropic" | "gemini", { id: string; note: string }[]> = {
  anthropic: [
    { id: "claude-sonnet-4-6", note: "balanced" },
    { id: "claude-opus-4-6", note: "strongest, costs more" },
    { id: "claude-haiku-4-5", note: "fastest, cheapest" },
  ],
  gemini: [
    { id: "gemini-2.5-pro", note: "strongest — for long, multi-step work" },
    { id: "gemini-2.5-flash", note: "cheap — for short, simple work" },
    { id: "gemini-2.5-flash-lite", note: "cheapest" },
  ],
};
const engineOfSpec = (spec: AgentSpec): "anthropic" | "gemini" => (spec.engine === "gemini" ? "gemini" : "anthropic");

/**
 * Which model the agent thinks with. Each run (and its rehearsals) uses it;
 * drafting uses it first. A model this workspace has no key for can still be
 * chosen, with a note, so a draft can be prepared before the key is added.
 */
function EnginePicker({ spec, set, engines }: { spec: AgentSpec; set: SetSpec; engines: EngineInfo[] }) {
  const current = engineOfSpec(spec);
  const has = (id: "anthropic" | "gemini") => engines.find((e) => e.id === id);
  return (
    <div className="ab-field">
      <span className="ab-label">Runs on</span>
      <div className="ab-engines">
        {(["anthropic", "gemini"] as const).map((id) => {
          const e = has(id);
          return (
            <button key={id} type="button" className={`ab-format ${current === id ? "on" : ""}`} onClick={() => set({ engine: id, model: undefined })}>
              <b>{ENGINE_NAMES[id]}</b>
              <span>{e ? e.model : "No key in this workspace"}</span>
            </button>
          );
        })}
      </div>
      <label className="ab-model">
        <span>Model</span>
        <select className="input" value={spec.model ?? ""} onChange={(e) => set({ model: e.target.value || undefined })}>
          <option value="">Workspace default{has(current) ? ` (${has(current)!.model})` : ""}</option>
          {ENGINE_MODEL_CHOICES[current].map((m) => (
            <option key={m.id} value={m.id}>{m.id} — {m.note}</option>
          ))}
        </select>
      </label>
      {!has(current) ? (
        <span className="ab-field-note warn">
          <AlertIcon size={12} /> This workspace has no {current === "gemini" ? "Gemini" : "Anthropic"} key, so the agent can&apos;t run yet. An admin can add one under{" "}
          <a href="/connections" target="_blank" rel="noreferrer">Connections ↗</a>.
        </span>
      ) : (
        <span className="ab-field-note">Every run and rehearsal uses this model. Drafting below tries it first.</span>
      )}
    </div>
  );
}

function Brief({
  spec,
  set,
  drafted,
  onDrafted,
  setMsg,
  taxonomy,
  agentId,
  engines,
}: {
  spec: AgentSpec;
  set: SetSpec;
  drafted: boolean;
  onDrafted: () => void;
  setMsg: (m: { kind: "ok" | "err"; text: string } | null) => void;
  taxonomy: TaxonomyRow[];
  agentId: string | null;
  engines: EngineInfo[];
}) {
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [autoType, setAutoType] = useState(!drafted);
  const [confirmRedraft, setConfirmRedraft] = useState(false);
  const [nameTaken, setNameTaken] = useState<{ id: string; name: string } | null>(null);
  const [similar, setSimilar] = useState<{ id: string; name: string; brief: string }[]>([]);
  const [undoBrief, setUndoBrief] = useState<string | null>(null);
  const briefRef = useRef<HTMLTextAreaElement>(null);
  const d = parseDomain(spec.domain);

  // Two agents with one name make the list and approvals confusing.
  useEffect(() => {
    const n = spec.name.trim();
    if (!n) {
      setNameTaken(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/agents/lookup?name=${encodeURIComponent(n)}${agentId ? `&exclude=${agentId}` : ""}`);
        const j = await r.json();
        setNameTaken(j.taken ?? null);
      } catch {
        /* a failed check is not worth interrupting anyone for */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [spec.name, agentId]);

  // Briefs of live agents in the same area, to start from.
  useEffect(() => {
    if (!d.industry && !d.process) {
      setSimilar([]);
      return;
    }
    let live = true;
    const qs = new URLSearchParams({ industry: d.industry ?? "", process: d.process ?? "", ...(agentId ? { exclude: agentId } : {}) });
    fetch(`/api/agents/lookup?${qs}`)
      .then((r) => r.json())
      .then((j) => live && setSimilar(j.similar ?? []))
      .catch(() => live && setSimilar([]));
    return () => {
      live = false;
    };
  }, [d.industry, d.process, agentId]);

  const compile = async () => {
    setConfirmRedraft(false);
    setBusy(true);
    setMsg(null);
    const phases = ["Reading the brief", "Matching your connections", "Choosing actions and risk levels", "Writing the steps"];
    let i = 0;
    setPhase(phases[0]);
    const tick = setInterval(() => setPhase(phases[(i = Math.min(i + 1, phases.length - 1))]), 1500);
    try {
      const res = await fetch("/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief: spec.brief, engine: engineOfSpec(spec) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      set({
        ...data.spec,
        brief: spec.brief,
        name: spec.name.trim() || data.spec.name,
        domain: spec.domain.trim() || data.spec.domain,
        purpose: spec.purpose.trim() || data.spec.purpose,
        archetype: autoType ? data.spec.archetype : spec.archetype,
        guardrails: spec.guardrails,
        swarm: spec.swarm,
        engine: spec.engine,
        skills: spec.skills?.length ? spec.skills : data.spec.skills,
        trigger: drafted ? spec.trigger : data.spec.trigger,
      });
      setAutoType(false);
      onDrafted();
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message || "The brief could not be drafted." });
    } finally {
      clearInterval(tick);
      setBusy(false);
    }
  };

  const addLine = (text: string) => {
    const b = spec.brief.replace(/\s+$/, "");
    const next = `${b}${b ? "\n" : ""}${text}`;
    set({ brief: next });
    requestAnimationFrame(() => {
      const el = briefRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
    });
  };

  const words = spec.brief.trim() ? spec.brief.trim().split(/\s+/).length : 0;
  const met = BRIEF_CHECKS.map((c) => c.re.test(spec.brief));

  return (
    <div className="ab-brief">
      <div>
        <h2 className="ab-h">Describe the work</h2>
        <p className="ab-lead">
          Say what it should do the way you would brief a new colleague. Drafting turns this into instructions, data and
          actions you can then adjust.
        </p>

        <div className="ab-group">
          <div className="ab-group-title">Identity</div>
          <label className="ab-field">
            <span className="ab-label-row">
              <span className="ab-label">Name</span>
              <span className={`ab-counter ${spec.name.length > NAME_MAX ? "over" : ""}`}>
                {spec.name.length}/{NAME_MAX}
              </span>
            </span>
            <input className="input" value={spec.name} placeholder="e.g. Weekly collections review" onChange={(e) => set({ name: e.target.value })} />
            {nameTaken && (
              <span className="ab-field-note warn">
                <AlertIcon size={12} /> Another agent is already called “{nameTaken.name}”.{" "}
                <a href={`/agents/${nameTaken.id}`} target="_blank" rel="noreferrer">
                  Open it ↗
                </a>
              </span>
            )}
          </label>

          <div className="ab-field">
            <span className="ab-label">Type</span>
            <div className={`ab-types ${drafted ? "" : "five"}`}>
              {!drafted && (
                <button type="button" className={`ab-type ${autoType ? "on" : ""}`} onClick={() => setAutoType(true)}>
                  <span className="ic"><SparkIcon size={16} /></span>
                  <b>Let drafting decide</b>
                  <span>Picked from the brief when it is drafted</span>
                </button>
              )}
              {ARCHETYPES.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`ab-type ${!autoType && spec.archetype === a.id ? "on" : ""}`}
                  onClick={() => {
                    setAutoType(false);
                    set({ archetype: a.id });
                  }}
                >
                  <span className="ic">{TYPE_ICON[a.id]}</span>
                  <b>{a.label}</b>
                  <span>{a.blurb}</span>
                  <i>{TYPE_EXAMPLE[a.id]}</i>
                </button>
              ))}
            </div>
          </div>

          <div className="ab-field">
            <DomainPicker domain={spec.domain} onChange={(domain) => set({ domain })} taxonomy={taxonomy} />
          </div>

          <EnginePicker spec={spec} set={set} engines={engines} />
        </div>

        <div className="ab-group">
          <div className="ab-group-title">The work</div>
          <label className="ab-field">
            <span className="ab-label-row">
              <span className="ab-label">
                What it does, in one line <em>— shown in the Agents list</em>
              </span>
              <span className={`ab-counter ${spec.purpose.length > DESC_MAX ? "over" : ""}`}>
                {spec.purpose.length}/{DESC_MAX}
              </span>
            </span>
            <input
              className="input"
              value={spec.purpose}
              placeholder="e.g. Reconciles collections against invoices and flags breaks"
              onChange={(e) => set({ purpose: e.target.value })}
            />
            {spec.purpose.length > DESC_MAX && (
              <span className="ab-field-note warn">
                <AlertIcon size={12} /> Longer than the list shows; it will be cut off there.
              </span>
            )}
          </label>

          <div className="ab-field">
            <span className="ab-label-row">
              <span className="ab-label">Brief</span>
              {similar.length > 0 && (
                <select
                  className="select-sm"
                  value=""
                  onChange={(e) => {
                    const pick = similar.find((s) => s.id === e.target.value);
                    if (!pick) return;
                    setUndoBrief(spec.brief);
                    set({ brief: pick.brief });
                  }}
                  title="Replace the brief with one from a live agent in the same industry or cycle"
                >
                  <option value="">Copy a brief from a similar agent…</option>
                  {similar.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
            </span>
            <div className="ab-brief-chips">
              {BRIEF_CHECKS.map((c, i) => (
                <button
                  key={c.label}
                  type="button"
                  className={`ab-bchip ${met[i] ? "met" : ""}`}
                  onClick={() => addLine(c.add)}
                  title={met[i] ? "The brief already covers this. Click to add a line anyway." : "Add a line for this to the brief"}
                >
                  {met[i] ? <CheckIcon size={12} /> : <span className="plus">+</span>}
                  {c.label}
                </button>
              ))}
            </div>
            <textarea
              ref={briefRef}
              className="textarea"
              rows={7}
              placeholder="Every Monday morning…"
              value={spec.brief}
              onChange={(e) => {
                setUndoBrief(null);
                set({ brief: e.target.value });
              }}
            />
            <div className="ab-brief-foot">
              <span>
                {met.filter(Boolean).length} of {BRIEF_CHECKS.length} covered · {words} {words === 1 ? "word" : "words"}
                {words > 0 && words < 25 ? " · a little more detail gives a better draft" : ""}
              </span>
              {undoBrief != null && (
                <button
                  type="button"
                  className="ab-edit"
                  onClick={() => {
                    set({ brief: undoBrief });
                    setUndoBrief(null);
                  }}
                >
                  Brief replaced · Undo
                </button>
              )}
            </div>
          </div>

          {!spec.brief.trim() && (
            <div className="ab-field">
              <span className="ab-label">Or start from an example</span>
              <div className="stack-sm">
                {EXAMPLES.map((b, i) => (
                  <button key={i} className="example" onClick={() => set({ brief: b })}>
                    {b}
                  </button>
                ))}
              </div>
            </div>
          )}

          {confirmRedraft ? (
            <div className="ab-hint warn" style={{ marginTop: 16, alignItems: "center" }}>
              <AlertIcon />
              <span className="grow">
                Re-drafting <strong>replaces</strong> the instructions, data, actions and run inputs with a fresh draft from
                this brief. Name, description, guardrails, schedule and delegation are <strong>kept</strong>.
              </span>
              <button className="btn" onClick={() => setConfirmRedraft(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={compile}>Re-draft</button>
            </div>
          ) : (
            <div className="ab-row" style={{ marginTop: 16 }}>
              <button
                className={drafted ? "btn" : "btn btn-primary"}
                onClick={() => (drafted ? setConfirmRedraft(true) : compile())}
                disabled={busy || !spec.brief.trim()}
              >
                {busy ? <span className={drafted ? "spin dark" : "spin"} /> : <SparkIcon size={13} />}
                {busy ? "Drafting…" : drafted ? "Re-draft from this brief" : "Draft this agent"}
              </button>
              {busy && <span className="ab-phase">{phase}</span>}
              {!busy && drafted && <span className="sub-line">Already drafted. Edit the next steps directly, or re-draft to start over.</span>}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

/* ── step 2: instructions and skills ──────────────────────── */

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

/** Formats offered for the deliverable; the ones marked `file` are written with the Write a file action. */
const FORMATS: { label: string; file: boolean }[] = [
  { label: "Markdown report", file: false },
  { label: "Excel / CSV table", file: true },
  { label: "Word document", file: true },
  { label: "Email draft", file: false },
  { label: "Short answer", file: false },
  { label: "JSON data", file: true },
];

/** Phrases for "how it should read"; a chip is on while its phrase is in the text. */
const STYLE_CHIPS: { label: string; phrase: string }[] = [
  { label: "Summary first", phrase: "Lead with a short summary." },
  { label: "Bullet points", phrase: "Use bullet points." },
  { label: "Table of exceptions", phrase: "Put exceptions in a table." },
  { label: "Cite sources", phrase: "Cite the source of every figure." },
  { label: "Plain language", phrase: "Use plain language, no jargon." },
  { label: "Under one page", phrase: "Keep it under one page." },
];

const STOP = new Set(
  (
    "with from that this each their they into when what which agent agents data report reports reporting process processes review " +
    "management analysis based using skill skills other against about every over under after before these those such must will " +
    "should would could also only more than then them there where within across while being have been does done make made used " +
    "uses work works team teams level levels details detail information record records check checks service services " +
    "highlight impact activity branch branches final required requirement requirements ensure ensures complete following"
  ).split(" "),
);
const stem = (w: string) => (w.length > 5 ? w.replace(/ies$/, "y").replace(/(ing|ed|es|s)$/, "") : w);
/** Meaningful words as [stem, word] pairs: stems to compare, words to show. */
const words = (t: string): [string, string][] =>
  (t.toLowerCase().match(/[a-z][a-z&]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map((w) => [stem(w), w]);

/** A textarea that grows with its text, so a long step is read in full. */
function GrowText({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Instructions({
  spec,
  set,
  skills: allSkills,
  canCopy,
  tools,
  skillUsage,
}: {
  spec: AgentSpec;
  set: SetSpec;
  skills: SkillInfo[];
  /** Downloading a skill is for the owner and admins; everyone else attaches by name. */
  canCopy: boolean;
  tools: ToolInfo[];
  skillUsage: SkillUsageRow[];
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [show, setShow] = useState<"all" | "attached" | "suggested">("all");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [catalogueOpen, setCatalogueOpen] = useState(() => specSkillIds(spec).length === 0);
  const [preview, setPreview] = useState<SkillInfo | null>(null);
  const [stepMenu, setStepMenu] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  useEffect(() => {
    if (stepMenu == null) return;
    const close = () => setStepMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [stepMenu]);

  // ---- steps ----
  const steps = spec.steps;
  const setSteps = (next: string[]) => set({ steps: next });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= steps.length || from === to) return;
    const arr = [...steps];
    const [s] = arr.splice(from, 1);
    arr.splice(to, 0, s);
    setSteps(arr);
  };
  const stepHint =
    steps.length === 0 ? "" : steps.length < 3 ? "Most agents need at least 3 steps." : steps.length > 8 ? "Long lists are harder to follow; consider merging steps." : "3–8 steps usually works best.";

  // ---- deliverable ----
  const known = FORMATS.find((f) => f.label.toLowerCase() === spec.output.format.trim().toLowerCase());
  const [otherFormat, setOtherFormat] = useState(!!spec.output.format.trim() && !known);
  const needsFile = known?.file && !spec.tools.some((t) => t.id === "write_file");
  const writeFile = tools.find((t) => t.id === "write_file");
  const hasPhrase = (p: string) => spec.output.instructions.toLowerCase().includes(p.toLowerCase());
  const togglePhrase = (p: string) => {
    const cur = spec.output.instructions;
    const next = hasPhrase(p)
      ? cur.replace(new RegExp(`\\s*${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), "").trim()
      : `${cur.trim()}${cur.trim() ? " " : ""}${p}`;
    set({ output: { ...spec.output, instructions: next } });
  };

  // ---- skills ----
  // Retired skills stay in the attached tray (the agent still holds them and gets
  // them back on restore) but are not offered in the catalogue.
  const skills = allSkills.filter((s) => s.status !== "retired");
  const isRetired = (s: SkillInfo) => s.status === "retired";
  const attached = specSkillIds(spec);
  const toggleSkill = (id: string) => set({ skills: attached.includes(id) ? attached.filter((x) => x !== id) : [...attached, id] });
  const attachedSkills = attached.map((id) => allSkills.find((s) => s.id === id)).filter(Boolean) as SkillInfo[];
  const usedBy = useMemo(() => {
    const m = new Map<string, number>();
    skillUsage.forEach((r) => m.set(r.skill_id, (m.get(r.skill_id) ?? 0) + r.n));
    return m;
  }, [skillUsage]);

  const process = parseDomain(spec.domain).process;
  const suggestions = useMemo(() => {
    const corpus = new Set(words(`${spec.brief} ${spec.purpose} ${spec.steps.join(" ")} ${spec.output.format}`).map(([st]) => st));
    // The distinct words of a text that also appear in the brief, shown as the skill writes them.
    const hits = (t: string, not: Set<string> = new Set()) => {
      const m = new Map<string, string>();
      words(t).forEach(([st, w]) => corpus.has(st) && !not.has(st) && !m.has(st) && m.set(st, w));
      return m;
    };
    const out: { skill: SkillInfo; reason: string; score: number }[] = [];
    for (const k of skills) {
      if (attached.includes(k.id)) continue;
      const same = process ? skillUsage.filter((r) => r.skill_id === k.id && r.process === process).reduce((a, r) => a + r.n, 0) : 0;
      const label = hits(k.label);
      const desc = hits(k.description || "", new Set(label.keys()));
      const score = same * 3 + label.size * 2 + desc.size;
      if (same > 0) out.push({ skill: k, reason: `Used by ${same} other ${process} ${same === 1 ? "agent" : "agents"}`, score });
      else if (score >= 4 && label.size > 0) {
        out.push({ skill: k, reason: `Mentions “${[...label.values(), ...desc.values()].slice(0, 3).join("”, “")}”, like the brief`, score });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 6);
  }, [skills, attached, spec.brief, spec.purpose, spec.steps, spec.output.format, process, skillUsage]);
  const suggestedIds = new Set(suggestions.map((s) => s.skill.id));

  const CATS: [string, string][] = [
    ["Reconciliation", "Reconciliation & close"],
    ["Reporting & FP&A", "Reporting & FP&A"],
    ["Audit & Risk", "Audit, tax & risk"],
    ["AP & AR Operations", "AP & AR operations"],
    ["Treasury & Cash", "Treasury & cash"],
    ["General", "General"],
  ];
  const categories = [
    { id: "all", label: "All", count: skills.length },
    ...CATS.map(([id, label]) => ({ id, label, count: skills.filter((s) => classifySkill(s.label, s.description) === id).length })),
  ].filter((c) => c.id === "all" || c.count > 0);

  const filteredSkills = skills.filter((k) => {
    if (show === "attached" && !attached.includes(k.id)) return false;
    if (show === "suggested" && !suggestedIds.has(k.id)) return false;
    if (activeCategory !== "all" && classifySkill(k.label, k.description) !== activeCategory) return false;
    const q = searchQuery.toLowerCase().trim();
    if (q && ![k.label, k.description || "", k.name || ""].some((t) => t.toLowerCase().includes(q))) return false;
    return true;
  });

  const FORMAT_ICON: Record<string, React.ReactNode> = {
    "Markdown report": <DocIcon size={18} />,
    "Excel / CSV table": <TableIcon size={18} />,
    "Word document": <DocIcon size={18} />,
    "Email draft": <MailIcon size={18} />,
    "Short answer": <ChatIcon size={18} />,
    "JSON data": <BracesIcon size={18} />,
  };
  const FORMAT_NOTE: Record<string, string> = {
    "Markdown report": "Formatted text",
    "Excel / CSV table": "Rows and columns",
    "Word document": ".docx file",
    "Email draft": "Ready to send",
    "Short answer": "A few sentences",
    "JSON data": "For other systems",
  };
  const emptyCount = steps.filter((s) => !s.trim()).length;

  return (
    <div className="ab-ins">
      <h2 className="ab-h">What it should do</h2>
      <p className="ab-lead">The steps it follows, what it hands back, and the know-how it can draw on.</p>

      {/* ---- steps ---- */}
      <section className="ab-sec">
        <header className="ab-sec-head">
          <span className="ab-sec-ic"><ListIcon size={17} /></span>
          <div className="grow">
            <h3>Steps, in order</h3>
            <p>Plain sentences, one per step. Drag a number to reorder.</p>
          </div>
          {steps.length > 0 && (
            <span className={`ab-pill ${steps.length < 3 || steps.length > 8 ? "warn" : ""}`} title={stepHint}>
              {steps.length} {steps.length === 1 ? "step" : "steps"}
              {steps.length < 3 ? " · add more" : steps.length > 8 ? " · consider merging" : ""}
            </span>
          )}
        </header>

        {steps.length === 0 && (
          <div className="ab-hint">
            <SparkIcon />
            <span className="grow">No steps yet. Draft the agent from its brief, or add steps yourself.</span>
          </div>
        )}

        <ol className="ab-tl">
          {steps.map((s, i) => (
            <li
              key={i}
              draggable={armed === i}
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (dragFrom == null) return;
                e.preventDefault();
                setDragOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom != null) move(dragFrom, i);
                setDragFrom(null);
                setDragOver(null);
                setArmed(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
                setArmed(null);
              }}
              className={`ab-tl-item ${dragFrom === i ? "dragging" : ""} ${dragOver === i && dragFrom !== i ? "over" : ""}`}
            >
              <span
                className="ab-tl-dot"
                title="Drag to reorder"
                onMouseDown={() => setArmed(i)}
                onMouseUp={() => setArmed(null)}
              >
                {i + 1}
              </span>
              <div className={`ab-tl-card ${!s.trim() ? "empty" : ""}`}>
                <GrowText
                  className="ab-tl-text"
                  value={s}
                  placeholder="Describe this step"
                  onChange={(v) => setSteps(steps.map((x, j) => (j === i ? v : x)))}
                />
                <div className="ab-more ab-tl-more">
                  <button
                    type="button"
                    className="ab-tl-btn"
                    aria-label={`Actions for step ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setStepMenu(stepMenu === i ? null : i);
                    }}
                  >
                    <MoreIcon />
                  </button>
                  {stepMenu === i && (
                    <div className="ab-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                      <button role="menuitem" onClick={() => { setSteps([...steps.slice(0, i + 1), "", ...steps.slice(i + 1)]); setStepMenu(null); }}>
                        + Insert a step below
                      </button>
                      <button role="menuitem" onClick={() => { setSteps([...steps.slice(0, i + 1), s, ...steps.slice(i + 1)]); setStepMenu(null); }}>
                        Duplicate
                      </button>
                      <button role="menuitem" disabled={i === 0} onClick={() => { move(i, i - 1); setStepMenu(null); }}>
                        ↑ Move up
                      </button>
                      <button role="menuitem" disabled={i === steps.length - 1} onClick={() => { move(i, i + 1); setStepMenu(null); }}>
                        ↓ Move down
                      </button>
                      <div className="ab-menu-sep" />
                      <button role="menuitem" className="danger" onClick={() => { setSteps(steps.filter((_, j) => j !== i)); setStepMenu(null); }}>
                        <TrashIcon /> Delete step
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
          <li className="ab-tl-item add">
            <span className="ab-tl-dot add">+</span>
            <button type="button" className="ab-tl-addbtn" onClick={() => setSteps([...steps, ""])}>
              Add a step
            </button>
          </li>
        </ol>
        {emptyCount > 0 && (
          <span className="ab-field-note warn" style={{ marginLeft: 44 }}>
            <AlertIcon size={12} /> Fill in or delete the empty {emptyCount === 1 ? "step" : "steps"}.
          </span>
        )}
      </section>

      {/* ---- deliverable ---- */}
      <section className="ab-sec">
        <header className="ab-sec-head">
          <span className="ab-sec-ic"><DocIcon size={17} /></span>
          <div className="grow">
            <h3>The deliverable</h3>
            <p>What it hands back at the end of a run, and how it should read.</p>
          </div>
        </header>
        <div className="ab-deliv">
          <div>
            <span className="ab-label">Format</span>
            <div className="ab-formats">
              {FORMATS.map((f) => (
                <button
                  key={f.label}
                  type="button"
                  className={`ab-format ${!otherFormat && known?.label === f.label ? "on" : ""}`}
                  onClick={() => {
                    setOtherFormat(false);
                    set({ output: { ...spec.output, format: f.label } });
                  }}
                >
                  <span className="ic">{FORMAT_ICON[f.label]}</span>
                  <b>{f.label}</b>
                  <span>{FORMAT_NOTE[f.label]}</span>
                </button>
              ))}
              <button
                type="button"
                className={`ab-format ${otherFormat ? "on" : ""}`}
                onClick={() => {
                  if (!otherFormat) set({ output: { ...spec.output, format: known ? "" : spec.output.format } });
                  setOtherFormat(true);
                }}
              >
                <span className="ic"><PencilIcon size={18} /></span>
                <b>Other</b>
                <span>Describe it</span>
              </button>
            </div>
            {otherFormat && (
              <input
                className="input"
                style={{ marginTop: 10 }}
                autoFocus={!spec.output.format}
                value={spec.output.format}
                placeholder="e.g. Board pack commentary"
                onChange={(e) => set({ output: { ...spec.output, format: e.target.value } })}
              />
            )}
            {needsFile && writeFile && (
              <div className="ab-hint warn" style={{ marginTop: 10, marginBottom: 0, alignItems: "center" }}>
                <AlertIcon />
                <span className="grow">A {known!.label.toLowerCase()} is written with the “{writeFile.label}” action, which is not granted.</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => set({ tools: [...spec.tools, { id: "write_file", gate: writeFile.risk === "low" ? "auto" : "approval" }] })}
                >
                  Grant it
                </button>
              </div>
            )}
          </div>
          <div>
            <span className="ab-label">How it should read</span>
            <div className="ab-brief-chips">
              {STYLE_CHIPS.map((c) => {
                const on = hasPhrase(c.phrase);
                return (
                  <button key={c.label} type="button" className={`ab-bchip ${on ? "met" : ""}`} onClick={() => togglePhrase(c.phrase)} title={c.phrase}>
                    {on ? <CheckIcon size={12} /> : <span className="plus">+</span>}
                    {c.label}
                  </button>
                );
              })}
            </div>
            <GrowText
              className="input ab-style-text"
              value={spec.output.instructions}
              placeholder="Anything else about tone, length or layout"
              onChange={(v) => set({ output: { ...spec.output, instructions: v } })}
            />
          </div>
        </div>
      </section>

      {/* ---- skills ---- */}
      <section className="ab-sec">
        <header className="ab-sec-head">
          <span className="ab-sec-ic"><BookIcon size={17} /></span>
          <div className="grow">
            <h3>Skills</h3>
            <p>Know-how written once under Skills and shared across agents. The agent reads a skill when the work calls for it.</p>
          </div>
          <Link href="/skills" className="ab-link">Manage skills ↗</Link>
        </header>

        <div className="ab-attached">
          <span className="ab-label" style={{ margin: 0 }}>Attached <span className="ab-count">{attachedSkills.length}</span></span>
          {attachedSkills.length === 0 ? (
            <span className="sub-line">None yet. Attach a suggestion below, or browse the catalogue.</span>
          ) : (
            attachedSkills.map((s) => (
              <span key={s.id} className={`ab-skillchip ${isRetired(s) ? "retired" : ""}`} title={isRetired(s) ? "Retired: not used until the skill is restored under Skills" : s.description}>
                {isRetired(s) ? <AlertIcon size={12} /> : <CheckIcon size={12} />}
                <button type="button" className="name" onClick={() => setPreview(s)}>
                  {s.label}
                  {isRetired(s) ? " (retired)" : ""}
                </button>
                <button type="button" className="x" onClick={() => toggleSkill(s.id)} aria-label={`Remove ${s.label}`}>×</button>
              </span>
            ))
          )}
        </div>

        {suggestions.length > 0 && (
          <div className="ab-suggest">
            <div className="ab-suggest-head">
              <span className="ab-suggest-title"><SparkIcon size={13} /> Suggested for this agent</span>
              {suggestions.length > 1 && (
                <button type="button" className="ab-edit" onClick={() => set({ skills: [...attached, ...suggestions.map((s) => s.skill.id)] })}>
                  Attach all {suggestions.length}
                </button>
              )}
            </div>
            <div className="ab-suggest-list">
              {suggestions.map(({ skill, reason }) => (
                <div key={skill.id} className="ab-suggest-item">
                  <div style={{ minWidth: 0 }}>
                    <span className="skill-card-category">{classifySkill(skill.label, skill.description)}</span>
                    <button type="button" className="ab-skill-name" onClick={() => setPreview(skill)}>{skill.label}</button>
                    <div className="sub-line">{reason}</div>
                  </div>
                  <button type="button" className="ab-attach" onClick={() => toggleSkill(skill.id)}>+ Attach</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {skills.length === 0 && attachedSkills.length === 0 ? (
          <div className="note" style={{ marginTop: 12 }}>
            No skills written yet. <Link href="/skills">Write one</Link> and every agent can be given it.
          </div>
        ) : (
          <>
            <button type="button" className={`ab-browse ${catalogueOpen ? "open" : ""}`} onClick={() => setCatalogueOpen((v) => !v)} aria-expanded={catalogueOpen}>
              <span>{catalogueOpen ? "Hide the catalogue" : `Browse all ${skills.length} skills`}</span>
              <ChevronIcon size={14} />
            </button>
            {catalogueOpen && (
              <div className="ab-catalogue">
                <div className="skill-filter-bar">
                  <div className="skill-search-wrap">
                    <span className="skill-search-icon"><SearchIcon size={14} /></span>
                    <input
                      type="text"
                      className="input skill-search-input"
                      placeholder={`Search ${skills.length} skills`}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <button type="button" className="skill-search-clear" onClick={() => setSearchQuery("")} aria-label="Clear search">×</button>
                    )}
                  </div>
                  <div className="skill-category-pills">
                    {categories.map((cat) => (
                      <button key={cat.id} type="button" className={`chip ${activeCategory === cat.id ? "on" : ""}`} onClick={() => setActiveCategory(cat.id)}>
                        {cat.label} <span className="al-n">{cat.count}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="skill-results-meta">
                  <span className="ab-row" style={{ gap: 8 }}>
                    <span className="ab-seg">
                      {(["all", "attached", "suggested"] as const).map((v) => (
                        <button key={v} type="button" className={show === v ? "on" : ""} onClick={() => setShow(v)}>
                          {v === "all" ? "All" : v === "attached" ? `Attached (${attached.length})` : `Suggested (${suggestions.length})`}
                        </button>
                      ))}
                    </span>
                    <span className="dim">Showing {filteredSkills.length} of {skills.length}</span>
                  </span>
                  <span className="ab-seg">
                    <button type="button" className={layout === "grid" ? "on" : ""} onClick={() => setLayout("grid")} aria-label="Cards"><GridIcon size={13} /></button>
                    <button type="button" className={layout === "list" ? "on" : ""} onClick={() => setLayout("list")} aria-label="List"><ListIcon size={13} /></button>
                  </span>
                </div>

                {filteredSkills.length === 0 ? (
                  <div className="note" style={{ textAlign: "center", padding: "24px 16px" }}>
                    No skills match.
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ display: "block", margin: "10px auto 0", fontSize: 12 }}
                      onClick={() => {
                        setSearchQuery("");
                        setActiveCategory("all");
                        setShow("all");
                      }}
                    >
                      Clear search and filters
                    </button>
                  </div>
                ) : layout === "list" ? (
                  <div className="ab-skill-list">
                    {filteredSkills.map((k) => {
                      const on = attached.includes(k.id);
                      const n = usedBy.get(k.id) ?? 0;
                      return (
                        <div key={k.id} className={`ab-skill-row ${on ? "on" : ""}`}>
                          <button type="button" className={`check ${on ? "on" : ""}`} onClick={() => toggleSkill(k.id)} aria-pressed={on} aria-label={`${on ? "Remove" : "Attach"} ${k.label}`} />
                          <button type="button" className="ab-skill-name" onClick={() => setPreview(k)}>{k.label}</button>
                          <span className="skill-card-category">{classifySkill(k.label, k.description)}</span>
                          <span className="sub-line">{n ? `Used by ${n}` : "Not used yet"}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="skill-grid-scroll">
                    <div className="skill-grid">
                      {filteredSkills.map((k) => {
                        const on = attached.includes(k.id);
                        const n = usedBy.get(k.id) ?? 0;
                        return (
                          <div
                            key={k.id}
                            className={`skill-card ${on ? "on" : ""}`}
                            onClick={() => toggleSkill(k.id)}
                            role="button"
                            tabIndex={0}
                            aria-pressed={on}
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
                                <button
                                  type="button"
                                  className="ab-skill-name"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPreview(k);
                                  }}
                                  title="Preview this skill"
                                >
                                  {k.label}
                                </button>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span className="skill-card-category">{classifySkill(k.label, k.description)}</span>
                                  {canCopy && (
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
                                  )}
                                </div>
                              </div>
                            </div>
                            <p className="skill-card-desc" title={k.description}>
                              {k.description || "No description provided."}
                            </p>
                            <span className="sub-line" style={{ fontSize: 11 }}>{n ? `Used by ${n} ${n === 1 ? "agent" : "agents"}` : "Not used by any agent yet"}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {preview && (
        <SkillPreview
          skill={preview}
          attached={attached.includes(preview.id)}
          usedBy={usedBy.get(preview.id) ?? 0}
          canCopy={canCopy}
          onToggle={() => toggleSkill(preview.id)}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

/** A read-only look at a skill. Copying is refused for people who may not copy skills. */
function SkillPreview({
  skill,
  attached,
  usedBy,
  canCopy,
  onToggle,
  onClose,
}: {
  skill: SkillInfo;
  attached: boolean;
  usedBy: number;
  canCopy: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const noCopy = canCopy
    ? {}
    : {
        onCopy: (e: React.ClipboardEvent) => e.preventDefault(),
        onCut: (e: React.ClipboardEvent) => e.preventDefault(),
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        onDragStart: (e: React.DragEvent) => e.preventDefault(),
        style: { userSelect: "none" as const, WebkitUserSelect: "none" as const },
      };
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="panel modal ab-skill-modal" role="dialog" aria-modal="true" aria-labelledby="ab-skill-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="eyebrow">{classifySkill(skill.label, skill.description)} · {usedBy ? `used by ${usedBy} ${usedBy === 1 ? "agent" : "agents"}` : "not used yet"}</div>
        <h2 id="ab-skill-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>{skill.label}</h2>
        <p className="help" style={{ marginTop: 0 }}>{skill.description || "No description provided."}</p>
        {skill.instructions && (
          <div className="ab-skill-body" {...noCopy}>
            {skill.instructions}
          </div>
        )}
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Close</button>
          <button className={attached ? "btn btn-danger" : "btn btn-primary"} onClick={() => { onToggle(); onClose(); }}>
            {attached ? "Remove from this agent" : "Attach to this agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── step 3: data and inputs ──────────────────────────────── */

// Names and icons of connection kinds come from lib/connection-types and ConnectorIcons,
// shared with the Connections page.

/** Words in the brief that point at a type of connection. */
const KIND_WORDS: { kind: string; words: RegExp; why: string }[] = [
  { kind: "postgres", words: /\b(postgres|postgresql|sql|database|db|table|ledger|erp|sap)\b/i, why: "The brief mentions a database" },
  { kind: "slack", words: /\bslack\b|#[a-z]/i, why: "The brief mentions Slack" },
  { kind: "smtp", words: /\b(email|e-mail|mail|inbox|outlook)\b/i, why: "The brief mentions email" },
  { kind: "msteams", words: /\b(teams|microsoft teams)\b/i, why: "The brief mentions Teams" },
  { kind: "jira", words: /\b(jira|ticket|servicenow|service desk)\b/i, why: "The brief mentions tickets" },
  { kind: "github", words: /\b(github|repository|repo|pull request)\b/i, why: "The brief mentions GitHub" },
  { kind: "s3", words: /\b(s3|bucket|dms|document store|file store)\b/i, why: "The brief mentions file storage" },
  { kind: "http", words: /\b(api|endpoint|portal|webhook|rest)\b/i, why: "The brief mentions an API or portal" },
];

type SuggestedInput = { label: string; hint: string; type: SpecInput["type"]; required: boolean; options?: string[]; accept?: string[] };

function getArchetypeInputSuggestions(archetype?: string): SuggestedInput[] {
  const arch = (archetype || "analyst").toLowerCase();
  if (arch === "analyst") {
    return [
      { label: "Source ledger or report", type: "file", required: true, hint: "The CSV, PDF or Word file to analyse" },
      { label: "Analysis cut-off date", type: "date", required: false, hint: "End date for the reporting window" },
      { label: "Variance threshold (%)", type: "number", required: false, hint: "Flag any variance above this, e.g. 5" },
      { label: "Reporting currency", type: "choice", required: false, options: ["USD", "EUR", "GBP", "INR"], hint: "Currency for the figures" },
    ];
  }
  if (arch === "author") {
    return [
      { label: "Background notes", type: "file", required: false, hint: "PDF, Word or text notes with source material" },
      { label: "Audience", type: "choice", required: true, options: ["Leadership", "Finance team", "Auditors", "Customers"], hint: "Sets tone and depth" },
      { label: "Key points to cover", type: "longtext", required: false, hint: "Anything that must be included" },
      { label: "Word limit", type: "number", required: false, hint: "Target length, e.g. 800" },
    ];
  }
  if (arch === "operator") {
    return [
      { label: "Item or ticket reference", type: "text", required: true, hint: "e.g. JIRA-4291 or order 99102" },
      { label: "Mode", type: "choice", required: true, options: ["Dry run (report only)", "Make the changes"], hint: "Report first, or act" },
      { label: "Reason for the change", type: "text", required: false, hint: "Logged in the audit trail" },
    ];
  }
  if (arch === "sentinel") {
    return [
      { label: "Alert level", type: "choice", required: true, options: ["Everything", "Medium and high", "Critical only"], hint: "What is worth raising" },
      { label: "Look-back window (hours)", type: "number", required: false, hint: "How far back to check, e.g. 24" },
      { label: "Who to notify", type: "text", required: false, hint: "A channel or email address" },
    ];
  }
  return [];
}

/** Inputs the brief and steps imply, such as a file when they talk about uploading a statement. */
function briefInputSuggestions(spec: AgentSpec): SuggestedInput[] {
  const t = `${spec.brief} ${spec.purpose} ${spec.steps.join(" ")}`.toLowerCase();
  const out: SuggestedInput[] = [];
  if (/\b(upload|attach|statement|ledger|invoice|extract|listing|register|schedule|workbook|spreadsheet|csv|pdf|file)s?\b/.test(t)) {
    out.push({ label: "Source document", type: "file", required: true, hint: "The file it should read" });
  }
  if (/\b(period|month|quarter|cut-?off|as at|as of|week ending)\b/.test(t)) {
    out.push({ label: "Reporting period", type: "text", required: true, hint: "e.g. September 2026 or Q2 FY27" });
  }
  if (/(%|\b(threshold|tolerance|materiality|limit)\b)/.test(t)) {
    out.push({ label: "Threshold", type: "number", required: false, hint: "The level above which something is flagged" });
  }
  if (/\b(entity|entities|company code|business unit|branch|region)\b/.test(t)) {
    out.push({ label: "Entity or unit", type: "text", required: false, hint: "Which entity, branch or region to cover" });
  }
  return out;
}

const TYPE_GLYPH: Record<SpecInput["type"], React.ReactNode> = {
  text: <span className="ab-glyph">Aa</span>,
  longtext: <DocIcon size={15} />,
  number: <span className="ab-glyph">#</span>,
  date: <CalendarIcon size={15} />,
  choice: <ListIcon size={15} />,
  file: <UploadIcon size={15} />,
};

/** Options for a choice input, typed one at a time and shown as removable tags. */
function TagEditor({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().replace(/,$/, "");
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className="ab-tags" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}>
      {values.map((v) => (
        <span key={v} className="ab-tag">
          {v}
          <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>×</button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={values.length ? "Add another…" : "Type an option and press Enter"}
        onChange={(e) => (e.target.value.endsWith(",") ? (setDraft(e.target.value.slice(0, -1)), add()) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

/** What a person sees when they run the agent, drawn from the inputs as they stand. */
function RunFormPreview({ name, inputs, onClose }: { name: string; inputs: SpecInput[]; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="panel modal ab-skill-modal" role="dialog" aria-modal="true" aria-labelledby="ab-prev-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="eyebrow">Preview · what a person sees when they click Run</div>
        <h2 id="ab-prev-title" style={{ margin: "2px 0 12px", fontSize: 17 }}>Run {name || "this agent"}</h2>
        {inputs.length === 0 ? (
          <p className="help">Nothing is asked for. They can add a note and run it.</p>
        ) : (
          <div className="stack">
            {inputs.map((i) => (
              <label className="field" key={i.key}>
                <span className="eyebrow">
                  {i.label || "Untitled field"}
                  {i.required && <span className="req"> required</span>}
                </span>
                {i.type === "file" ? (
                  <input className="input" type="file" disabled />
                ) : i.type === "longtext" ? (
                  <textarea className="textarea" rows={3} placeholder={i.hint} disabled />
                ) : i.type === "choice" ? (
                  <select className="input" disabled>
                    <option>{(i.options ?? []).length ? `Choose: ${(i.options ?? []).join(" / ")}` : "Choose…"}</option>
                  </select>
                ) : (
                  <input className="input" type={i.type === "number" ? "number" : i.type === "date" ? "date" : "text"} placeholder={i.hint} disabled />
                )}
                {i.type === "file" && acceptedExtensions(i).length > 0 && <span className="sub-line" style={{ display: "block" }}>Accepts {acceptedExtensions(i).join(", ")}</span>}
                {i.type !== "file" && i.hint && i.type !== "longtext" && i.type !== "text" && i.type !== "number" && <span className="sub-line">{i.hint}</span>}
                {i.type === "file" && i.hint && <span className="sub-line">{i.hint}</span>}
              </label>
            ))}
          </div>
        )}
        <div className="panel-foot">
          <span className="sub-line">The preview is not interactive.</span>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Data({ spec, set, connections, tools }: { spec: AgentSpec; set: SetSpec; connections: Conn[]; tools: ToolInfo[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [connQuery, setConnQuery] = useState("");
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (menu == null) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  // ---- connections: only the kinds some action can use -----------------------
  const usableKinds = useMemo(() => new Set(tools.map((t) => t.needs).filter(Boolean) as string[]), [tools]);
  const isOn = (c: Conn) => spec.sources.some((s) => s.connectionId === c.id);
  const toggle = (c: Conn) =>
    set({ sources: isOn(c) ? spec.sources.filter((s) => s.connectionId !== c.id) : [...spec.sources, { connectionId: c.id, label: c.name }] });

  const neededBy = (kind: string) =>
    spec.tools.map((t) => tools.find((x) => x.id === t.id)).filter((t) => t?.needs === kind).map((t) => t!.label);
  const corpus = `${spec.brief} ${spec.purpose} ${spec.steps.join(" ")}`;
  const why = (kind: string): string => {
    const n = neededBy(kind);
    if (n.length) return `Needed by “${n.join("”, “")}”`;
    return KIND_WORDS.find((k) => k.kind === kind && k.words.test(corpus))?.why ?? "";
  };

  const usable = connections.filter((c) => usableKinds.has(c.kind));
  const hiddenNames = [...new Set(connections.filter((c) => !usableKinds.has(c.kind)).map((c) => c.name))];
  const attachedConns = usable.filter(isOn);
  const suggestedConns = usable.filter((c) => !isOn(c) && why(c.kind));
  const otherConns = usable
    .filter((c) => !isOn(c) && !why(c.kind))
    .filter((c) => !connQuery.trim() || `${c.name} ${kindLabel(c.kind)}`.toLowerCase().includes(connQuery.toLowerCase().trim()));
  // Attached sources the agent cannot use: an unusable kind, or a connection since deleted.
  const deadSources = spec.sources.filter((s) => {
    const c = connections.find((x) => x.id === s.connectionId);
    return !c || !usableKinds.has(c.kind);
  });
  const neededKinds = [...usableKinds].filter((k) => neededBy(k).length || KIND_WORDS.some((w) => w.kind === k && w.words.test(corpus)));
  const missingKinds = neededKinds.filter((k) => !connections.some((c) => c.kind === k));

  const tile = (c: Conn) => {
    const on = isOn(c);
    const reason = why(c.kind);
    const where = c.config?.host || c.config?.baseUrl || kindLabel(c.kind);
    return (
      <button key={c.id} type="button" className={`ab-conn ${on ? "on" : ""}`} onClick={() => toggle(c)} aria-pressed={on}>
        <span className="ab-conn-check">{on && <CheckIcon size={12} />}</span>
        <span className="ab-conn-ic"><KindIcon kind={c.kind} /></span>
        <span className="ab-conn-body">
          <b>{c.name}</b>
          <span className="where">{where}</span>
          {reason && <span className={`why ${neededBy(c.kind).length ? "need" : ""}`}>{reason}</span>}
        </span>
      </button>
    );
  };

  // ---- run inputs ----------------------------------------------------------
  const inputs = normaliseInputs(spec.inputs as any[]);
  const setInputs = (next: SpecInput[]) => set({ inputs: next });
  const setInput = (idx: number, patch: Partial<SpecInput>) => setInputs(inputs.map((i, n) => (n === idx ? { ...i, ...patch } : i)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= inputs.length || from === to) return;
    const arr = [...inputs];
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
    setInputs(arr);
    setOpen(null);
  };
  const addInput = () => {
    setInputs([...inputs, { key: `input_${inputs.length + 1}`, label: "", hint: "", type: "text", required: false }]);
    setOpen(inputs.length);
  };
  const toInput = (s: SuggestedInput, idx: number): SpecInput => ({
    key: inputKey(s.label, idx),
    label: s.label,
    hint: s.hint,
    type: s.type,
    required: s.required,
    ...(s.options ? { options: s.options } : {}),
    ...(s.accept ? { accept: s.accept } : {}),
  });
  const has = (label: string) => inputs.some((i) => i.label.trim().toLowerCase() === label.toLowerCase() || i.key === inputKey(label, 0));
  const suggestions = [...briefInputSuggestions(spec), ...getArchetypeInputSuggestions(spec.archetype)]
    .filter((s, i, all) => all.findIndex((x) => x.label.toLowerCase() === s.label.toLowerCase()) === i)
    // One suggested file is enough when a file input already exists.
    .filter((s) => !has(s.label) && !(s.type === "file" && inputs.some((i) => i.type === "file")))
    .slice(0, 6);
  const readDoc = tools.find((t) => t.id === "read_document");
  const needsReader = inputs.some((i) => i.type === "file") && readDoc && !spec.tools.some((t) => t.id === "read_document");

  return (
    <div className="ab-ins">
      <h2 className="ab-h">Data and inputs</h2>
      <p className="ab-lead">
        What the agent can read: <strong>connections</strong> it reaches on its own, and <strong>run inputs</strong> a person
        fills in or uploads each time it runs.
      </p>

      {/* ---- connections ---- */}
      <section className="ab-sec">
        <header className="ab-sec-head">
          <span className="ab-sec-ic"><PlugIcon size={17} /></span>
          <div className="grow">
            <h3>Connections</h3>
            <p>Shared systems the agent reaches through its actions. Credentials stay on the server; the agent never sees them.</p>
          </div>
          <span className="ab-pill" style={attachedConns.length ? undefined : { background: "#eef2f8", color: "var(--muted-2)" }}>
            {attachedConns.length} attached
          </span>
        </header>

        {deadSources.length > 0 && (
          <div className="ab-hint warn">
            <AlertIcon />
            <span className="grow">
              {deadSources.length === 1 ? "One attached connection is" : `${deadSources.length} attached connections are`} not used by any
              action:{" "}
              {deadSources.map((s) => connections.find((c) => c.id === s.connectionId)?.name || s.label || "a deleted connection").join(", ")}.
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => set({ sources: spec.sources.filter((s) => !deadSources.includes(s)) })}
            >
              Remove {deadSources.length === 1 ? "it" : "them"}
            </button>
          </div>
        )}

        {usable.length === 0 && missingKinds.length === 0 ? (
          <div className="note">
            No usable connections yet. Web search, reading a page and reading uploaded files work without one.{" "}
            <Link href="/connections">Add a connection</Link> for databases, email, Slack and the like.
          </div>
        ) : (
          <>
            {(attachedConns.length > 0 || suggestedConns.length > 0 || missingKinds.length > 0) && (
              <div className="ab-conns">
                {attachedConns.map(tile)}
                {suggestedConns.map(tile)}
                {missingKinds.map((k) => (
                  <Link key={k} href={`/connections?add=${k}`} className="ab-conn missing">
                    <span className="ab-conn-ic"><KindIcon kind={k} /></span>
                    <span className="ab-conn-body">
                      <b>+ Add a {kindLabel(k)} connection</b>
                      <span className="why need">{why(k) || "Suggested for this agent"}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
            {usable.length > attachedConns.length + suggestedConns.length && (
              <>
                <button type="button" className={`ab-browse ${showAll ? "open" : ""}`} onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                  <span>{showAll ? "Hide other connections" : `Show ${usable.length - attachedConns.length - suggestedConns.length} other connections`}</span>
                  <ChevronIcon size={14} />
                </button>
                {showAll && (
                  <div className="ab-catalogue">
                    {usable.length > 8 && (
                      <input className="input" style={{ marginBottom: 10 }} placeholder="Search connections" value={connQuery} onChange={(e) => setConnQuery(e.target.value)} />
                    )}
                    <div className="ab-conns">{otherConns.map(tile)}</div>
                    {otherConns.length === 0 && <p className="sub-line" style={{ margin: 0 }}>No connections match.</p>}
                  </div>
                )}
              </>
            )}
          </>
        )}
        <p className="sub-line" style={{ margin: "10px 0 0" }}>
          Only connections an action can use are listed
          {hiddenNames.length > 0 ? ` (${hiddenNames.join(", ")} ${hiddenNames.length === 1 ? "is" : "are"} not usable by agents yet)` : ""}.{" "}
          <Link href="/connections">Manage connections ↗</Link>
        </p>
      </section>

      {/* ---- run inputs ---- */}
      <section className="ab-sec">
        <header className="ab-sec-head">
          <span className="ab-sec-ic"><FormIcon size={17} /></span>
          <div className="grow">
            <h3>Run inputs</h3>
            <p>The form a person fills in when they run it. Scheduled runs use the standing values set under Schedule.</p>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => setPreview(true)}>Preview the form</button>
        </header>

        {suggestions.length > 0 && (
          <div className="ab-suggest" style={{ marginTop: 0, marginBottom: 12 }}>
            <div className="ab-suggest-head">
              <span className="ab-suggest-title"><SparkIcon size={13} /> Suggested fields</span>
              {suggestions.length > 1 && (
                <button type="button" className="ab-edit" onClick={() => setInputs([...inputs, ...suggestions.map((s, i) => toInput(s, inputs.length + i))])}>
                  Add all {suggestions.length}
                </button>
              )}
            </div>
            <div className="ab-insugs">
              {suggestions.map((s) => (
                <button key={s.label} type="button" className="ab-insug" title={s.hint} onClick={() => setInputs([...inputs, toInput(s, inputs.length)])}>
                  <span className="ab-type-ic">{TYPE_GLYPH[s.type]}</span>
                  <span className="body">
                    <b>{s.label}</b>
                    <span>{INPUT_TYPES.find((t) => t.id === s.type)?.label} · {s.hint}</span>
                  </span>
                  <span className="plus">+</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {inputs.length === 0 ? (
          <div className="note">Nothing is asked for at run time. The agent works from its connections and instructions.</div>
        ) : (
          <div className="ab-inputs">
            {inputs.map((i, idx) => {
              const isOpen = open === idx;
              const typeLabel = INPUT_TYPES.find((t) => t.id === i.type)?.label ?? i.type;
              const detail =
                i.type === "choice" ? `${(i.options ?? []).length} options`
                  : i.type === "file" && (i.accept ?? []).length ? (i.accept ?? []).map((a) => FILE_KINDS.find((k) => k.id === a)?.label).join(", ")
                    : i.hint;
              return (
                <div
                  key={idx}
                  className={`ab-input ${isOpen ? "open" : ""} ${!i.label.trim() ? "empty" : ""} ${dragFrom === idx ? "dragging" : ""} ${dragOver === idx && dragFrom !== idx ? "over" : ""}`}
                  draggable={armed === idx}
                  onDragStart={(e) => {
                    setDragFrom(idx);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    if (dragFrom == null) return;
                    e.preventDefault();
                    setDragOver(idx);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragFrom != null) move(dragFrom, idx);
                    setDragFrom(null);
                    setDragOver(null);
                    setArmed(null);
                  }}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDragOver(null);
                    setArmed(null);
                  }}
                >
                  <div className="ab-input-row" onClick={() => setOpen(isOpen ? null : idx)}>
                    <span className="ab-type-ic grab" title="Drag to reorder" onMouseDown={() => setArmed(idx)} onMouseUp={() => setArmed(null)}>
                      {TYPE_GLYPH[i.type]}
                    </span>
                    <span className="ab-input-main">
                      <b>{i.label || "Untitled field"}</b>
                      <span>{typeLabel}{detail ? ` · ${detail}` : ""}</span>
                    </span>
                    <label className="ab-switch small" onClick={(e) => e.stopPropagation()} title="Whether the run cannot start without it">
                      <input type="checkbox" checked={i.required} onChange={(e) => setInput(idx, { required: e.target.checked })} />
                      <span className="track" />
                      Required
                    </label>
                    <div className="ab-more" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="ab-tl-btn" aria-label={`Actions for ${i.label || "this field"}`} onClick={() => setMenu(menu === idx ? null : idx)}>
                        <MoreIcon />
                      </button>
                      {menu === idx && (
                        <div className="ab-menu" role="menu" style={{ zIndex: 60 }}>
                          <button role="menuitem" onClick={() => { setOpen(isOpen ? null : idx); setMenu(null); }}>{isOpen ? "Close" : "Edit"}</button>
                          <button role="menuitem" onClick={() => { setInputs([...inputs.slice(0, idx + 1), { ...i, key: inputKey(`${i.label} copy`, idx + 1), label: `${i.label} (copy)` }, ...inputs.slice(idx + 1)]); setMenu(null); }}>
                            Duplicate
                          </button>
                          <button role="menuitem" disabled={idx === 0} onClick={() => { move(idx, idx - 1); setMenu(null); }}>↑ Move up</button>
                          <button role="menuitem" disabled={idx === inputs.length - 1} onClick={() => { move(idx, idx + 1); setMenu(null); }}>↓ Move down</button>
                          <div className="ab-menu-sep" />
                          <button role="menuitem" className="danger" onClick={() => { setInputs(inputs.filter((_, n) => n !== idx)); setMenu(null); setOpen(null); }}>
                            <TrashIcon /> Delete field
                          </button>
                        </div>
                      )}
                    </div>
                    <span className={`ab-input-chev ${isOpen ? "open" : ""}`}><ChevronIcon size={14} /></span>
                  </div>

                  {isOpen && (
                    <div className="ab-input-edit">
                      <div className="ab-grid2">
                        <label className="ab-field">
                          <span className="ab-label">Label</span>
                          <input
                            className="input"
                            autoFocus={!i.label}
                            value={i.label}
                            placeholder="e.g. Ledger statement"
                            onChange={(e) => setInput(idx, { label: e.target.value, key: inputKey(e.target.value, idx) })}
                          />
                        </label>
                        <label className="ab-field">
                          <span className="ab-label">Hint for the person filling it in</span>
                          <input className="input" value={i.hint} placeholder="What to enter or upload" onChange={(e) => setInput(idx, { hint: e.target.value })} />
                        </label>
                      </div>
                      <div className="ab-field">
                        <span className="ab-label">Type</span>
                        <div className="ab-typepick">
                          {INPUT_TYPES.map((t) => (
                            <button key={t.id} type="button" className={i.type === t.id ? "on" : ""} onClick={() => setInput(idx, { type: t.id })} title={t.blurb}>
                              <span className="ab-type-ic">{TYPE_GLYPH[t.id]}</span>
                              <b>{t.label}</b>
                            </button>
                          ))}
                        </div>
                      </div>
                      {i.type === "choice" && (
                        <div className="ab-field">
                          <span className="ab-label">Options</span>
                          <TagEditor values={i.options ?? []} onChange={(options) => setInput(idx, { options })} />
                        </div>
                      )}
                      {i.type === "file" && (
                        <div className="ab-field">
                          <span className="ab-label">Accepted files <em>— none ticked means any file it can read</em></span>
                          <div className="ab-brief-chips" style={{ marginBottom: 0 }}>
                            {FILE_KINDS.map((k) => {
                              const on = (i.accept ?? []).includes(k.id);
                              return (
                                <button
                                  key={k.id}
                                  type="button"
                                  className={`ab-bchip ${on ? "met" : ""}`}
                                  onClick={() => setInput(idx, { accept: on ? (i.accept ?? []).filter((x) => x !== k.id) : [...(i.accept ?? []), k.id] })}
                                  title={k.exts.join(", ")}
                                >
                                  {on ? <CheckIcon size={12} /> : <span className="plus">+</span>}
                                  {k.label}
                                </button>
                              );
                            })}
                          </div>
                          <span className="ab-field-note">Excel is not offered: the agent cannot read it yet. Save the sheet as CSV instead.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button type="button" className="ab-tl-addbtn" style={{ marginTop: 6 }} onClick={addInput}>+ Add a field</button>

        {needsReader && (
          <div className="ab-hint warn" style={{ marginTop: 10, marginBottom: 0, alignItems: "center" }}>
            <AlertIcon />
            <span className="grow">Uploaded files are read with the “{readDoc!.label}” action, which is not granted.</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => set({ tools: [...spec.tools, { id: "read_document", gate: readDoc!.risk === "low" ? "auto" : "approval" }] })}
            >
              Grant it
            </button>
          </div>
        )}
      </section>

      {preview && <RunFormPreview name={spec.name} inputs={inputs} onClose={() => setPreview(false)} />}
    </div>
  );
}

/* ── step 4: actions and safety ───────────────────────────── */

function isToolRecommended(t: ToolInfo, spec: AgentSpec, connections: Conn[]): boolean {
  if (t.needs && spec.sources.some((s) => connections.find((c) => c.id === s.connectionId)?.kind === t.needs)) return true;
  const corpus = `${spec.brief || ""} ${spec.purpose || ""} ${(spec.steps || []).join(" ")}`.toLowerCase();
  const rules: [string[], RegExp][] = [
    [["web_search", "fetch_url"], /search|web|google|internet|research|lookup|browse|fetch|url|article|news/],
    [["write_file"], /write|file|markdown|export|download|save|report|briefing/],
    [["sql_query", "sql_execute"], /database|postgres|sql|query|table|schema|records/],
    [["send_email"], /email|mail|gmail|smtp|send to/],
    [["post_message"], /slack|channel|#|chat alert|post/],
    [["post_teams_message"], /teams|microsoft teams/],
    [["jira_create_issue", "jira_search_issues"], /jira|ticket|issue|sprint/],
    [["github_create_issue", "github_read_file"], /github|repo|pull request|commit|code/],
    [["s3_upload_file"], /s3|bucket|cloud storage|upload/],
    [["http_request"], /api|rest|webhook|http|curl|endpoint/],
  ];
  if (t.id === "read_document") {
    return (spec.inputs || []).some((i: any) => i.type === "file") || /pdf|document|contract|file|csv|excel|statement|ledger|read|upload/.test(corpus);
  }
  return rules.some(([ids, re]) => ids.includes(t.id) && re.test(corpus));
}

/** Actions grouped by what they do to the world, least consequential first. */
const ACTION_GROUPS: { id: string; title: string; note: string; ids: string[] }[] = [
  { id: "read", title: "Read and research", note: "Looks things up; changes nothing", ids: ["web_search", "fetch_url", "read_document", "sql_query", "jira_search_issues", "github_read_file", "kv_get"] },
  { id: "produce", title: "Produce", note: "Creates the deliverable", ids: ["write_file"] },
  { id: "communicate", title: "Communicate", note: "Sends messages to people", ids: ["send_email", "post_message", "post_teams_message"] },
  { id: "change", title: "Change systems", note: "Writes to other systems", ids: ["sql_execute", "jira_create_issue", "github_create_issue", "s3_upload_file", "http_request", "kv_set"] },
];
/** Handled by the Delegation card rather than as a tile. */
const DELEGATE_TOOL = "invoke_agent";

const LINE_ICON: Record<string, React.ReactNode> = {
  web_search: <SearchIcon size={17} />,
  fetch_url: <DocIcon size={17} />,
  read_document: <UploadIcon size={17} />,
  write_file: <PencilIcon size={17} />,
};

function ActionIcon({ t }: { t: ToolInfo }) {
  if (LINE_ICON[t.id]) return <span className="ab-kind-glyph">{LINE_ICON[t.id]}</span>;
  if (t.needs) return <KindIcon kind={t.needs} size={20} />;
  return <span className="ab-kind-glyph"><WrenchIcon size={17} /></span>;
}

const STEP_PRESETS = [
  { id: "light", label: "Light", n: 8, note: "Quick lookups" },
  { id: "standard", label: "Standard", n: 12, note: "Most agents" },
  { id: "thorough", label: "Thorough", n: 20, note: "Long investigations" },
];

const BEHAVIOURS: { key: "requireCitations" | "stayInScope" | "escalateOnAmbiguity"; title: string; note: string }[] = [
  { key: "requireCitations", title: "Cite its sources", note: "Every figure, record or claim says where it came from" },
  { key: "stayInScope", title: "Stay in scope", note: "Declines work outside its brief and instructions" },
  { key: "escalateOnAmbiguity", title: "Ask when unsure", note: "Says what is missing instead of guessing" },
];

const MASKS: { key: "redactCreditCards" | "redactEmails" | "redactCredentials" | "redactPhoneNumbers"; title: string; note: string }[] = [
  { key: "redactCreditCards", title: "Card numbers", note: "Visa, Mastercard, Amex → ••••1234" },
  { key: "redactEmails", title: "Email addresses", note: "Keeps the domain, hides the name" },
  { key: "redactCredentials", title: "Keys and passwords", note: "API keys, bearer tokens, private keys" },
  { key: "redactPhoneNumbers", title: "Phone and ID numbers", note: "Phone numbers and national ID formats" },
];

/** "Never do" rules are kept one per line in guardrails.extra. */
const splitRules = (extra: string) => extra.split(/\n+/).map((r) => r.trim()).filter(Boolean);

function Actions({
  spec,
  set,
  tools,
  connections,
  agentId,
  workspaceAgents,
}: {
  spec: AgentSpec;
  set: SetSpec;
  tools: ToolInfo[];
  connections: Conn[];
  agentId: string | null;
  workspaceAgents: { id: string; name: string; description: string; archetype: string }[];
}) {
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [ruleDraft, setRuleDraft] = useState("");
  const [sample, setSample] = useState(
    "Alice (alice@acme-corp.com, +1 555 019 2834) paid with card 4532-1188-9922-3411 using token sk-ant-api03-994827118237482910.",
  );
  const [pattern, setPattern] = useState({ name: "", pattern: "", replacement: "" });

  const g = spec.guardrails;
  const setG = (patch: Partial<AgentSpec["guardrails"]>) => set({ guardrails: { ...g, ...patch } });
  const swarm = spec.swarm ?? emptySpec().swarm!;
  const granted = (id: string) => spec.tools.find((x) => x.id === id);
  const grant = (t: ToolInfo) => set({ tools: [...spec.tools, { id: t.id, gate: t.risk === "low" ? "auto" : "approval" }] });
  const revoke = (id: string) => set({ tools: spec.tools.filter((x) => x.id !== id) });
  const setGate = (id: string, gate: "auto" | "approval") => set({ tools: spec.tools.map((x) => (x.id === id ? { ...x, gate } : x)) });
  const attachConn = (c: Conn) => {
    if (!spec.sources.some((s) => s.connectionId === c.id)) set({ sources: [...spec.sources, { connectionId: c.id, label: c.name }] });
  };

  // An action needing a kind of connection nobody has set up cannot work here.
  const available = (t: ToolInfo) => !t.needs || connections.some((c) => c.kind === t.needs);
  const tileTools = tools.filter((t) => t.id !== DELEGATE_TOOL);
  const unavailable = tileTools.filter((t) => !available(t) && !granted(t.id));
  const grantedTiles = spec.tools.filter((x) => x.id !== DELEGATE_TOOL);
  const autoCount = grantedTiles.filter((x) => x.gate === "auto").length;
  const approvalCount = grantedTiles.length - autoCount;

  const tile = (t: ToolInfo) => {
    const sel = granted(t.id);
    const locked = t.risk !== "low";
    const attachedConn = t.needs ? connections.find((c) => c.kind === t.needs && spec.sources.some((s) => s.connectionId === c.id)) : null;
    const spare = t.needs && !attachedConn ? connections.find((c) => c.kind === t.needs) : null;
    const rec = !sel && isToolRecommended(t, spec, connections);
    return (
      <div
        key={t.id}
        className={`ab-act ${sel ? "on" : ""}`}
        role="button"
        tabIndex={0}
        aria-pressed={!!sel}
        onClick={() => (sel ? revoke(t.id) : grant(t))}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            sel ? revoke(t.id) : grant(t);
          }
        }}
      >
        <div className="ab-act-top">
          <span className="ab-conn-ic"><ActionIcon t={t} /></span>
          <span className="ab-act-name">
            <b>{t.label}</b>
            {rec && <span className="ab-rec">Suggested</span>}
          </span>
          <span className={`ab-risk ${t.risk}`}>{RISK_LABEL[t.risk]}</span>
          <span className="ab-conn-check static">{sel && <CheckIcon size={12} />}</span>
        </div>
        <p className="ab-act-desc">{t.description}</p>
        {sel && (
          <div className="ab-act-foot" onClick={(e) => e.stopPropagation()}>
            {locked ? (
              <span className="ab-act-lock" title="Actions that reach outside or change data always wait for a person">
                <ShieldIcon size={12} /> Always needs approval
              </span>
            ) : (
              <span className="ab-seg small">
                <button type="button" className={sel.gate === "auto" ? "on" : ""} onClick={() => setGate(t.id, "auto")}>Runs on its own</button>
                <button type="button" className={sel.gate === "approval" ? "on" : ""} onClick={() => setGate(t.id, "approval")}>Needs approval</button>
              </span>
            )}
            {t.needs &&
              (attachedConn ? (
                <span className="ab-needs ok"><CheckIcon size={12} /> Uses {attachedConn.name}</span>
              ) : spare ? (
                <span className="ab-needs miss">
                  <AlertIcon size={12} /> Needs a {kindLabel(t.needs)} connection
                  <button type="button" className="ab-edit" onClick={() => attachConn(spare)}>Attach {spare.name}</button>
                </span>
              ) : (
                <span className="ab-needs none">
                  <AlertIcon size={12} /> No {kindLabel(t.needs)} connection exists. <Link href={`/connections?add=${t.needs}`}>Add one</Link>
                </span>
              ))}
          </div>
        )}
      </div>
    );
  };

  // ---- delegation: one control for asking another agent and for a team ----
  const mode: "off" | "ask" | "team" = swarm.enabled ? "team" : granted(DELEGATE_TOOL) ? "ask" : "off";
  const delegateTool = tools.find((t) => t.id === DELEGATE_TOOL);
  const setMode = (m: "off" | "ask" | "team") => {
    const others = spec.tools.filter((x) => x.id !== DELEGATE_TOOL);
    if (m === "off") set({ tools: others, swarm: { ...swarm, enabled: false } });
    if (m === "ask") set({ tools: delegateTool ? [...others, { id: DELEGATE_TOOL, gate: "auto" }] : others, swarm: { ...swarm, enabled: false } });
    if (m === "team") set({ tools: others, swarm: { ...swarm, enabled: true } });
  };

  const stepPreset = STEP_PRESETS.find((p) => p.n === g.maxSteps)?.id ?? "custom";
  const rules = splitRules(g.extra || "");
  const setRules = (next: string[]) => setG({ extra: next.join("\n") });
  const addRule = () => {
    const r = ruleDraft.trim();
    if (r && !rules.includes(r)) setRules([...rules, r]);
    setRuleDraft("");
  };
  const customPatterns = g.customDlpPatterns ?? [];
  const patternValid = (() => {
    if (!pattern.pattern) return false;
    try {
      new RegExp(pattern.pattern);
      return true;
    } catch {
      return false;
    }
  })();
  const masked = maskPII(sample, {
    enabled: g.dlpEnabled ?? false,
    redactCreditCards: g.redactCreditCards ?? true,
    redactEmails: g.redactEmails ?? true,
    redactCredentials: g.redactCredentials ?? true,
    redactPhoneNumbers: g.redactPhoneNumbers ?? true,
    customPatterns,
  });

  return (
    <div className="ab-ins">
      <h2 className="ab-h">Actions and safety</h2>
      <p className="ab-lead">
        What the agent may do, and the limits it works within. Read-only actions can run on their own; anything that reaches
        outside or changes data waits for a person to approve it.
      </p>

      {/* ---- actions ---- */}
      <section className="ab-sec">
        <header className="ab-sec-head">
          <span className="ab-sec-ic"><WrenchIcon size={17} /></span>
          <div className="grow">
            <h3>Actions</h3>
            <p>Click an action to grant it. Granted actions show whether they may run on their own.</p>
          </div>
          <span className={`ab-pill ${grantedTiles.length ? "" : "warn"}`}>
            {grantedTiles.length
              ? `${grantedTiles.length} granted · ${autoCount} on its own · ${approvalCount} need${approvalCount === 1 ? "s" : ""} approval`
              : "None granted yet"}
          </span>
        </header>

        {ACTION_GROUPS.map((grp) => {
          const list = tileTools.filter((t) => grp.ids.includes(t.id) && (available(t) || granted(t.id)));
          if (!list.length) return null;
          return (
            <div key={grp.id} className="ab-act-group">
              <div className="ab-act-group-head">
                <b>{grp.title}</b>
                <span>{grp.note}</span>
              </div>
              <div className="ab-acts">{list.map(tile)}</div>
            </div>
          );
        })}
        {/* Anything not in a group still gets offered. */}
        {(() => {
          const known = new Set(ACTION_GROUPS.flatMap((x) => x.ids));
          const rest = tileTools.filter((t) => !known.has(t.id) && (available(t) || granted(t.id)));
          return rest.length ? (
            <div className="ab-act-group">
              <div className="ab-act-group-head"><b>Other</b></div>
              <div className="ab-acts">{rest.map(tile)}</div>
            </div>
          ) : null;
        })()}

        {unavailable.length > 0 && (
          <>
            <button type="button" className={`ab-browse ${showUnavailable ? "open" : ""}`} onClick={() => setShowUnavailable((v) => !v)} aria-expanded={showUnavailable}>
              <span>{unavailable.length} not available — no connection for them yet</span>
              <ChevronIcon size={14} />
            </button>
            {showUnavailable && (
              <div className="ab-catalogue">
                <div className="ab-unavail">
                  {unavailable.map((t) => (
                    <div key={t.id} className="ab-unavail-row">
                      <span className="ab-conn-ic"><ActionIcon t={t} /></span>
                      <span className="grow">
                        <b>{t.label}</b>
                        <span>Needs a {kindLabel(t.needs!)} connection</span>
                      </span>
                      <Link href={`/connections?add=${t.needs}`} className="ab-edit">Add a connection ↗</Link>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ---- limits and rules ---- */}
      <section className="ab-sec">
        <header className="ab-sec-head">
          <span className="ab-sec-ic"><ShieldIcon size={17} /></span>
          <div className="grow">
            <h3>Limits and rules</h3>
            <p>How far a single run may go, and the rules every run follows, whoever starts it.</p>
          </div>
        </header>

        <div className="ab-field">
          <span className="ab-label">Most actions in one run</span>
          <div className="ab-presets2">
            {STEP_PRESETS.map((p) => (
              <button key={p.id} type="button" className={`ab-format ${stepPreset === p.id ? "on" : ""}`} onClick={() => setG({ maxSteps: p.n })}>
                <b>{p.label} · {p.n}</b>
                <span>{p.note}</span>
              </button>
            ))}
            <div className={`ab-format ${stepPreset === "custom" ? "on" : ""}`}>
              <b>Custom</b>
              <input
                className="input mono ab-num"
                type="number"
                min={2}
                max={40}
                value={g.maxSteps}
                onChange={(e) => setG({ maxSteps: Math.max(2, Math.min(40, Number(e.target.value) || 2)) })}
                aria-label="Custom number of actions"
              />
            </div>
          </div>
        </div>

        <div className="ab-grid2" style={{ marginTop: 16 }}>
          <label className="ab-field">
            <span className="ab-label">Runs per minute, at most</span>
            <input className="input mono" type="number" min={1} max={1000} value={g.rateLimitRpm ?? 60} onChange={(e) => setG({ rateLimitRpm: Number(e.target.value) || 1 })} />
            <span className="ab-field-note">Further runs wait until the minute is up.</span>
          </label>
          <label className="ab-field">
            <span className="ab-label">Model tokens per minute <em>— optional</em></span>
            <input
              className="input mono"
              type="number"
              min={1000}
              step={5000}
              placeholder="No limit"
              value={g.rateLimitTpm || ""}
              onChange={(e) => setG({ rateLimitTpm: e.target.value ? Number(e.target.value) : undefined })}
            />
            <span className="ab-field-note">Leave empty for no limit.</span>
          </label>
        </div>

        <div className="ab-field" style={{ marginTop: 16 }}>
          <span className="ab-label">How it behaves</span>
          <div className="ab-toggles">
            {BEHAVIOURS.map((b) => (
              <label key={b.key} className={`ab-toggle ${g[b.key] ? "on" : ""}`}>
                <span className="ab-switch small">
                  <input type="checkbox" checked={!!g[b.key]} onChange={(e) => setG({ [b.key]: e.target.checked } as any)} />
                  <span className="track" />
                </span>
                <span>
                  <b>{b.title}</b>
                  <span>{b.note}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="ab-field" style={{ marginTop: 16 }}>
          <span className="ab-label">Things it must never do <span className="ab-count">{rules.length}</span></span>
          {rules.length > 0 && (
            <ul className="ab-rules">
              {rules.map((r, i) => (
                <li key={i}>
                  <span className="ab-rule-ic"><CrossIcon size={11} /></span>
                  <span className="grow">{r}</span>
                  <button type="button" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label={`Remove rule ${r}`}>×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="ab-inline" style={{ marginTop: rules.length ? 8 : 0 }}>
            <input
              className="input"
              value={ruleDraft}
              placeholder="e.g. Never contact a customer directly — press Enter to add"
              onChange={(e) => setRuleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addRule();
                }
              }}
            />
            <button type="button" className="btn" onClick={addRule} disabled={!ruleDraft.trim()}>Add rule</button>
          </div>
        </div>
      </section>

      {/* ---- data protection ---- */}
      <section className="ab-sec">
        <header className="ab-sec-head">
          <span className="ab-sec-ic"><EyeIcon size={17} /></span>
          <div className="grow">
            <h3>Data protection</h3>
            <p>Masks personal and secret data in what is sent to the model and to actions.</p>
          </div>
          <label className="ab-switch">
            <input type="checkbox" checked={!!g.dlpEnabled} onChange={(e) => setG({ dlpEnabled: e.target.checked })} />
            <span className="track" />
            {g.dlpEnabled ? "On" : "Off"}
          </label>
        </header>

        <div className={`ab-toggles four ${g.dlpEnabled ? "" : "muted"}`}>
          {MASKS.map((m) => {
            const on = g[m.key] ?? true;
            return (
              <label key={m.key} className={`ab-toggle ${on && g.dlpEnabled ? "on" : ""}`}>
                <span className="ab-switch small">
                  <input type="checkbox" checked={on} disabled={!g.dlpEnabled} onChange={(e) => setG({ [m.key]: e.target.checked } as any)} />
                  <span className="track" />
                </span>
                <span>
                  <b>{m.title}</b>
                  <span>{m.note}</span>
                </span>
              </label>
            );
          })}
        </div>

        <div className="ab-field" style={{ marginTop: 16 }}>
          <span className="ab-label">Your own patterns <span className="ab-count">{customPatterns.length}</span></span>
          {customPatterns.length > 0 && (
            <ul className="ab-rules">
              {customPatterns.map((p, i) => (
                <li key={i}>
                  <span className="grow">
                    <b>{p.name}</b> <span className="mono dim">/{p.pattern}/ → {p.replacement}</span>
                  </span>
                  <button type="button" onClick={() => setG({ customDlpPatterns: customPatterns.filter((_, j) => j !== i) })} aria-label={`Remove ${p.name}`}>×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="ab-pattern">
            <input className="input" placeholder="Name, e.g. Employee ID" value={pattern.name} onChange={(e) => setPattern({ ...pattern, name: e.target.value })} disabled={!g.dlpEnabled} />
            <input className="input mono" placeholder="Pattern, e.g. EMP-\d{6}" value={pattern.pattern} onChange={(e) => setPattern({ ...pattern, pattern: e.target.value })} disabled={!g.dlpEnabled} />
            <input className="input mono" placeholder="Replace with, e.g. [EMP-ID]" value={pattern.replacement} onChange={(e) => setPattern({ ...pattern, replacement: e.target.value })} disabled={!g.dlpEnabled} />
            <button
              type="button"
              className="btn"
              disabled={!g.dlpEnabled || !pattern.name.trim() || !patternValid}
              onClick={() => {
                setG({ customDlpPatterns: [...customPatterns, { name: pattern.name.trim(), pattern: pattern.pattern, replacement: pattern.replacement || "[REDACTED]" }] });
                setPattern({ name: "", pattern: "", replacement: "" });
              }}
            >
              Add
            </button>
          </div>
          {pattern.pattern && !patternValid && <span className="ab-field-note warn"><AlertIcon size={12} /> That pattern is not a valid regular expression.</span>}
        </div>

        <details className="ab-try-dlp">
          <summary>Try it on sample text</summary>
          <textarea className="input mono" rows={2} value={sample} onChange={(e) => setSample(e.target.value)} />
          <div className="ab-label" style={{ marginTop: 8 }}>
            What the model sees {masked.hasRedactions ? `· ${masked.detections.length} masked` : g.dlpEnabled ? "· nothing masked" : "· protection is off"}
          </div>
          <div className="ab-skill-body mono">{masked.text}</div>
        </details>
      </section>

      {/* ---- delegation ---- */}
      <section className="ab-sec">
        <header className="ab-sec-head">
          <span className="ab-sec-ic"><LayersIcon size={17} /></span>
          <div className="grow">
            <h3>Delegation</h3>
            <p>Whether this agent can hand work to other agents. Most agents do not need it.</p>
          </div>
        </header>
        <div className="ab-choices three">
          <button type="button" className={`ab-choice ${mode === "off" ? "on" : ""}`} onClick={() => setMode("off")}>
            <span className="ic"><CrossIcon size={14} /></span>
            <span>
              <b>Works alone</b>
              <span>It does all the work itself.</span>
            </span>
          </button>
          <button type="button" className={`ab-choice ${mode === "ask" ? "on" : ""}`} onClick={() => setMode("ask")} disabled={!delegateTool}>
            <span className="ic"><ArrowRightIcon size={14} /></span>
            <span>
              <b>Can ask another agent</b>
              <span>Calls a live agent in this workspace when a task needs it.</span>
            </span>
          </button>
          <button type="button" className={`ab-choice ${mode === "team" ? "on" : ""}`} onClick={() => setMode("team")}>
            <span className="ic"><LayersIcon size={14} /></span>
            <span>
              <b>Coordinates a team</b>
              <span>Splits the work across chosen agents and combines the results.</span>
            </span>
          </button>
        </div>
        {mode === "team" && !agentId && (
          <div className="note" style={{ marginTop: 12 }}>Save the agent as a draft first, then choose the agents in its team.</div>
        )}
        {mode === "team" && agentId && (
          <div style={{ marginTop: 14 }}>
            <SwarmCanvas
              agentId={agentId}
              agentName={spec.name || "This agent"}
              initialSwarm={swarm}
              availableAgents={workspaceAgents}
              onSaved={(next) => set({ swarm: { ...next, enabled: true } })}
            />
          </div>
        )}
      </section>
    </div>
  );
}

/* ── step 6: review and publish ───────────────────────────── */

/** Actions that put a message in front of people. */
const MESSAGING_TOOLS = ["send_email", "post_message", "post_teams_message"];
const SECTION_ORDER = ["Identity", "Instructions", "Actions", "Data", "Skills", "Inputs", "Deliverable", "Trigger", "Delegation", "Guardrails"];
const SECTION_NAME: Record<string, string> = { Trigger: "Schedule", Identity: "Brief" };

function Review({
  spec,
  tools,
  connections,
  skills,
  checks,
  publishedSpec,
  publishedVer,
  isLive,
  isNew,
  hasChanges,
  retired,
  canPublish,
  note,
  setNote,
  busy,
  onFix,
  onPublish,
  onRun,
  onRehearse,
  timezone,
  lastTest,
  publishedNow,
  onRunLive,
  onOverview,
}: {
  spec: AgentSpec;
  tools: ToolInfo[];
  connections: Conn[];
  skills: SkillInfo[];
  checks: { ok: boolean; label: string; step: number }[];
  publishedSpec: AgentSpec | null;
  publishedVer: number | null;
  isLive: boolean;
  isNew: boolean;
  hasChanges: boolean;
  retired: boolean;
  canPublish: boolean;
  note: string;
  setNote: (v: string) => void;
  busy: string | null;
  onFix: (step: number) => void;
  onPublish: (note?: string) => void;
  onRun: () => void;
  onRehearse: () => void;
  timezone: string;
  /** The latest run of a draft (a try or a rehearsal), if any. */
  lastTest: AgentRun | null;
  /** Set right after this page published, for the success state. */
  publishedNow: number | null;
  onRunLive: () => void;
  onOverview: () => void;
}) {
  const [showAllChecks, setShowAllChecks] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const failing = checks.filter((c) => !c.ok);
  const nextVer = (publishedVer || 0) + 1;

  // ---- what changes since the live version, in names rather than ids ----
  const toolName = (id: string) => tools.find((t) => t.id === id)?.label ?? id;
  const connName = (id?: string) => (id ? connections.find((c) => c.id === id)?.name ?? "a connection since removed" : id);
  const triggerName = (v?: string) => (v === "schedule" ? "On a schedule" : v === "manual" ? "On demand" : v);
  const diff = publishedSpec
    ? diffSpecs(
        publishedSpec,
        spec,
        (id) => tools.find((t) => t.id === id)?.risk ?? "low",
        (id) => skills.find((k) => k.id === id)?.label || "a skill since deleted",
      )
    : null;
  const listed = (diff?.changes ?? []).map((c) => {
    if (c.section === "Actions") return { ...c, label: c.label.replace(/^(\S+)/, (id) => toolName(id)) };
    if (c.section === "Data") return { ...c, before: connName(c.before), after: connName(c.after) };
    if (c.section === "Trigger" && c.label === "How it starts") return { ...c, before: triggerName(c.before), after: triggerName(c.after) };
    return c;
  });
  // Settings the shared diff (lib/spec-diff) does not compare, so every unpublished change is shown.
  const extra: Change[] = [];
  if (publishedSpec) {
    const a = { ...emptySpec(), ...publishedSpec };
    const b = spec;
    const team = (x: AgentSpec) => (x.swarm?.enabled ? `${x.swarm.workers.length} ${x.swarm.workers.length === 1 ? "agent" : "agents"}, ${x.swarm.strategy}` : "off");
    if (stable(a.swarm) !== stable(b.swarm)) {
      extra.push({ section: "Delegation", label: "Team", before: team(a), after: team(b), kind: "changed", severity: b.swarm?.enabled && !a.swarm?.enabled ? "weakens" : "neutral" });
    }
    const ga = a.guardrails;
    const gb = b.guardrails;
    if (!!ga.dlpEnabled !== !!gb.dlpEnabled) {
      extra.push({ section: "Guardrails", label: "Data protection", before: ga.dlpEnabled ? "on" : "off", after: gb.dlpEnabled ? "on" : "off", kind: "changed", severity: gb.dlpEnabled ? "strengthens" : "weakens" });
    } else if (
      stable([ga.redactCreditCards, ga.redactEmails, ga.redactCredentials, ga.redactPhoneNumbers, ga.customDlpPatterns ?? []]) !==
      stable([gb.redactCreditCards, gb.redactEmails, gb.redactCredentials, gb.redactPhoneNumbers, gb.customDlpPatterns ?? []])
    ) {
      extra.push({ section: "Guardrails", label: "Data protection settings", kind: "changed", severity: "neutral" });
    }
    if ((ga.rateLimitRpm ?? 60) !== (gb.rateLimitRpm ?? 60) || (ga.rateLimitTpm ?? null) !== (gb.rateLimitTpm ?? null)) {
      extra.push({ section: "Guardrails", label: "Rate limit", before: `${ga.rateLimitRpm ?? 60} a minute`, after: `${gb.rateLimitRpm ?? 60} a minute`, kind: "changed", severity: (gb.rateLimitRpm ?? 60) > (ga.rateLimitRpm ?? 60) ? "weakens" : "neutral" });
    }
    if (stable(a.trigger.inputs ?? {}) !== stable(b.trigger.inputs ?? {})) {
      extra.push({ section: "Trigger", label: "Values for scheduled runs", kind: "changed", severity: "neutral" });
    }
    const fields = (x: AgentSpec) => normaliseInputs(x.inputs as any[]).map((i) => [i.label, i.type, i.required, i.options ?? [], i.accept ?? []]);
    if (!listed.some((c) => c.section === "Inputs") && stable(fields(a)) !== stable(fields(b))) {
      extra.push({ section: "Inputs", label: "Run form fields", kind: "changed", severity: "neutral" });
    }
    if (!listed.length && !extra.length && hasChanges) {
      extra.push({ section: "Identity", label: "Other settings", kind: "changed", severity: "neutral" });
    }
  }
  const changes = [...listed, ...extra];
  const weakens = changes.filter((c) => c.severity === "weakens").length;
  const bySection = SECTION_ORDER.map((sec) => ({ sec, items: changes.filter((c) => c.section === sec) })).filter((g) => g.items.length);
  // A note written from the changes, used when nobody types one.
  const suggestedNote = !publishedSpec
    ? "First published version."
    : changes
        .slice(0, 3)
        .map((c) => `${c.label}${c.after && c.kind !== "removed" && c.after.length < 40 ? `: ${c.after}` : ""}`)
        .join("; ") + (changes.length > 3 ? `; and ${changes.length - 3} more` : "");

  // ---- worth a look: real signals that do not block publishing ----
  const inputs = normaliseInputs(spec.inputs as any[]);
  const standing = spec.trigger.inputs || {};
  const scheduled = spec.trigger.type === "schedule";
  const looks: { text: string; step: number }[] = [];
  const emptyRequired = scheduled ? inputs.filter((i) => i.required && !(standing[i.key] ?? "").trim()) : [];
  if (emptyRequired.length) {
    looks.push({ text: `Scheduled runs have no value for ${emptyRequired.map((i) => i.label || i.key).join(", ")}.`, step: 4 });
  }
  if (inputs.some((i) => i.type === "file") && !spec.tools.some((t) => t.id === "read_document")) {
    looks.push({ text: "It asks for a file but cannot read documents: grant “Read an uploaded document”.", step: 3 });
  }
  const messaging = spec.tools.filter((t) => MESSAGING_TOOLS.includes(t.id));
  if (messaging.length && !spec.guardrails.dlpEnabled) {
    looks.push({ text: `It can send messages (${messaging.map((t) => toolName(t.id)).join(", ")}) while data protection is off.`, step: 3 });
  }
  if (!isNew && !lastTest) looks.push({ text: "The draft has not been tried yet. A rehearsal is a safe first run.", step: REVIEW });

  // ---- summary rows ----
  const sources = spec.sources.map((s) => connections.find((c) => c.id === s.connectionId)?.name || s.label || "A connection");
  const skillNames = specSkillIds(spec).map((id) => {
    const k = skills.find((x) => x.id === id);
    return k ? `${k.label}${k.status === "retired" ? " (retired)" : ""}` : "A skill since deleted";
  });
  const granted = spec.tools.map((t) => `${toolName(t.id)}${t.gate === "approval" ? " (approval)" : ""}`);
  const plan = scheduled ? planFrom(spec.trigger.schedule || "", timezone) : null;
  const delegation = spec.swarm?.enabled
    ? `Coordinates ${spec.swarm.workers.length} ${spec.swarm.workers.length === 1 ? "agent" : "agents"}`
    : spec.tools.some((t) => t.id === "invoke_agent")
      ? "Can ask another agent"
      : "Works alone";
  const none = <span className="dim">None</span>;
  const rows: { k: string; icon: React.ReactNode; step: number; v: React.ReactNode }[] = [
    { k: "Purpose", icon: <DocIcon size={15} />, step: 0, v: spec.purpose || <span className="dim">Not written</span> },
    {
      k: "Instructions",
      icon: <ListIcon size={15} />,
      step: 1,
      v: spec.steps.length ? (
        <>
          {spec.steps.length} {spec.steps.length === 1 ? "step" : "steps"}{" "}
          <button type="button" className="ab-edit" onClick={() => setShowSteps((v) => !v)}>{showSteps ? "hide" : "show"}</button>
          {showSteps && <ol className="ab-sheet-steps">{spec.steps.map((s, i) => <li key={i}>{s || <span className="dim">Empty step</span>}</li>)}</ol>}
        </>
      ) : none,
    },
    { k: "Model", icon: <SparkIcon size={15} />, step: 0, v: `${ENGINE_NAMES[engineOfSpec(spec)]}${spec.model ? ` · ${spec.model}` : ""}` },
    { k: "Deliverable", icon: <DocIcon size={15} />, step: 1, v: spec.output.format || <span className="dim">Not set</span> },
    { k: "Skills", icon: <BookIcon size={15} />, step: 1, v: skillNames.length ? skillNames.join(" · ") : none },
    {
      k: "Data",
      icon: <PlugIcon size={15} />,
      step: 2,
      v: sources.length || inputs.length
        ? [sources.join(" · "), inputs.length ? `${inputs.length} run ${inputs.length === 1 ? "input" : "inputs"}` : ""].filter(Boolean).join(" · ")
        : none,
    },
    { k: "Actions", icon: <WrenchIcon size={15} />, step: 3, v: granted.length ? granted.join(" · ") : none },
    { k: "Delegation", icon: <LayersIcon size={15} />, step: 3, v: delegation },
    {
      k: "Schedule",
      icon: <ClockIcon size={15} />,
      step: 4,
      v: scheduled ? (plan?.description ? plan.description : <span className="dim">Not a schedule it can run</span>) : "On demand",
    },
  ];

  const ready = failing.length === 0;
  const upToDate = isLive && !hasChanges;

  return (
    <div className="ab-ins">
      <h2 className="ab-h">Review and publish</h2>
      <p className="ab-lead">Check it, try the draft, then publish it so it runs for everyone.</p>

      {/* ---- ready? ---- */}
      <section className={`ab-ready ${ready ? "ok" : "bad"}`}>
        <span className="ab-ready-ic">{ready ? <CheckIcon size={20} /> : <AlertIcon size={20} />}</span>
        <div className="grow">
          <b>
            {ready
              ? upToDate
                ? `Live as v${publishedVer}, and this draft matches it`
                : "Ready to publish"
              : `${failing.length} ${failing.length === 1 ? "thing" : "things"} to fix before publishing`}
          </b>
          <span>
            {ready ? `All ${checks.length} checks pass.` : `${checks.length - failing.length} of ${checks.length} checks pass.`}{" "}
            <button type="button" className="ab-edit" onClick={() => setShowAllChecks((v) => !v)}>
              {showAllChecks ? "Hide checks" : "Show all checks"}
            </button>
          </span>
        </div>
      </section>
      {(showAllChecks || !ready) && (
        <ul className="ab-checks" style={{ marginTop: 10 }}>
          {(showAllChecks ? checks : failing).map((c) => (
            <li key={c.label} className={`ab-check ${c.ok ? "ok" : "bad"}`}>
              <span className="ic">{c.ok ? <CheckIcon size={13} /> : <CrossIcon size={12} />}</span>
              <span className="txt">{c.label}</span>
              {!c.ok && (
                <button className="fix" onClick={() => onFix(c.step)}>
                  Fix in {STEPS[c.step]} <ArrowRightIcon size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {looks.length > 0 && (
        <div className="ab-looks">
          <span className="ab-label" style={{ margin: 0 }}>Worth a look <em>— these do not stop publishing</em></span>
          {looks.map((l) => (
            <div key={l.text} className="ab-look">
              <AlertIcon size={13} />
              <span className="grow">{l.text}</span>
              {l.step !== REVIEW && (
                <button type="button" className="ab-edit" onClick={() => onFix(l.step)}>
                  Open {STEPS[l.step]}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ---- what changes ---- */}
      {publishedSpec && changes.length > 0 && (
        <section className="ab-sec" style={{ marginTop: 16 }}>
          <header className="ab-sec-head">
            <span className="ab-sec-ic"><LayersIcon size={17} /></span>
            <div className="grow">
              <h3>What changes from v{publishedVer}</h3>
              <p>What people will get once this draft is published.</p>
            </div>
            <span className={`ab-pill ${weakens ? "warn" : ""}`}>
              {changes.length} {changes.length === 1 ? "change" : "changes"}
              {weakens ? ` · ${weakens} ${weakens === 1 ? "loosens" : "loosen"} control` : ""}
            </span>
          </header>
          <div className="ab-changes">
            {bySection.map((g) => (
              <div key={g.sec} className="ab-change-group">
                <div className="ab-change-sec">{SECTION_NAME[g.sec] ?? g.sec}</div>
                <ul>
                  {g.items.map((c, i) => (
                    <li key={i} className={`ab-change ${c.kind}`}>
                      <span className="sign">{c.kind === "added" ? "+" : c.kind === "removed" ? "−" : "~"}</span>
                      <span className="grow">
                        <b>{c.label}</b>
                        {c.kind === "changed" && c.before != null && c.after != null ? (
                          <span className="vals">
                            <s>{c.before}</s> → {c.after}
                          </span>
                        ) : c.kind === "added" && c.after ? (
                          <span className="vals">{c.after}</span>
                        ) : c.kind === "removed" && c.before ? (
                          <span className="vals"><s>{c.before}</s></span>
                        ) : null}
                      </span>
                      {c.severity === "weakens" && <span className="ab-weak">loosens control</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- summary ---- */}
      <section className="ab-sec" style={{ marginTop: 16 }}>
        <header className="ab-sec-head">
          <span className="ab-sec-ic"><FormIcon size={17} /></span>
          <div className="grow">
            <h3>Summary</h3>
            <p>The agent at a glance. Edit takes you to the step.</p>
          </div>
        </header>
        <div className="ab-sheet">
          {rows.map((r) => (
            <div key={r.k} className="ab-sheet-row">
              <span className="k"><span className="ic">{r.icon}</span>{r.k}</span>
              <span className="v">{r.v}</span>
              <button type="button" className="ab-edit" onClick={() => onFix(r.step)}>Edit</button>
            </div>
          ))}
        </div>
      </section>

      {/* ---- try and publish ---- */}
      <section className="ab-sec" style={{ marginTop: 16 }}>
        {publishedNow ? (
          <div className="ab-done">
            <span className="ab-ready-ic"><CheckIcon size={22} /></span>
            <div className="grow">
              <b>v{publishedNow} is live</b>
              <span>
                Everyone in the workspace now gets this version
                {plan?.next ? `; its first scheduled run is ${formatWhen(plan.next, timezone)}` : ""}.
              </span>
            </div>
            <button type="button" className="btn" onClick={onOverview}>Open overview</button>
            <button type="button" className="btn btn-primary" onClick={onRunLive}>
              <RunIcon size={13} /> Run it now
            </button>
          </div>
        ) : (
          <div className="ab-ship">
            <div className="ab-ship-try">
              <span className="ab-label">Try the draft</span>
              <div className="ab-row">
                <button className="btn" onClick={onRehearse} disabled={isNew || retired || !spec.steps.length} title="Runs it end to end, describing approval-gated actions instead of doing them">
                  <ShieldIcon size={13} /> Rehearse safely
                </button>
                <button className="btn" onClick={onRun} disabled={isNew || retired || !spec.steps.length} title="Runs the draft against your live systems; gated actions still wait for approval">
                  <RunIcon size={13} /> Run the draft
                </button>
              </div>
              <span className="sub-line" style={{ marginTop: 8, display: "block" }}>
                {isNew ? (
                  "Save the agent as a draft first to try it."
                ) : lastTest ? (
                  <>
                    Last tried {formatWhen(lastTest.started_at, timezone)} · {lastTest.dry_run ? "rehearsal" : "real run"} ·{" "}
                    <span className={`ab-state ${(RUN_STATE[lastTest.status] ?? { cls: "" }).cls}`}>{(RUN_STATE[lastTest.status] ?? { label: lastTest.status }).label}</span>{" "}
                    · <Link href={`/runs/${lastTest.id}`}>open</Link>
                  </>
                ) : (
                  "Not tried yet."
                )}
              </span>
            </div>

            <div className="ab-ship-pub">
              <span className="ab-label">{upToDate ? `v${publishedVer} is live` : `Publish as v${nextVer}`}</span>
              {!canPublish ? (
                <p className="sub-line" style={{ margin: 0 }}>
                  Only the workspace owner and admins can publish. Your changes are saved for one of them to publish.
                </p>
              ) : retired ? (
                <p className="sub-line" style={{ margin: 0 }}>Restore the agent before publishing.</p>
              ) : upToDate ? (
                <p className="sub-line" style={{ margin: 0 }}>Nothing to publish: change something in the steps above and it can go out as a new version.</p>
              ) : (
                <>
                  <input
                    className="input"
                    value={note}
                    maxLength={200}
                    placeholder={suggestedNote || "What changed?"}
                    onChange={(e) => setNote(e.target.value)}
                    aria-label="What changed in this version"
                  />
                  <span className="sub-line" style={{ display: "block", margin: "6px 0 10px" }}>
                    {note.trim() ? "Shown in version history." : "Leave empty to use the note above, written from the changes."}
                    {plan?.next ? ` First scheduled run after publishing: ${formatWhen(plan.next, timezone)}.` : ""}
                  </span>
                </>
              )}
              <button
                className="btn btn-primary ab-ship-btn"
                onClick={() => onPublish(note.trim() || suggestedNote)}
                disabled={!canPublish || retired || !ready || busy === "publish" || upToDate}
              >
                {busy === "publish" && <span className="spin" />}
                {upToDate ? "Published" : `Publish v${nextVer}`}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
