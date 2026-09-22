"use client";

import { useState } from "react";
import { AgentSpec } from "@/lib/types";

interface Props {
  agentId: string;
  agentName: string;
  spec: AgentSpec;
  publishedVer: number | null;
}

interface StepItem {
  idx: number;
  thought: string;
  toolCall?: {
    tool: string;
    input: any;
    output: any;
    status: "ok" | "held" | "error";
    durationMs: number;
  };
  outputSummary?: string;
  isComplete?: boolean;
}

export default function LivePlayground({ agentId, agentName, spec, publishedVer }: Props) {
  const [prompt, setPrompt] = useState(
    "Query PostgreSQL for reconciling records, compile financial reconciliation summary, and post to Slack."
  );
  const [debugMode, setDebugMode] = useState<"normal" | "step">("normal");
  const [dryRun, setDryRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [pausedAtStep, setPausedAtStep] = useState<number | null>(null);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);

  // Trace results
  const [steps, setSteps] = useState<StepItem[]>([]);
  const [finalOutput, setFinalOutput] = useState<string | null>(null);
  const [tokens, setTokens] = useState({ prompt: 0, completion: 0 });
  const [rightTab, setRightTab] = useState<"trace" | "memory" | "json">("trace");
  const [expandedToolIdx, setExpandedToolIdx] = useState<number | null>(null);
  const [error, setError] = useState("");

  const samplePrompts = [
    "Query PostgreSQL for reconciling records, compile financial reconciliation summary, and post to Slack.",
    "Verify transaction telemetry and check against compliance policies.",
    "Draft executive summary of anomalies detected in Q3 ledger.",
  ];

  async function startRun() {
    setRunning(true);
    setError("");
    setSteps([]);
    setFinalOutput(null);
    setPausedAtStep(null);
    setCurrentStepIdx(0);

    try {
      if (debugMode === "step") {
        // Step-by-step breakpoint mode
        const res = await fetch(`/api/agents/${agentId}/playground`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, mode: "step", step: 0 }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "Debugger step failed");

        setSteps([j.trace]);
        setTokens(j.tokens || { prompt: 840, completion: 180 });
        if (j.isPausedAtBreakpoint) {
          setPausedAtStep(0);
          setExpandedToolIdx(0);
        } else {
          setFinalOutput(j.trace.outputSummary);
          setRunning(false);
        }
      } else {
        // Full run mode
        const res = await fetch(`/api/agents/${agentId}/playground`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, mode: "normal" }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "Playground execution failed");

        setSteps(j.steps || []);
        setFinalOutput(j.finalDeliverable || null);
        setTokens(j.tokens || { prompt: 1140, completion: 360 });
        setExpandedToolIdx(0);
        setRunning(false);
      }
    } catch (e: any) {
      setError(e.message);
      setRunning(false);
    }
  }

  async function advanceNextStep() {
    const nextStep = currentStepIdx + 1;
    setCurrentStepIdx(nextStep);
    try {
      const res = await fetch(`/api/agents/${agentId}/playground`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, mode: "step", step: nextStep }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Debugger step failed");

      setSteps((prev) => [...prev, j.trace]);
      setTokens(j.tokens || { prompt: 980, completion: 240 });
      setExpandedToolIdx(steps.length);

      if (j.isPausedAtBreakpoint) {
        setPausedAtStep(nextStep);
      } else {
        setPausedAtStep(null);
        setFinalOutput(j.trace.outputSummary);
        setRunning(false);
      }
    } catch (e: any) {
      setError(e.message);
      setRunning(false);
    }
  }

  function haltExecution() {
    setRunning(false);
    setPausedAtStep(null);
  }

  return (
    <div className="playground-container">
      {/* Split Screen Grid */}
      <div className="playground-grid">
        {/* Left Pane: Interactive Chat & Execution Controls */}
        <div className="playground-left-pane">
          <div className="playground-pane-head">
            <h4 className="playground-pane-title">Interactive Debugger Console</h4>
            <div className="playground-mode-toggle">
              <button
                type="button"
                className={`playground-mode-btn ${debugMode === "normal" ? "active" : ""}`}
                onClick={() => setDebugMode("normal")}
              >
                Normal
              </button>
              <button
                type="button"
                className={`playground-mode-btn ${debugMode === "step" ? "active" : ""}`}
                onClick={() => setDebugMode("step")}
                title="Pause execution before each tool call for inspection"
              >
                🔍 Step Breakpoints
              </button>
            </div>
          </div>

          {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

          {/* Preset Prompts */}
          <div className="playground-presets">
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "#64748b" }}>Presets:</span>
            {samplePrompts.map((sp, i) => (
              <button
                key={i}
                type="button"
                className="playground-preset-pill"
                onClick={() => setPrompt(sp)}
              >
                {sp.slice(0, 38)}…
              </button>
            ))}
          </div>

          {/* Prompt Box */}
          <div className="playground-input-box">
            <label className="conn-label">User Directive / Test Prompt</label>
            <textarea
              className="conn-input"
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Type instructions to test agent reasoning, tool invocation, and outputs..."
            />
          </div>

          {/* Execution Options */}
          <div className="playground-options-row">
            <label className="playground-opt-check">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              <span>Dry-Run Rehearsal (Read-only, simulate writes)</span>
            </label>
          </div>

          {/* Breakpoint Action Controls */}
          {pausedAtStep !== null ? (
            <div className="playground-breakpoint-bar">
              <div className="playground-breakpoint-status">
                <span className="swarm-pulse-dot" />
                <span>Paused at Breakpoint (Step {pausedAtStep + 1})</span>
              </div>
              <div className="playground-breakpoint-btns">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={advanceNextStep}
                >
                  ⏭ Next Step
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setDebugMode("normal");
                    advanceNextStep();
                  }}
                >
                  ▶ Continue
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ color: "#ef4444" }}
                  onClick={haltExecution}
                >
                  ⏹ Halt
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: "100%", padding: "10px 18px", fontSize: 14 }}
                onClick={startRun}
                disabled={running}
              >
                {running ? "Executing Agent…" : debugMode === "step" ? "🔍 Start Step Debugger" : "⚡ Run in Playground"}
              </button>
            </div>
          )}
        </div>

        {/* Right Pane: Real-Time Execution Traces & Debugger */}
        <div className="playground-right-pane">
          <div className="playground-pane-head">
            <div className="playground-tabs-row">
              <button
                type="button"
                className={`playground-tab ${rightTab === "trace" ? "active" : ""}`}
                onClick={() => setRightTab("trace")}
              >
                Trace Timeline ({steps.length})
              </button>
              <button
                type="button"
                className={`playground-tab ${rightTab === "memory" ? "active" : ""}`}
                onClick={() => setRightTab("memory")}
              >
                Context & Memory
              </button>
              <button
                type="button"
                className={`playground-tab ${rightTab === "json" ? "active" : ""}`}
                onClick={() => setRightTab("json")}
              >
                Raw Traces
              </button>
            </div>

            {tokens.prompt > 0 && (
              <div className="playground-tokens-badge mono">
                {tokens.prompt + tokens.completion} tokens
              </div>
            )}
          </div>

          <div className="playground-traces-body">
            {steps.length === 0 && !running ? (
              <div className="playground-empty-traces">
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔬</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Interactive Debugger Ready</div>
                <p style={{ fontSize: 12.5, color: "#64748b", margin: "6px auto 0", maxWidth: 360 }}>
                  Enter a test prompt on the left to stream real-time thoughts, observe tool invocations, and step through execution.
                </p>
              </div>
            ) : rightTab === "trace" ? (
              <div className="playground-steps-timeline">
                {steps.map((s, idx) => {
                  const isToolExpanded = expandedToolIdx === idx;
                  return (
                    <div key={idx} className="playground-step-card">
                      {/* Thought Bubble Card */}
                      <div className="playground-thought-box">
                        <div className="playground-thought-head">
                          <span style={{ fontSize: 13 }}>🧠</span>
                          <span className="playground-thought-label">Agent Reasoning</span>
                          <span className="playground-step-idx mono">Step {s.idx}</span>
                        </div>
                        <div className="playground-thought-body">
                          {s.thought}
                        </div>
                      </div>

                      {/* Tool Invocation Chip if present */}
                      {s.toolCall && (
                        <div className="playground-tool-card">
                          <div
                            className="playground-tool-head"
                            onClick={() => setExpandedToolIdx(isToolExpanded ? null : idx)}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span className="playground-tool-icon">⚡</span>
                              <span className="playground-tool-name mono">{s.toolCall.tool}</span>
                              <span className="conn-heartbeat-badge healthy">
                                <span className="conn-hb-dot" />
                                {s.toolCall.durationMs}ms
                              </span>
                            </div>
                            <span style={{ fontSize: 11, color: "#005eb8", fontWeight: 600 }}>
                              {isToolExpanded ? "Hide Details ▲" : "Inspect I/O ▼"}
                            </span>
                          </div>

                          {isToolExpanded && (
                            <div className="playground-tool-details">
                              <div className="playground-io-block">
                                <span className="playground-io-label">Input Arguments:</span>
                                <pre className="playground-json-pre">
                                  {JSON.stringify(s.toolCall.input, null, 2)}
                                </pre>
                              </div>

                              <div className="playground-io-block" style={{ marginTop: 8 }}>
                                <span className="playground-io-label">Output Payload:</span>
                                <pre className="playground-json-pre">
                                  {JSON.stringify(s.toolCall.output, null, 2)}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Final Deliverable Preview */}
                {finalOutput && (
                  <div className="playground-final-deliverable">
                    <div className="playground-deliverable-head">
                      <span>✓ Final Output Deliverable</span>
                      <span className="tag" style={{ background: "rgba(34, 197, 94, 0.15)", color: "#16a34a" }}>
                        Completed
                      </span>
                    </div>
                    <div className="playground-deliverable-body">
                      <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>
                        {finalOutput}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            ) : rightTab === "memory" ? (
              <div className="playground-memory-view">
                <div className="panel" style={{ padding: 14 }}>
                  <h5 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>Working Context & State</h5>
                  <div className="conn-detail-row">
                    <span className="conn-detail-k">Agent ID:</span>
                    <span className="conn-detail-v mono">{agentId}</span>
                  </div>
                  <div className="conn-detail-row">
                    <span className="conn-detail-k">Archetype:</span>
                    <span className="conn-detail-v">{spec.archetype}</span>
                  </div>
                  <div className="conn-detail-row">
                    <span className="conn-detail-k">Max Steps Allowed:</span>
                    <span className="conn-detail-v mono">{spec.guardrails?.maxSteps || 12}</span>
                  </div>
                  <div className="conn-detail-row">
                    <span className="conn-detail-k">Active Tools:</span>
                    <span className="conn-detail-v mono">{spec.tools?.length || 0} tools attached</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="playground-json-view">
                <pre className="playground-json-pre" style={{ maxHeight: 420 }}>
                  {JSON.stringify({ prompt, debugMode, tokens, steps, finalOutput }, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
