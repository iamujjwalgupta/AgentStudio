"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AgentSpec } from "@/lib/types";
import GuardrailsConfigCard from "./GuardrailsConfigCard";

interface TriggerConfigPanelProps {
  spec: AgentSpec;
  set: (p: Partial<AgentSpec>) => void;
  agentId: string;
  agentName?: string;
  timezone?: string;
  agentStatus?: string;
}

const SCHEDULE_PRESETS = [
  { label: "Every weekday at 8:00 AM", val: "weekdays at 8:00am", cron: "0 8 * * 1-5" },
  { label: "Every Monday at 9:00 AM", val: "every monday at 9:00am", cron: "0 9 * * 1" },
  { label: "Daily at midnight", val: "daily at 12:00am", cron: "0 0 * * *" },
  { label: "Every 2 hours", val: "every 2 hours", cron: "0 */2 * * *" },
];

export default function TriggerConfigPanel({
  spec,
  set,
  agentId,
  agentName = "Agent",
  timezone = "UTC",
  agentStatus = "draft",
}: TriggerConfigPanelProps) {
  const router = useRouter();

  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [armed, setArmed] = useState(true);
  const [nextRunAt, setNextRunAt] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [pastRuns, setPastRuns] = useState<any[]>([]);
  const [runningNow, setRunningNow] = useState(false);
  const [testRunMsg, setTestRunMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [copiedCurl, setCopiedCurl] = useState(false);

  // Fetch operational schedule status from server when trigger is on schedule
  useEffect(() => {
    let active = true;
    if (spec.trigger.type === "schedule" && agentId) {
      setLoadingSchedule(true);
      fetch(`/api/agents/${agentId}/schedule`)
        .then((res) => res.json())
        .then((data) => {
          if (active && data.ok) {
            setArmed(data.armed ?? true);
            setNextRunAt(data.nextRunAt);
            setDescription(data.description || "");
            setPastRuns(data.pastScheduledRuns || []);
          }
        })
        .catch((err) => console.warn("Could not load schedule telemetry:", err))
        .finally(() => {
          if (active) setLoadingSchedule(false);
        });
    }
    return () => {
      active = false;
    };
  }, [spec.trigger.type, agentId]);

  // Handle armed/paused toggle
  const handleToggleArmed = async (newArmed: boolean) => {
    setArmed(newArmed);
    try {
      await fetch(`/api/agents/${agentId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedule: spec.trigger.schedule || "weekdays at 8:00am",
          armed: newArmed,
          standingInput: spec.trigger.input || "",
        }),
      });
    } catch (err) {
      console.warn("Failed to persist armed state:", err);
    }
  };

  // Immediate test run of the scheduled agent task
  const handleRunNow = async () => {
    setRunningNow(true);
    setTestRunMsg(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "run-now",
          standingInput: spec.trigger.input || `Scheduled test execution for ${agentName}`,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to trigger scheduled run");
      router.push(`/runs/${j.runId}`);
    } catch (err: any) {
      setTestRunMsg({ kind: "err", text: err.message || "Failed to run scheduled job" });
      setRunningNow(false);
    }
  };

  const handleCopyCurl = () => {
    const curl = `curl -X POST http://localhost:3000/api/v1/agents/${agentId}/run \\\n  -H "Content-Type: application/json" \\\n  -d '{"input": "Your prompt instruction here"}'`;
    navigator.clipboard.writeText(curl);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  const currentSchedule = spec.trigger.schedule || "";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <h2>When it runs and how far it can go</h2>
          <p className="sub-line" style={{ marginTop: 2, marginBottom: 16 }}>
            Define how and when this agent is invoked — on demand, on a recurring cron cadence, or reactively on events.
          </p>
        </div>

        {spec.trigger.type === "schedule" && (
          <div className="sched-armed-toggle-wrap" style={{ marginTop: 4 }}>
            <label className="sched-toggle-label" title="Enable or pause automated unattended executions">
              <span style={{ fontSize: 13, fontWeight: 600, color: armed ? "#15803d" : "#64748b" }}>
                {armed ? "● Schedule Armed" : "○ Schedule Paused"}
              </span>
              <input
                type="checkbox"
                checked={armed}
                onChange={(e) => handleToggleArmed(e.target.checked)}
              />
              <span className="sched-slider" />
            </label>
          </div>
        )}
      </div>

      {testRunMsg && (
        <div className={testRunMsg.kind === "ok" ? "ok-note" : "error"} style={{ marginBottom: 16 }}>
          {testRunMsg.text}
        </div>
      )}

      {/* Primary Trigger Type Selection */}
      <div className="radios">
        {[
          { id: "manual", label: "When I ask (On Demand)", note: "Manual runs from Canvas, Playground, or REST API" },
          { id: "schedule", label: "On a schedule (Recurring Cron)", note: "Unattended execution on a calendar cadence" },
          { id: "event", label: "When a condition is met (Event)", note: "Watches for webhooks or external metric thresholds" },
        ].map((o) => (
          <button
            key={o.id}
            type="button"
            className={`radio ${spec.trigger.type === o.id ? "on" : ""}`}
            onClick={() => set({ trigger: { ...spec.trigger, type: o.id as any } })}
          >
            <div className="tool-label">{o.label}</div>
            <div className="sub-line">{o.note}</div>
          </button>
        ))}
      </div>

      {/* Mode 1: Manual / On-Demand Execution Information */}
      {spec.trigger.type === "manual" && (
        <div
          style={{
            marginTop: 18,
            padding: "16px 20px",
            background: "rgba(0, 51, 141, 0.04)",
            border: "1px solid rgba(0, 51, 141, 0.12)",
            borderRadius: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 18 }}>🖱️</span>
            <span style={{ fontWeight: 600, color: "var(--ink, #00338d)" }}>On-Demand & Interactive Execution</span>
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted, #516a92)", lineHeight: 1.5 }}>
            This agent runs interactively whenever you click <strong>Run</strong> in the Studio, ask questions in the <strong>Live Playground</strong>, operate inside the <strong>Canvas Viewer</strong>, or invoke it via REST API.
          </p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#091a38", padding: "10px 14px", borderRadius: 6 }}>
            <code className="mono" style={{ fontSize: 12, color: "#94bce3" }}>
              POST /api/v1/agents/{agentId}/run
            </code>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: "4px 8px", color: "#fff" }}
              onClick={handleCopyCurl}
            >
              {copiedCurl ? "✓ Copied Curl" : "Copy cURL"}
            </button>
          </div>
        </div>
      )}

      {/* Mode 2: Full Merged Cron Schedule Dashboard */}
      {spec.trigger.type === "schedule" && (
        <div style={{ marginTop: 18 }}>
          {/* Countdown & Next Run Card */}
          <div className={`sched-countdown-card ${armed ? "active" : "paused"}`}>
            <div className="sched-countdown-icon">⏰</div>
            <div className="sched-countdown-info">
              <div className="sched-countdown-headline">
                {armed
                  ? nextRunAt
                    ? `Next scheduled run: ${new Date(nextRunAt).toLocaleString([], {
                        weekday: "long",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })} (${timezone})`
                    : "Schedule active · calculating next cycle"
                  : "Schedule is currently paused. Toggle 'Schedule Armed' above to resume automatic runs."}
              </div>
              <div className="sched-countdown-sub">
                {description || currentSchedule || "Recurring schedule"} · Published version executes unattended
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }}
              onClick={handleRunNow}
              disabled={runningNow}
              title="Execute a test run with the standing input immediately"
            >
              <span>{runningNow ? "Launching…" : "⚡ Test Run Now"}</span>
            </button>
          </div>

          {/* Cadence Presets */}
          <div style={{ marginBottom: 14 }}>
            <span className="eyebrow" style={{ display: "block", marginBottom: 8 }}>Cadence Presets</span>
            <div className="sched-presets-row">
              {SCHEDULE_PRESETS.map((p) => {
                const isActive = currentSchedule.toLowerCase().trim() === p.val.toLowerCase().trim();
                return (
                  <button
                    key={p.val}
                    type="button"
                    className={`sched-preset-btn ${isActive ? "active" : ""}`}
                    onClick={() => set({ trigger: { ...spec.trigger, schedule: p.val } })}
                  >
                    <div style={{ fontWeight: 600 }}>{p.label}</div>
                    <div className="mono" style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{p.cron}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Schedule Expression Input */}
          <label className="field mt">
            <span className="eyebrow">Schedule Expression / Cron Cadence</span>
            <input
              className="input mono"
              placeholder="e.g. weekdays at 8:00am, every monday at 9:00am, 0 8 * * 1-5"
              value={spec.trigger.schedule || ""}
              onChange={(e) => set({ trigger: { ...spec.trigger, schedule: e.target.value } })}
            />
            <span className="help" style={{ marginTop: 4 }}>
              Supports plain English schedules (<em>"weekdays at 8:00am"</em>) or standard 5-part cron syntax (<em>"0 8 * * 1-5"</em>). Executes in workspace timezone: <strong>{timezone}</strong>.
            </span>
          </label>

          {/* Standing Directive / Unattended Input */}
          <label className="field mt">
            <span className="eyebrow">Standing Directive (Unattended Run Prompt)</span>
            <textarea
              className="textarea"
              rows={3}
              placeholder="What the agent should do each time it executes on its own schedule..."
              value={spec.trigger.input || ""}
              onChange={(e) => set({ trigger: { ...spec.trigger, input: e.target.value } })}
            />
            <span className="help" style={{ marginTop: 6 }}>
              {spec.inputs.length > 0 ? (
                <span style={{ color: "var(--amber, #d97706)" }}>
                  ⚠️ This agent defines {spec.inputs.length} input parameter{spec.inputs.length === 1 ? "" : "s"} ({spec.inputs.map((i) => i.label).join(", ")}). Because nobody is at the keyboard during scheduled runs, provide the default values or instructions here.
                </span>
              ) : (
                "Since nobody is at the keyboard during scheduled executions, this standing prompt is automatically passed as the run goal."
              )}
            </span>
          </label>

          {/* Recent Scheduled Runs History */}
          <div style={{ marginTop: 22 }}>
            <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 600, color: "var(--ink, #00338d)" }}>
              Scheduled Execution History {pastRuns.length > 0 ? `(${pastRuns.length})` : ""}
            </h4>

            {loadingSchedule ? (
              <div className="sched-loading">Loading execution history…</div>
            ) : pastRuns.length === 0 ? (
              <div
                style={{
                  padding: "16px",
                  background: "rgba(0, 0, 0, 0.02)",
                  border: "1px dashed rgba(0, 0, 0, 0.12)",
                  borderRadius: 6,
                  textAlign: "center",
                  fontSize: 13,
                  color: "#64748b",
                }}
              >
                No scheduled runs have executed yet. Click <strong>"⚡ Test Run Now"</strong> above to test immediately.
              </div>
            ) : (
              <div className="webhook-table-wrap">
                <table className="webhook-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Run ID</th>
                      <th>Triggered At</th>
                      <th style={{ textAlign: "right" }}>Cost</th>
                      <th style={{ textAlign: "right" }}>Trace</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastRuns.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <span
                            className="webhook-status-badge"
                            style={{
                              background: r.status === "completed" ? "rgba(34, 197, 94, 0.12)" : "rgba(245, 158, 11, 0.12)",
                              color: r.status === "completed" ? "#15803d" : "#b45309",
                            }}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {r.id.slice(0, 8)}…
                        </td>
                        <td style={{ fontSize: 12, color: "#64748b" }}>
                          {new Date(r.started_at).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td style={{ textAlign: "right", fontSize: 12 }} className="mono">
                          {r.cost_cents ? `$${(r.cost_cents / 100).toFixed(3)}` : "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <Link href={`/runs/${r.id}`} className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }}>
                            View Trace ↗
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mode 3: Event & Webhook Trigger */}
      {spec.trigger.type === "event" && (
        <div style={{ marginTop: 18 }}>
          <label className="field">
            <span className="eyebrow">Triggering Condition</span>
            <input
              className="input"
              placeholder="e.g. Open tickets older than 7 days exceed 20, or inbound webhook event payload"
              value={spec.trigger.condition || ""}
              onChange={(e) => set({ trigger: { ...spec.trigger, condition: e.target.value } })}
            />
            <span className="help" style={{ marginTop: 4 }}>
              The operational threshold or condition that causes an automated run to be launched.
            </span>
          </label>

          <div
            style={{
              marginTop: 12,
              padding: "14px 18px",
              background: "rgba(0, 51, 141, 0.04)",
              border: "1px solid rgba(0, 51, 141, 0.1)",
              borderRadius: 8,
              fontSize: 12.5,
              color: "var(--muted, #516a92)",
            }}
          >
            💡 Inbound webhooks from GitHub, Slack, and Stripe can be configured under <strong>Connections</strong> to emit events that trigger this agent automatically.
          </div>
        </div>
      )}

      {/* Execution Guardrails & Tool Call Budgets */}
      <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid rgba(0, 51, 141, 0.1)" }}>
        <h3 style={{ fontSize: 15, fontWeight: 650, color: "var(--ink, #00338d)", marginBottom: 12 }}>
          Execution Guardrails & Safety Limits
        </h3>

        <div className="grid2">
          <label className="field">
            <span className="eyebrow">Tool call budget per run</span>
            <input
              className="input mono"
              type="number"
              min={2}
              max={40}
              value={spec.guardrails.maxSteps}
              onChange={(e) => set({ guardrails: { ...spec.guardrails, maxSteps: Number(e.target.value) } })}
            />
            <span className="help" style={{ marginTop: 4 }}>
              Maximum autonomous tool steps permitted before forcing a resolution or handoff.
            </span>
          </label>

          <label className="field">
            <span className="eyebrow">Anything it must never do</span>
            <input
              className="input"
              placeholder="e.g. Never contact a customer directly, Never issue refunds over $500"
              value={spec.guardrails.extra}
              onChange={(e) => set({ guardrails: { ...spec.guardrails, extra: e.target.value } })}
            />
            <span className="help" style={{ marginTop: 4 }}>
              Hard constraints strictly injected into the system prompt.
            </span>
          </label>
        </div>

        <div className="stack mt">
          {[
            ["requireCitations", "Cite the source of every figure, record, or claim"],
            ["stayInScope", "Refuse work outside the instructions and brief above"],
            ["escalateOnAmbiguity", "Say what is missing rather than guessing on incomplete inputs"],
          ].map(([k, label]) => (
            <label key={k} className="row" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={(spec.guardrails as any)[k]}
                onChange={(e) =>
                  set({
                    guardrails: { ...spec.guardrails, [k]: e.target.checked },
                  })
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <div style={{ marginTop: 24 }}>
          <GuardrailsConfigCard
            spec={spec}
            onChange={(patch) => set({ guardrails: { ...spec.guardrails, ...patch } })}
          />
        </div>
      </div>
    </div>
  );
}
