"use client";

import { useState } from "react";
import Link from "next/link";
import type { SwarmWorker } from "@/lib/types";
import { ArrowRightIcon, GridIcon, PlugIcon, SparkIcon } from "@/components/agent-ui";

/**
 * The team an agent coordinates: which agents it hands work to, what each one
 * handles, and how the work is split. Saved on every change through the
 * agent's swarm endpoint, which a normal run reads when delegation is on.
 */

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

const STRATEGIES: { id: SwarmConfig["strategy"]; title: string; note: string; icon: React.ReactNode }[] = [
  { id: "router", title: "Picks per part", note: "Sends each part of the work to the agent best suited to it", icon: <SparkIcon size={15} /> },
  { id: "parallel", title: "All at once", note: "Asks every agent together, then combines what they return", icon: <GridIcon size={15} /> },
  { id: "sequential", title: "In order", note: "Passes the work from one agent to the next, in the order listed", icon: <ArrowRightIcon size={15} /> },
];

export default function SwarmCanvas({ agentId, agentName, initialSwarm, availableAgents, onSaved }: Props) {
  const [swarm, setSwarm] = useState<SwarmConfig>(() => ({
    enabled: initialSwarm?.enabled ?? false,
    strategy: initialSwarm?.strategy ?? "router",
    supervisorRole: initialSwarm?.supervisorRole || "Triage & Delegate",
    workers: initialSwarm?.workers || [],
  }));
  const [saving, setSaving] = useState(false);
  const [selectedNewWorker, setSelectedNewWorker] = useState("");
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
      if (!res.ok) throw new Error(j.error || "The team could not be saved.");
      setFeedbackMsg({ kind: "ok", text: "Saved." });
      if (onSaved) onSaved(updated);
    } catch (e: any) {
      setFeedbackMsg({ kind: "err", text: e.message });
    } finally {
      setSaving(false);
    }
  }

  function update(next: SwarmConfig, save = true) {
    setSwarm(next);
    if (save) saveSwarm(next);
  }

  function addInternalWorker() {
    const target = availableAgents.find((a) => a.id === selectedNewWorker);
    if (!target || swarm.workers.some((w) => w.agentId === target.id)) return;
    update({
      ...swarm,
      workers: [...swarm.workers, { id: target.id, agentId: target.id, name: target.name, role: "", type: "internal" }],
    });
    setSelectedNewWorker("");
  }

  function addExternalWorker() {
    if (!externalForm.name.trim() || !externalForm.endpointUrl.trim()) return;
    const worker: SwarmWorker = {
      id: `ext_${Date.now()}`,
      name: externalForm.name.trim(),
      role: externalForm.role.trim(),
      type: "external",
      endpointUrl: externalForm.endpointUrl.trim(),
      protocol: externalForm.protocol,
      apiKey: externalForm.apiKey.trim() || undefined,
      taskPrompt: externalForm.taskPrompt.trim() || undefined,
    };
    update({ ...swarm, workers: [...swarm.workers, worker] });
    setShowAddExternalModal(false);
    setExternalForm({ name: "", role: "", endpointUrl: "", protocol: "a2a", apiKey: "", taskPrompt: "" });
  }

  const keyOf = (w: SwarmWorker, i: number) => w.id || w.agentId || `worker_${i}`;

  async function pingEndpoint(workerKey: string, endpointUrl: string, apiKey?: string) {
    setPingStatus((prev) => ({ ...prev, [workerKey]: { status: "testing" } }));
    try {
      const res = await fetch(endpointUrl, { method: "GET", headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
      setPingStatus((prev) => ({
        ...prev,
        [workerKey]: res.ok ? { status: "ok", msg: "Reachable" } : { status: "err", msg: `HTTP ${res.status}` },
      }));
    } catch (e: any) {
      setPingStatus((prev) => ({ ...prev, [workerKey]: { status: "err", msg: e.message || "Not reachable" } }));
    }
  }

  const unassignedAgents = availableAgents.filter((a) => !swarm.workers.some((w) => w.agentId === a.id) && a.id !== agentId);

  return (
    <div className="ab-team">
      <div className="ab-field">
        <span className="ab-label">How {agentName} splits the work</span>
        <div className="ab-choices three">
          {STRATEGIES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`ab-choice ${swarm.strategy === s.id ? "on" : ""}`}
              onClick={() => swarm.strategy !== s.id && update({ ...swarm, strategy: s.id })}
            >
              <span className="ic">{s.icon}</span>
              <span>
                <b>{s.title}</b>
                <span>{s.note}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <label className="ab-field">
        <span className="ab-label">Its own role while coordinating</span>
        <input
          className="input"
          value={swarm.supervisorRole || ""}
          placeholder="e.g. Split the close checklist by entity and consolidate the results"
          onChange={(e) => update({ ...swarm, supervisorRole: e.target.value }, false)}
          onBlur={() => saveSwarm()}
        />
      </label>

      <div className="ab-field">
        <span className="ab-label-row">
          <span className="ab-label">
            Agents it hands work to <span className="ab-count">{swarm.workers.length}</span>
          </span>
          <span className="sub-line">{saving ? "Saving…" : feedbackMsg?.kind === "ok" ? "Saved" : ""}</span>
        </span>

        {swarm.workers.length === 0 ? (
          <div className="note">No agents yet. Add one below and say what it should handle.</div>
        ) : (
          <div className="ab-members">
            {swarm.workers.map((w, i) => {
              const k = keyOf(w, i);
              const external = w.type === "external" || Boolean(w.endpointUrl);
              const ping = pingStatus[k];
              return (
                <div key={k} className="ab-member">
                  <span className={`ab-member-av ${external ? "ext" : ""}`}>{external ? <PlugIcon size={15} /> : (w.name || "?")[0].toUpperCase()}</span>
                  <div className="ab-member-body">
                    <div className="ab-member-head">
                      <b>{w.name}</b>
                      <span className={`ab-member-badge ${external ? "ext" : ""}`}>{external ? "External agent" : "Workspace agent"}</span>
                      {swarm.strategy === "sequential" && <span className="ab-count">Step {i + 1}</span>}
                    </div>
                    <textarea
                      className="input ab-member-role"
                      rows={2}
                      value={w.role}
                      placeholder="What it should handle, e.g. Reconcile the bank accounts for each entity"
                      onChange={(e) =>
                        update({ ...swarm, workers: swarm.workers.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) }, false)
                      }
                      onBlur={() => saveSwarm()}
                    />
                    <div className="ab-member-foot">
                      {!external && w.agentId && (
                        <Link href={`/agents/${w.agentId}`} target="_blank" className="ab-edit">
                          Open agent ↗
                        </Link>
                      )}
                      {external && w.endpointUrl && (
                        <>
                          <span className="mono dim" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis" }} title={w.endpointUrl}>
                            {w.endpointUrl}
                          </span>
                          <button type="button" className="ab-edit" onClick={() => pingEndpoint(k, w.endpointUrl!, w.apiKey)} disabled={ping?.status === "testing"}>
                            {ping?.status === "testing" ? "Testing…" : "Test connection"}
                          </button>
                          {ping && ping.status !== "testing" && (
                            <span style={{ fontSize: 11.5, color: ping.status === "ok" ? "#007a78" : "#b02a49" }}>{ping.msg}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ab-member-x"
                    onClick={() => update({ ...swarm, workers: swarm.workers.filter((_, j) => j !== i) })}
                    aria-label={`Remove ${w.name}`}
                    title="Remove from the team"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="ab-row" style={{ marginTop: 10 }}>
          <select className="input" style={{ maxWidth: 360 }} value={selectedNewWorker} onChange={(e) => setSelectedNewWorker(e.target.value)}>
            <option value="">Add a workspace agent…</option>
            {unassignedAgents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button type="button" className="btn" onClick={addInternalWorker} disabled={!selectedNewWorker}>Add</button>
          <button type="button" className="btn btn-ghost" onClick={() => setShowAddExternalModal(true)}>+ External agent</button>
        </div>
        {feedbackMsg?.kind === "err" && <div className="error" style={{ marginTop: 10 }}>{feedbackMsg.text}</div>}
      </div>

      {showAddExternalModal && (
        <div className="modal-back" onMouseDown={() => setShowAddExternalModal(false)}>
          <div className="panel modal" role="dialog" aria-modal="true" aria-labelledby="ab-ext-title" onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(520px, 100%)" }}>
            <div className="eyebrow">Add to the team</div>
            <h2 id="ab-ext-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>An external agent</h2>
            <p className="help" style={{ marginTop: 0 }}>An agent running outside Agent Studio that speaks the A2A protocol.</p>
            <div className="stack-sm">
              <label className="ab-field">
                <span className="ab-label">Name</span>
                <input className="input" value={externalForm.name} placeholder="e.g. Market data agent" onChange={(e) => setExternalForm({ ...externalForm, name: e.target.value })} />
              </label>
              <label className="ab-field">
                <span className="ab-label">What it should handle</span>
                <input className="input" value={externalForm.role} placeholder="e.g. Pull FX rates for the period" onChange={(e) => setExternalForm({ ...externalForm, role: e.target.value })} />
              </label>
              <label className="ab-field">
                <span className="ab-label">Endpoint URL</span>
                <input className="input mono" value={externalForm.endpointUrl} placeholder="https://agent-service.internal/api/a2a/v1" onChange={(e) => setExternalForm({ ...externalForm, endpointUrl: e.target.value })} />
              </label>
              <label className="ab-field">
                <span className="ab-label">Access token <em>— optional</em></span>
                <input className="input" type="password" value={externalForm.apiKey} placeholder="If the endpoint is protected" onChange={(e) => setExternalForm({ ...externalForm, apiKey: e.target.value })} />
              </label>
            </div>
            <div className="panel-foot">
              <button type="button" className="btn" onClick={() => setShowAddExternalModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={addExternalWorker} disabled={!externalForm.name.trim() || !externalForm.endpointUrl.trim()}>
                Add agent
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
