"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Props {
  agentId: string;
  agentName: string;
  timezone?: string;
}

const PRESETS = [
  { label: "Every weekday at 8:00 AM", val: "weekdays at 8:00am", cron: "0 8 * * 1-5" },
  { label: "Every Monday at 9:00 AM", val: "every monday at 9:00am", cron: "0 9 * * 1" },
  { label: "Daily at midnight", val: "daily at 12:00am", cron: "0 0 * * *" },
  { label: "Every 2 hours", val: "every 2 hours", cron: "0 */2 * * *" },
];

export default function ScheduleConfigView({ agentId, agentName, timezone = "UTC" }: Props) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [armed, setArmed] = useState(true);
  const [scheduleText, setScheduleText] = useState("weekdays at 8:00am");
  const [standingInput, setStandingInput] = useState(
    "Query PostgreSQL for reconciling records, compile financial reconciliation summary, and post to Slack."
  );
  const [nextRunAt, setNextRunAt] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [pastRuns, setPastRuns] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function loadSchedule() {
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/schedule`);
      const j = await res.json();
      if (res.ok) {
        setArmed(j.armed ?? true);
        if (j.schedule) setScheduleText(j.schedule);
        if (j.standingInput) setStandingInput(j.standingInput);
        setNextRunAt(j.nextRunAt);
        setDescription(j.description || "");
        setPastRuns(j.pastScheduledRuns || []);
      }
    } catch (err: any) {
      setMsg({ kind: "err", text: err.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSchedule();
  }, [agentId]);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedule: scheduleText,
          armed,
          standingInput,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to save schedule");
      setMsg({ kind: "ok", text: "Recurring schedule armed and saved." });
      loadSchedule();
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    setRunningNow(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "run-now",
          standingInput,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to run scheduled job");
      router.push(`/runs/${j.runId}`);
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message });
      setRunningNow(false);
    }
  }

  return (
    <div className="sched-config-container">
      {/* Top Header */}
      <div className="sched-header">
        <div>
          <h3 className="sched-title">Scheduled & Recurring Agent Jobs (Cron Triggers)</h3>
          <p className="sched-subtitle">
            Configure unattended execution cadences in workspace timezone ({timezone})
          </p>
        </div>

        <div className="sched-armed-toggle-wrap">
          <label className="sched-toggle-label">
            <span style={{ fontSize: 13, fontWeight: 600, color: armed ? "#15803d" : "#64748b" }}>
              {armed ? "● Schedule Armed" : "○ Schedule Paused"}
            </span>
            <input
              type="checkbox"
              checked={armed}
              onChange={(e) => setArmed(e.target.checked)}
            />
            <span className="sched-slider" />
          </label>
        </div>
      </div>

      {msg && (
        <div className={msg.kind === "ok" ? "ok-note" : "error"} style={{ marginBottom: 16 }}>
          {msg.text}
        </div>
      )}

      {/* Countdown / Next Run Banner */}
      <div className={`sched-countdown-card ${armed ? "active" : "paused"}`}>
        <div className="sched-countdown-icon">⏰</div>
        <div className="sched-countdown-info">
          <div className="sched-countdown-headline">
            {armed
              ? nextRunAt
                ? `Next scheduled run: ${new Date(nextRunAt).toLocaleString([], {
                    weekday: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                    month: "short",
                    day: "numeric",
                  })}`
                : "Schedule active · calculating next cycle"
              : "Schedule is currently paused. Toggle 'Armed' above to resume automatic runs."}
          </div>
          <div className="sched-countdown-sub">
            {description || scheduleText}
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }}
          onClick={handleRunNow}
          disabled={runningNow}
        >
          <span>{runningNow ? "Launching…" : "⚡ Run Schedule Now"}</span>
        </button>
      </div>

      {/* Cadence Presets & Input */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <h4 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 600 }}>Execution Cadence</h4>

        <div className="sched-presets-row">
          {PRESETS.map((p) => (
            <button
              key={p.val}
              type="button"
              className={`sched-preset-btn ${scheduleText.toLowerCase() === p.val.toLowerCase() ? "active" : ""}`}
              onClick={() => setScheduleText(p.val)}
            >
              <div style={{ fontWeight: 600 }}>{p.label}</div>
              <div className="mono" style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{p.cron}</div>
            </button>
          ))}
        </div>

        <div className="conn-form-field" style={{ marginTop: 14 }}>
          <label className="conn-label">Schedule Expression / Cadence</label>
          <input
            className="conn-input mono"
            placeholder="e.g. weekdays at 8:00am, every monday at 9:00am, daily at 12:00am"
            value={scheduleText}
            onChange={(e) => setScheduleText(e.target.value)}
          />
          <span className="conn-help-text">
            Supports plain English schedules ("weekdays at 8:00am") and standard cron cadences.
          </span>
        </div>

        <div className="conn-form-field" style={{ marginTop: 16 }}>
          <label className="conn-label">Standing Directive / Unattended Input</label>
          <textarea
            className="conn-input"
            rows={3}
            placeholder="What the agent should do on each scheduled run..."
            value={standingInput}
            onChange={(e) => setStandingInput(e.target.value)}
          />
          <span className="conn-help-text">
            Since scheduled runs execute unattended, this standing prompt is automatically supplied as the goal.
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Schedule Settings"}
          </button>
        </div>
      </div>

      {/* Past Scheduled Runs */}
      <div className="panel">
        <h4 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600 }}>
          Scheduled Execution History ({pastRuns.length})
        </h4>

        {loading ? (
          <div className="sched-loading">Loading execution history…</div>
        ) : pastRuns.length === 0 ? (
          <div className="sched-empty">
            No scheduled runs have fired yet. Click "Run Schedule Now" above to trigger an immediate test.
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
                  <th style={{ textAlign: "right" }}>Action</th>
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
  );
}
