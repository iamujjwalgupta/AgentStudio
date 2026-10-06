"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { emptySpec, type AgentSpec } from "@/lib/types";
import Builder, { type EngineInfo } from "@/components/Builder";
import { SaveDraftDialog, useLeaveGuard } from "@/components/LeaveGuard";
import { ArrowLeftIcon, SparkIcon, parseDomain, processColour } from "@/components/agent-ui";
import type { SkillUsageRow, TaxonomyRow } from "@/lib/agent-list";

export type Template = { name: string; brief: string; domain: string | null; process: string };

/** What the builder needs to know about the workspace, loaded by the page. */
export type BuilderContext = {
  tools: { id: string; label: string; description: string; risk: "low" | "medium" | "high"; needs: string | null }[];
  connections: { id: string; name: string; kind: string; config: any }[];
  skills: { id: string; name: string; label: string; description: string; instructions?: string; status?: string }[];
  workspaceAgents: { id: string; name: string; description: string; archetype: string }[];
  timezone: string;
  canPublish: boolean;
  taxonomy: TaxonomyRow[];
  skillUsage: SkillUsageRow[];
  engines: EngineInfo[];
};

const EXAMPLES = [
  "Every Monday, pull last week's support tickets from our Postgres database, group them by theme, and post the top five recurring issues to Slack with counts.",
  "Research a company I name: search the web for their recent announcements, funding and leadership changes, then write a one-page briefing as a markdown file.",
  "Read the uploaded vendor contract, compare its payment and termination terms against our standard positions, and email me a summary of anything that deviates.",
];

const PHASES = ["Reading the brief", "Matching your connections", "Choosing actions and risk levels", "Writing the steps"];

const NO_RUNS = { completed: 0, failed: 0, awaiting: 0, running: 0, costUsd: 0, avgMs: null };

/**
 * Creating an agent. First a brief, then the full builder, all in this page and
 * unsaved: the agent is only written when the person saves it as a draft or
 * publishes it, and leaving asks whether to keep it.
 */
export default function NewAgentStart({ templates, ctx }: { templates: Template[]; ctx: BuilderContext }) {
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState<"" | "draft">("");
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [proc, setProc] = useState("");
  const [started, setStarted] = useState<{ spec: AgentSpec; step: number } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // Before the builder opens, only a typed brief is worth asking about.
  const guard = useLeaveGuard(!started && !!brief.trim());
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveErr, setLeaveErr] = useState("");

  const processes = [...new Set(templates.map((t) => t.process))];
  // "All" shows one per process for variety; a chosen process shows all of its own.
  const shown = proc
    ? templates.filter((t) => t.process === proc)
    : processes.map((p) => templates.find((t) => t.process === p)!).slice(0, 9);

  async function draft() {
    setBusy("draft");
    setError("");
    let i = 0;
    setPhase(PHASES[0]);
    const tick = setInterval(() => setPhase(PHASES[(i = Math.min(i + 1, PHASES.length - 1))]), 1500);
    try {
      const res = await fetch("/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The brief could not be drafted.");
      setStarted({ spec: { ...emptySpec(), ...data.spec, brief }, step: 1 });
    } catch (e: any) {
      setError(e.message);
    } finally {
      clearInterval(tick);
      setBusy("");
    }
  }

  async function leaveSaving() {
    if (!guard.to) return;
    setLeaveBusy(true);
    setLeaveErr("");
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: { ...emptySpec(), brief } }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The agent could not be saved.");
      guard.release();
      router.push(guard.to);
    } catch (e: any) {
      setLeaveErr(e.message);
      setLeaveBusy(false);
    }
  }

  function use(text: string) {
    setBrief(text);
    box.current?.focus();
    box.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  if (started) {
    return (
      <Builder
        agentId={null}
        initialSpec={started.spec}
        initialStep={started.step}
        status="draft"
        publishedVer={null}
        versions={[]}
        runs={[]}
        publishedSpec={null}
        canDelete={false}
        meta={{ ownerName: null, createdAt: null, nextRunAt: null, scheduleCaveat: "", pendingApprovals: 0, runCount: 0, runStats: NO_RUNS }}
        {...ctx}
      />
    );
  }

  return (
    <div className="page">
      <div className="ab-new">
        <Link href="/agents" className="ab-back">
          <ArrowLeftIcon size={13} /> Agents
        </Link>

        <div className="ab-new-box">
          <h1>What should this agent do?</h1>
          <p className="ab-lead">
            Describe the work the way you would explain it to a new colleague: the systems involved, the rules, and what you
            want at the end. It is drafted into steps, data and actions that you review. Nothing is saved until you choose to.
          </p>
          <textarea
            ref={box}
            className="textarea"
            rows={7}
            autoFocus
            placeholder="e.g. Every Monday, reconcile last week's collections against open invoices, flag anything unmatched over 30 days, and email the summary to the AR lead."
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            disabled={!!busy}
          />
          {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
          <div className="ab-new-actions">
            <div className="ab-row">
              <button className="btn btn-primary" onClick={draft} disabled={!!busy || !brief.trim()}>
                {busy === "draft" ? <span className="spin" /> : <SparkIcon size={13} />}
                {busy === "draft" ? "Drafting…" : "Draft this agent"}
              </button>
              {busy === "draft" && <span className="ab-phase">{phase}</span>}
            </div>
            <button className="btn btn-ghost" onClick={() => setStarted({ spec: { ...emptySpec(), brief }, step: 0 })} disabled={!!busy}>
              Start blank and build it step by step
            </button>
          </div>
        </div>

        <div className="ab-tpl-head">
          <h2>{templates.length ? "Start from a live agent's brief" : "Or start from an example"}</h2>
          {processes.length > 1 && (
            <div className="ab-row" style={{ gap: 6 }}>
              <button className={`chip ${!proc ? "on" : ""}`} onClick={() => setProc("")}>All</button>
              {processes.slice(0, 8).map((p) => (
                <button key={p} className={`chip ${proc === p ? "on" : ""}`} onClick={() => setProc(p)}>{p}</button>
              ))}
            </div>
          )}
        </div>
        <div className="ab-tpl-grid">
          {templates.length
            ? shown.map((t, i) => {
                const d = parseDomain(t.domain);
                return (
                  <button key={`${t.name}-${i}`} className="ab-tpl" style={{ ["--pc" as any]: processColour(t.process) }} onClick={() => use(t.brief)}>
                    <b>{t.name}</b>
                    <span>{t.brief}</span>
                    <em className="sub-line" style={{ fontStyle: "normal" }}>
                      {[d.industry, t.process].filter(Boolean).join(" · ")}
                    </em>
                  </button>
                );
              })
            : EXAMPLES.map((b, i) => (
                <button key={i} className="ab-tpl" onClick={() => use(b)}>
                  <span style={{ WebkitLineClamp: 5 }}>{b}</span>
                </button>
              ))}
        </div>
        <p className="sub-line" style={{ marginTop: 10 }}>Choosing one copies its brief into the box above for you to edit. The original agent is not changed.</p>
      </div>

      {guard.to && (
        <SaveDraftDialog
          busy={leaveBusy}
          error={leaveErr}
          onSave={leaveSaving}
          onDiscard={() => {
            guard.release();
            router.push(guard.to!);
          }}
          onCancel={() => {
            setLeaveErr("");
            guard.cancel();
          }}
        />
      )}
    </div>
  );
}
