"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { SwarmWorker } from "@/lib/types";

interface SwarmConfig {
  enabled: boolean;
  strategy: "router" | "parallel" | "sequential";
  supervisorRole?: string;
  workers: SwarmWorker[];
}

interface Props {
  agentId: string;
  agentName: string;
  initialSwarm?: SwarmConfig;
  availableAgents: { id: string; name: string; description: string; archetype: string }[];
  onSaved?: (swarm: SwarmConfig) => void;
}

export default function SwarmCanvas({
  agentId,
  agentName,
  initialSwarm,
  availableAgents,
  onSaved,
}: Props) {
  const router = useRouter();

  const [swarm, setSwarm] = useState<SwarmConfig>(() => ({
    enabled: initialSwarm?.enabled ?? true,
    strategy: initialSwarm?.strategy ?? "router",
    supervisorRole: initialSwarm?.supervisorRole || "Triage & Delegate",
    workers: initialSwarm?.workers || [],
  }));

  const [saving, setSaving] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [selectedNewWorker, setSelectedNewWorker] = useState("");
  const [dispatchPrompt, setDispatchPrompt] = useState("");
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [showAddExternalModal, setShowAddExternalModal] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [externalForm, setExternalForm] = useState({
    name: "",
    role: "",
    endpointUrl: "",
    protocol: "a2a" as "a2a" | "http",
    apiKey: "",
    taskPrompt: "",
  });

  const [pingStatus, setPingStatus] = useState<Record<string, { status: "testing" | "ok" | "err"; msg?: string }>>({});

  // Auto-populate sample workers if none exist to give an immediate setup experience
  useEffect(() => {
    if (swarm.workers.length === 0 && availableAgents.length > 0) {
      const sampleWorkers: SwarmWorker[] = availableAgents.slice(0, 3).map((a, i) => {
        const roles = [
          "Data Analyst: Gathers and queries telemetry records",
          "Report Drafter: Synthesizes findings into narrative deliverable",
          "Policy Reviewer: Checks outputs against compliance rules",
        ];
        return {
          id: a.id,
          agentId: a.id,
          name: a.name,
          role: roles[i % roles.length],
          type: "internal",
        };
      });
      setSwarm((s) => ({ ...s, workers: sampleWorkers }));
    }
  }, [availableAgents]);

  async function saveSwarm(updated = swarm) {
    setSaving(true);
    setFeedbackMsg(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/swarm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swarm: updated }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to save swarm configuration");
      setFeedbackMsg({ kind: "ok", text: "Swarm orchestration topology saved." });
      if (onSaved) onSaved(updated);
    } catch (e: any) {
      setFeedbackMsg({ kind: "err", text: e.message });
    } finally {
      setSaving(false);
    }
  }

  function addInternalWorker() {
    if (!selectedNewWorker) return;
    const target = availableAgents.find((a) => a.id === selectedNewWorker);
    if (!target) return;
    if (swarm.workers.some((w) => w.agentId === target.id)) return;

    const updated: SwarmConfig = {
      ...swarm,
      workers: [
        ...swarm.workers,
        {
          id: target.id,
          agentId: target.id,
          name: target.name,
          role: "Specialist Worker: Executes sub-task assigned by Supervisor",
          type: "internal",
        },
      ],
    };
    setSwarm(updated);
    setSelectedNewWorker("");
    saveSwarm(updated);
  }

  function addExternalWorker() {
    if (!externalForm.name.trim() || !externalForm.endpointUrl.trim()) return;

    const newWorker: SwarmWorker = {
      id: `ext_${Date.now()}`,
      name: externalForm.name.trim(),
      role: externalForm.role.trim() || "External A2A Specialist",
      type: "external",
      endpointUrl: externalForm.endpointUrl.trim(),
      protocol: externalForm.protocol,
      apiKey: externalForm.apiKey.trim() || undefined,
      taskPrompt: externalForm.taskPrompt.trim() || undefined,
    };

    const updated: SwarmConfig = {
      ...swarm,
      workers: [...swarm.workers, newWorker],
    };
    setSwarm(updated);
    saveSwarm(updated);
    setShowAddExternalModal(false);
    setExternalForm({ name: "", role: "", endpointUrl: "", protocol: "a2a", apiKey: "", taskPrompt: "" });
  }

  function removeWorker(identifier: string) {
    const updated: SwarmConfig = {
      ...swarm,
      workers: swarm.workers.filter((w) => (w.id || w.agentId) !== identifier),
    };
    setSwarm(updated);
    saveSwarm(updated);
  }

  function updateWorkerRole(identifier: string, role: string) {
    const updated: SwarmConfig = {
      ...swarm,
      workers: swarm.workers.map((w) => ((w.id || w.agentId) === identifier ? { ...w, role } : w)),
    };
    setSwarm(updated);
  }

  async function pingEndpoint(workerKey: string, endpointUrl: string, apiKey?: string) {
    setPingStatus((prev) => ({ ...prev, [workerKey]: { status: "testing" } }));
    try {
      const res = await fetch(endpointUrl, {
        method: "GET",
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      if (res.ok) {
        setPingStatus((prev) => ({
          ...prev,
          [workerKey]: { status: "ok", msg: "A2A Endpoint Active (200 OK)" },
        }));
      } else {
        setPingStatus((prev) => ({
          ...prev,
          [workerKey]: { status: "err", msg: `HTTP ${res.status}` },
        }));
      }
    } catch (e: any) {
      setPingStatus((prev) => ({
        ...prev,
        [workerKey]: { status: "err", msg: e.message || "Network Error" },
      }));
    }
  }

  async function dispatchSwarm() {
    setDispatching(true);
    setFeedbackMsg(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/swarm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "dispatch",
          swarm,
          input: dispatchPrompt || `Multi-Agent Swarm Run coordinated by ${agentName}.`,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to dispatch swarm");
      setShowDispatchModal(false);
      router.push(`/runs/${j.runId}`);
    } catch (e: any) {
      setFeedbackMsg({ kind: "err", text: e.message });
      setDispatching(false);
    }
  }

  const unassignedAgents = availableAgents.filter(
    (a) => !swarm.workers.some((w) => w.agentId === a.id) && a.id !== agentId
  );

  return (
    <div className="swarm-canvas-container">
      {/* Canvas Top Bar */}
      <div className="swarm-top-bar">
        <div className="swarm-top-left">
          <div className="swarm-badge-pill">
            <span className="swarm-pulse-dot" />
            <span>Multi-Agent Swarm Orchestrator</span>
          </div>

          <div className="swarm-strategy-select-wrap">
            <label className="swarm-ctrl-label">Strategy:</label>
            <select
              className="swarm-select"
              value={swarm.strategy}
              onChange={(e) => {
                const s = e.target.value as any;
                const upd = { ...swarm, strategy: s };
                setSwarm(upd);
                saveSwarm(upd);
              }}
            >
              <option value="router">Dynamic Router / Triage (Autonomous Decision)</option>
              <option value="parallel">Parallel Swarm (Concurrent Execution & Synthesis)</option>
              <option value="sequential">Sequential Pipeline (Step-by-Step Chain)</option>
            </select>
          </div>
        </div>

        <div className="swarm-top-actions">
          {/* Add Internal Worker Dropdown */}
          <div className="swarm-add-worker-group">
            <select
              className="swarm-select"
              value={selectedNewWorker}
              onChange={(e) => setSelectedNewWorker(e.target.value)}
              style={{ maxWidth: 200 }}
            >
              <option value="">+ Workspace Agent...</option>
              {unassignedAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.archetype})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={addInternalWorker}
              disabled={!selectedNewWorker}
            >
              Add
            </button>
          </div>

          {/* Add External Agent Button */}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            onClick={() => setShowAddExternalModal(true)}
          >
            <span>🌐 + External A2A Agent</span>
          </button>

          {/* Dispatch Swarm Button */}
          <button
            type="button"
            className="btn btn-primary"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            onClick={() => setShowDispatchModal(true)}
          >
            <span>⚡ Dispatch Swarm</span>
          </button>
        </div>
      </div>

      {feedbackMsg && (
        <div className={feedbackMsg.kind === "ok" ? "ok-note" : "error"} style={{ marginBottom: 14 }}>
          {feedbackMsg.text}
        </div>
      )}

      {/* Visual Canvas Diagram */}
      <div className="swarm-visual-board">
        {/* Visual Strategy Legend */}
        <div className="swarm-legend">
          <div className="swarm-legend-item">
            <span className="swarm-legend-color supervisor" />
            <span>Supervisor Coordinator</span>
          </div>
          <div className="swarm-legend-item">
            <span className="swarm-legend-color worker" />
            <span>Specialist Sub-Agents ({swarm.workers.length})</span>
          </div>
          <div className="swarm-legend-item">
            <span className="swarm-legend-mode">
              Mode: {swarm.strategy === "router" ? "Autonomous Routing" : swarm.strategy === "parallel" ? "Parallel Fan-Out" : "Sequential Chain"}
            </span>
          </div>
        </div>

        <div className="swarm-graph-layout">
          {/* Level 1: Supervisor Node */}
          <div className="swarm-supervisor-node-wrap">
            <div className="swarm-node supervisor-node">
              <div className="swarm-node-crown">👑 Supervisor Coordinator</div>
              <div className="swarm-node-title">{agentName}</div>
              <div className="swarm-node-role">
                <input
                  className="swarm-role-input"
                  value={swarm.supervisorRole || ""}
                  placeholder="Supervisor Role..."
                  onChange={(e) => setSwarm({ ...swarm, supervisorRole: e.target.value })}
                  onBlur={() => saveSwarm()}
                />
              </div>
              <div className="swarm-node-stats">
                <span>Orchestrating {swarm.workers.length} Sub-Agents</span>
              </div>
            </div>

            {/* SVG Connecting Flow Lines */}
            {swarm.workers.length > 0 && (
              <div className="swarm-connector-spine">
                <div className="swarm-flow-line-vertical" />
              </div>
            )}
          </div>

          {/* Level 2: Worker Nodes Grid */}
          {swarm.workers.length === 0 ? (
            <div className="swarm-empty-workers">
              <p>No worker sub-agents attached yet.</p>
              <span>Add a workspace agent or an external A2A agent from the top bar to assign tasks to this swarm.</span>
            </div>
          ) : (
            <div className="swarm-workers-container">
              {swarm.workers.map((worker, idx) => {
                const workerId = worker.id || worker.agentId || `worker_${idx}`;
                const isExternal = worker.type === "external" || Boolean(worker.endpointUrl);
                const ping = pingStatus[workerId];

                return (
                  <div key={workerId} className="swarm-worker-col">
                    {/* Branch connecting line */}
                    <div className="swarm-branch-indicator">
                      <span className="swarm-branch-step-pill">
                        {swarm.strategy === "sequential" ? `Step ${idx + 1}` : `Worker ${idx + 1}`}
                      </span>
                      <div className="swarm-branch-arrow">↓</div>
                    </div>

                    {/* Worker Node Card */}
                    <div className={`swarm-node worker-node ${isExternal ? "external-worker" : ""}`}>
                      <div className="swarm-worker-head">
                        <div className="swarm-worker-title-group">
                          <span className="swarm-worker-icon">{isExternal ? "🌐" : "🤖"}</span>
                          <div>
                            <div className="swarm-worker-title">{worker.name}</div>
                            {isExternal ? (
                              <span className="swarm-worker-badge external">External A2A</span>
                            ) : (
                              <span className="swarm-worker-badge internal">Workspace Agent</span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="swarm-node-remove"
                          onClick={() => removeWorker(workerId)}
                          title="Remove from swarm"
                        >
                          ✕
                        </button>
                      </div>

                      {/* External Endpoint Preview & Ping */}
                      {isExternal && worker.endpointUrl && (
                        <div style={{ marginTop: 6 }}>
                          <div className="swarm-endpoint-pill" title={worker.endpointUrl}>
                            {worker.endpointUrl}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                            <button
                              type="button"
                              className="swarm-ping-btn"
                              onClick={() => pingEndpoint(workerId, worker.endpointUrl!, worker.apiKey)}
                              disabled={ping?.status === "testing"}
                            >
                              {ping?.status === "testing" ? "Testing…" : "⚡ Ping A2A"}
                            </button>
                            {ping && (
                              <span
                                style={{
                                  fontSize: 11,
                                  color: ping.status === "ok" ? "#16a34a" : "#dc2626",
                                  fontWeight: 500,
                                }}
                              >
                                {ping.msg}
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="swarm-worker-role-wrap" style={{ marginTop: 8 }}>
                        <label className="swarm-sub-label">Delegated Sub-Task Role:</label>
                        <textarea
                          className="swarm-role-textarea"
                          rows={2}
                          value={worker.role}
                          onChange={(e) => updateWorkerRole(workerId, e.target.value)}
                          onBlur={() => saveSwarm()}
                          placeholder="Define what the supervisor delegates to this worker..."
                        />
                      </div>

                      <div className="swarm-worker-foot">
                        {!isExternal && worker.agentId && (
                          <Link
                            href={`/agents/${worker.agentId}`}
                            className="swarm-sub-link"
                            target="_blank"
                          >
                            View Agent Spec ↗
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add External A2A Agent Modal */}
      {showAddExternalModal && (
        <div className="conn-modal-overlay" onClick={() => setShowAddExternalModal(false)}>
          <div className="conn-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="conn-modal-head">
              <div className="conn-modal-title-group">
                <span style={{ fontSize: 24 }}>🌐</span>
                <div>
                  <h3 className="conn-modal-title">Connect External A2A Agent</h3>
                  <div className="conn-modal-subtitle">
                    Attach an autonomous agent running outside Agent Studio via A2A Protocol
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="conn-modal-close"
                onClick={() => setShowAddExternalModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="conn-modal-body">
              <div className="conn-form-field">
                <label className="conn-label">External Agent Name *</label>
                <input
                  className="conn-input"
                  placeholder="e.g. Market Sentiment Telemetry Agent"
                  value={externalForm.name}
                  onChange={(e) => setExternalForm({ ...externalForm, name: e.target.value })}
                />
              </div>

              <div className="conn-form-field">
                <label className="conn-label">Role / Sub-Task Description *</label>
                <input
                  className="conn-input"
                  placeholder="e.g. Queries external social feeds and computes volatility index"
                  value={externalForm.role}
                  onChange={(e) => setExternalForm({ ...externalForm, role: e.target.value })}
                />
              </div>

              <div className="conn-form-field">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label className="conn-label">A2A Protocol Endpoint URL *</label>
                  <button
                    type="button"
                    style={{ fontSize: 11, color: "#005eb8", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                    onClick={() =>
                      setExternalForm({
                        ...externalForm,
                        name: "Mock External Specialist",
                        role: "Market Telemetry & Sentiment Risk Analysis",
                        endpointUrl: `${window.location.origin}/api/a2a/mock-worker`,
                      })
                    }
                  >
                    Insert Mock A2A Worker URL
                  </button>
                </div>
                <input
                  className="conn-input"
                  placeholder="https://agent-service.internal/api/a2a/v1 or http://localhost:3000/api/a2a/mock-worker"
                  value={externalForm.endpointUrl}
                  onChange={(e) => setExternalForm({ ...externalForm, endpointUrl: e.target.value })}
                />
              </div>

              <div className="conn-form-field">
                <label className="conn-label">Authentication Token (Optional)</label>
                <input
                  className="conn-input"
                  type="password"
                  placeholder="Bearer token or API key if endpoint is protected"
                  value={externalForm.apiKey}
                  onChange={(e) => setExternalForm({ ...externalForm, apiKey: e.target.value })}
                />
              </div>

              <div className="conn-modal-foot">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowAddExternalModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={addExternalWorker}
                  disabled={!externalForm.name.trim() || !externalForm.endpointUrl.trim()}
                >
                  Add External Agent to Swarm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dispatch Swarm Modal */}
      {showDispatchModal && (
        <div className="conn-modal-overlay" onClick={() => setShowDispatchModal(false)}>
          <div className="conn-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="conn-modal-head">
              <div className="conn-modal-title-group">
                <span style={{ fontSize: 24 }}>⚡</span>
                <div>
                  <h3 className="conn-modal-title">Dispatch Multi-Agent Swarm</h3>
                  <div className="conn-modal-subtitle">
                    {agentName} will orchestrate {swarm.workers.length} specialist sub-agents
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="conn-modal-close"
                onClick={() => setShowDispatchModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="conn-modal-body">
              <div className="conn-form-field">
                <label className="conn-label">Swarm Objective / User Directive</label>
                <textarea
                  className="conn-input"
                  rows={4}
                  placeholder="e.g. Conduct complete quarterly financial reconciliation: analyze raw transactions, synthesize variance report, and verify compliance."
                  value={dispatchPrompt}
                  onChange={(e) => setDispatchPrompt(e.target.value)}
                />
              </div>

              <div className="swarm-dispatch-preview-box">
                <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>
                  Execution Plan:
                </div>
                <div style={{ fontSize: 12, color: "#1e293b", lineHeight: 1.5 }}>
                  1. 👑 <strong>{agentName}</strong> receives prompt and oversees strategy (
                  <em>{swarm.strategy}</em>).
                  <br />
                  2. 🤖 Dispatches to:{" "}
                  {swarm.workers.map((w) => `${w.name} (${w.type === "external" || w.endpointUrl ? "External A2A" : "Internal"})`).join(", ")}.
                  <br />
                  3. 📊 Collects deliverables and compiles the consolidated final result.
                </div>
              </div>

              <div className="conn-modal-foot">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowDispatchModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={dispatchSwarm}
                  disabled={dispatching}
                >
                  {dispatching ? "Dispatching Swarm…" : "Launch Swarm Execution"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
