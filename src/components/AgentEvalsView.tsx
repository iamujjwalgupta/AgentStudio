"use client";

import { useState, useEffect } from "react";
import type { EvalSuite, EvalRunSummary, EvalTestCase } from "@/lib/evals";
import type { AgentSpec } from "@/lib/types";

interface AgentEvalsViewProps {
  agentId: string;
  agentName: string;
  spec: AgentSpec;
  publishedVer: number | null;
}

export default function AgentEvalsView({
  agentId,
  agentName,
  spec,
  publishedVer,
}: AgentEvalsViewProps) {
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>("");
  const [targetVersion, setTargetVersion] = useState<"draft" | "published">("draft");
  const [isRunning, setIsRunning] = useState(false);
  const [latestRun, setLatestRun] = useState<EvalRunSummary | null>(null);
  const [history, setHistory] = useState<EvalRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New Scenario Modal
  const [isAddScenarioOpen, setIsAddScenarioOpen] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState("");
  const [newScenarioCategory, setNewScenarioCategory] = useState<"safety" | "tools" | "grounding" | "custom">("tools");
  const [newScenarioInput, setNewScenarioInput] = useState("");
  const [newScenarioExpectedTool, setNewScenarioExpectedTool] = useState("");
  const [newScenarioMustInclude, setNewScenarioMustInclude] = useState("");
  const [newScenarioMustNotInclude, setNewScenarioMustNotInclude] = useState("");

  useEffect(() => {
    loadEvals();
  }, [agentId]);

  async function loadEvals() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/evals`);
      if (!res.ok) throw new Error("Failed to load evaluations");
      const data = await res.json();
      setSuites(data.suites || []);
      if (data.suites?.length > 0) {
        setSelectedSuiteId(data.suites[0].id);
      }
      setHistory(data.history || []);
      if (data.history?.length > 0) {
        setLatestRun(data.history[0]);
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleRunSuite() {
    if (!selectedSuiteId || isRunning) return;
    setIsRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/evals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suiteId: selectedSuiteId,
          useDraft: targetVersion === "draft",
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Evaluation benchmark failed.");
      }
      const data = await res.json();
      setLatestRun(data.summary);
      setHistory((prev) => [data.summary, ...prev]);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setIsRunning(false);
    }
  }

  const activeSuite = suites.find((s) => s.id === selectedSuiteId) || suites[0];

  const handleAddScenario = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newScenarioName.trim() || !newScenarioInput.trim()) return;

    const newCase: EvalTestCase = {
      id: "custom_" + Date.now(),
      name: newScenarioName.trim(),
      category: newScenarioCategory,
      description: "Custom user-defined evaluation scenario",
      input: newScenarioInput.trim(),
      expectedTools: newScenarioExpectedTool ? [newScenarioExpectedTool.trim()] : undefined,
      mustInclude: newScenarioMustInclude ? newScenarioMustInclude.split(",").map((s) => s.trim()) : undefined,
      mustNotInclude: newScenarioMustNotInclude ? newScenarioMustNotInclude.split(",").map((s) => s.trim()) : undefined,
    };

    if (activeSuite) {
      const updatedSuite = {
        ...activeSuite,
        testCases: [...activeSuite.testCases, newCase],
      };
      setSuites((prev) => prev.map((s) => (s.id === activeSuite.id ? updatedSuite : s)));
    }

    setNewScenarioName("");
    setNewScenarioInput("");
    setNewScenarioExpectedTool("");
    setNewScenarioMustInclude("");
    setNewScenarioMustNotInclude("");
    setIsAddScenarioOpen(false);
  };

  return (
    <div className="evals-container">
      {/* Top Controls Header */}
      <div className="evals-header">
        <div>
          <div className="eyebrow" style={{ color: "#005eb8", fontWeight: 600 }}>
            Enterprise Governance & Quality Assurance
          </div>
          <h2 className="evals-title">
            Agent Regression & Safety Benchmarks
          </h2>
          <p className="evals-subtitle">
            Evaluate accuracy, tool selection precision, token cost, and hallucination rates across revisions before publishing.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          {/* Suite Selector */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Benchmark Suite
            </label>
            <select
              value={selectedSuiteId}
              onChange={(e) => setSelectedSuiteId(e.target.value)}
              className="evals-select"
              style={{
                minWidth: "260px",
                padding: "7px 12px",
                fontSize: "13px",
                background: "#ffffff",
                color: "#0f172a",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                fontWeight: 500,
              }}
              disabled={isRunning || suites.length === 0}
            >
              {suites.map((s) => (
                <option key={s.id} value={s.id} style={{ background: "#ffffff", color: "#0f172a" }}>
                  {s.name} ({s.testCases?.length || 0} tests)
                </option>
              ))}
            </select>
          </div>

          {/* Target Version Selector */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Evaluation Target
            </label>
            <div className="evals-target-toggle">
              <button
                type="button"
                className={`evals-target-btn ${targetVersion === "draft" ? "active" : ""}`}
                onClick={() => setTargetVersion("draft")}
              >
                Draft Spec
              </button>
              <button
                type="button"
                className={`evals-target-btn ${targetVersion === "published" ? "active" : ""}`}
                onClick={() => setTargetVersion("published")}
                disabled={!publishedVer}
                title={!publishedVer ? "Agent is not published yet" : `Published v${publishedVer}`}
              >
                v{publishedVer || "1"} Live
              </button>
            </div>
          </div>

          {/* Run Button */}
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleRunSuite}
              disabled={isRunning || !selectedSuiteId}
              style={{ padding: "8px 18px", fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px", background: "#005eb8", color: "#ffffff", borderRadius: "8px" }}
            >
              {isRunning ? (
                <>
                  <span className="app-spinner-mini" />
                  <span>Benchmarking...</span>
                </>
              ) : (
                <>
                  <span>▶</span>
                  <span>Run Evaluation Suite</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="evals-error-banner" style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "10px 14px", color: "#991b1b", marginBottom: "16px", fontSize: "13px" }}>
          <span>⚠️ {error}</span>
        </div>
      )}

      {/* Scorecards Deck */}
      {latestRun ? (
        <div className="evals-scorecards-grid">
          {/* Card 1: Benchmark Status */}
          <div className="evals-card">
            <div className="evals-card-label">Benchmark Result</div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
              <span style={{ fontSize: "24px" }}>{latestRun.overallPassed ? "🛡️" : "⚠️"}</span>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: latestRun.overallPassed ? "#15803d" : "#b45309" }}>
                  {latestRun.overallPassed ? "PASSED ALL TESTS" : "REGRESSION DETECTED"}
                </div>
                <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                  {latestRun.passedTests} of {latestRun.totalTests} test scenarios passed
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Accuracy Score */}
          <div className="evals-card">
            <div className="evals-card-label">Accuracy & Deliverable Score</div>
            <div className="evals-card-metric" style={{ color: "#0284c7" }}>
              {latestRun.accuracyRate}%
            </div>
            <div className="evals-progress-track">
              <div
                className="evals-progress-fill"
                style={{ width: `${latestRun.accuracyRate}%`, background: "#0284c7" }}
              />
            </div>
          </div>

          {/* Card 3: Tool Precision */}
          <div className="evals-card">
            <div className="evals-card-label">Tool Selection Precision</div>
            <div className="evals-card-metric" style={{ color: "#16a34a" }}>
              {latestRun.toolPrecisionRate}%
            </div>
            <div className="evals-progress-track">
              <div
                className="evals-progress-fill"
                style={{ width: `${latestRun.toolPrecisionRate}%`, background: "#16a34a" }}
              />
            </div>
          </div>

          {/* Card 4: Hallucination Rate */}
          <div className="evals-card">
            <div className="evals-card-label">Hallucination & Leakage Rate</div>
            <div
              className="evals-card-metric"
              style={{ color: latestRun.hallucinationRate === 0 ? "#16a34a" : "#dc2626" }}
            >
              {latestRun.hallucinationRate}%
            </div>
            <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "4px" }}>
              {latestRun.hallucinationRate === 0 ? "✓ 0 ungrounded claims" : "Hallucinations detected"}
            </div>
          </div>

          {/* Card 5: Cost & Latency */}
          <div className="evals-card">
            <div className="evals-card-label">Avg Execution & Token Spend</div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a", marginTop: "4px" }}>
              ${latestRun.totalCostUsd.toFixed(4)} USD
            </div>
            <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "3px" }}>
              Latency: {latestRun.avgLatencyMs}ms avg per scenario
            </div>
          </div>
        </div>
      ) : (
        <div className="evals-empty-state">
          <div style={{ fontSize: "36px", marginBottom: "8px" }}>🧪</div>
          <div className="evals-empty-title">No Benchmark Run Yet</div>
          <div className="evals-empty-desc">
            Click &quot;Run Evaluation Suite&quot; above to run automated regression testing against safety guardrails, tool selection precision, and output quality.
          </div>
        </div>
      )}

      {/* Test Scenarios & Results */}
      <div className="evals-section-header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <h3 className="evals-section-title">
            Scenarios in &quot;{activeSuite?.name || "Suite"}&quot;
          </h3>
          <span className="evals-count-badge">{activeSuite?.testCases?.length || 0} scenarios</span>
        </div>

        <button
          type="button"
          className="btn btn-subtle"
          onClick={() => setIsAddScenarioOpen(true)}
          style={{ fontSize: "12px", padding: "5px 12px", background: "#ffffff", border: "1px solid #cbd5e1", color: "#005eb8", fontWeight: 500 }}
        >
          + Add Test Scenario
        </button>
      </div>

      <div className="evals-scenarios-list">
        {activeSuite?.testCases?.map((tc) => {
          const runResult = latestRun?.results?.find((r) => r.testCaseId === tc.id);

          return (
            <div key={tc.id} className="evals-scenario-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span className="evals-scenario-name">
                      {tc.name}
                    </span>
                    <span className={`evals-category-tag ${tc.category}`}>{tc.category}</span>
                  </div>
                  <div className="evals-scenario-desc">
                    {tc.description}
                  </div>
                </div>

                {runResult ? (
                  <span className={`evals-status-badge ${runResult.passed ? "passed" : "failed"}`}>
                    {runResult.passed ? "✓ PASSED" : "✕ FAILED"} ({runResult.accuracyScore}%)
                  </span>
                ) : (
                  <span className="evals-status-badge pending">NOT RUN</span>
                )}
              </div>

              {/* Prompt Input Box */}
              <div className="evals-prompt-box">
                <span className="evals-box-label">INPUT PROMPT:</span>
                <span className="evals-prompt-text">{tc.input}</span>
              </div>

              {/* Assertions & Expectations */}
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "10px", fontSize: "11px" }}>
                {tc.expectedTools && tc.expectedTools.length > 0 && (
                  <div className="evals-criteria-pill">
                    <span style={{ color: "#64748b" }}>Expected Tools:</span>
                    <strong>{tc.expectedTools.join(", ")}</strong>
                  </div>
                )}
                {tc.mustInclude && tc.mustInclude.length > 0 && (
                  <div className="evals-criteria-pill">
                    <span style={{ color: "#64748b" }}>Must Include:</span>
                    <strong>{tc.mustInclude.join(", ")}</strong>
                  </div>
                )}
                {tc.mustNotInclude && tc.mustNotInclude.length > 0 && (
                  <div className="evals-criteria-pill alert">
                    <span>Shield Prohibits:</span>
                    <strong>{tc.mustNotInclude.join(", ")}</strong>
                  </div>
                )}
              </div>

              {/* Output Preview if result available */}
              {runResult && (
                <div style={{ marginTop: "12px", borderTop: "1px solid #e2e8f0", paddingTop: "10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#64748b", marginBottom: "6px", fontWeight: 600 }}>
                    <span>AGENT DELIVERABLE OUTPUT:</span>
                    <span>Latency: {runResult.durationMs}ms | Spend: ${runResult.tokensUsed?.costUsd?.toFixed(4) || "0.0000"}</span>
                  </div>
                  <div className="evals-output-box">{runResult.output}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Regression History Table */}
      {history.length > 1 && (
        <div style={{ marginTop: "32px" }}>
          <h3 style={{ fontSize: "15px", color: "#0f172a", fontWeight: 600, marginBottom: "12px" }}>
            Regression Benchmark History & Diffs
          </h3>
          <table className="evals-history-table">
            <thead>
              <tr>
                <th>Run Time</th>
                <th>Target</th>
                <th>Accuracy</th>
                <th>Tool Precision</th>
                <th>Hallucinations</th>
                <th>Avg Latency</th>
                <th>Total Cost</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={h.id || i}>
                  <td>{new Date(h.createdAt).toLocaleString()}</td>
                  <td>{h.version ? `v${h.version} (Live)` : "Draft Spec"}</td>
                  <td style={{ color: "#0284c7", fontWeight: 600 }}>{h.accuracyRate}%</td>
                  <td style={{ color: "#16a34a", fontWeight: 600 }}>{h.toolPrecisionRate}%</td>
                  <td style={{ color: h.hallucinationRate === 0 ? "#16a34a" : "#dc2626" }}>
                    {h.hallucinationRate}%
                  </td>
                  <td>{h.avgLatencyMs}ms</td>
                  <td>${h.totalCostUsd.toFixed(4)}</td>
                  <td>
                    <span className={`evals-status-badge ${h.overallPassed ? "passed" : "failed"}`}>
                      {h.overallPassed ? "PASS" : "FAIL"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Custom Scenario Modal */}
      {isAddScenarioOpen && (
        <div className="app-auth-modal-overlay" onClick={() => setIsAddScenarioOpen(false)}>
          <div className="app-auth-modal" style={{ maxWidth: "520px", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "12px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)", padding: "24px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 600, color: "#0f172a" }}>Add Evaluation Test Scenario</h3>
              <button
                type="button"
                onClick={() => setIsAddScenarioOpen(false)}
                style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: "18px", padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddScenario}>
              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Scenario Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Q4 Revenue Query or Customer PII Masking"
                  value={newScenarioName}
                  onChange={(e) => setNewScenarioName(e.target.value)}
                  className="input"
                  style={{ width: "100%", fontSize: "13px", background: "#ffffff", color: "#0f172a", border: "1px solid #cbd5e1" }}
                />
              </div>

              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Category
                </label>
                <select
                  value={newScenarioCategory}
                  onChange={(e) => setNewScenarioCategory(e.target.value as any)}
                  className="input"
                  style={{ width: "100%", fontSize: "13px", background: "#ffffff", color: "#0f172a", border: "1px solid #cbd5e1" }}
                >
                  <option value="safety">Safety & Injection Defense</option>
                  <option value="tools">Tool Selection & Actions</option>
                  <option value="grounding">Grounding & Citations</option>
                  <option value="custom">Custom Regression Scenario</option>
                </select>
              </div>

              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Input Prompt to Feed Agent
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="What is the prompt or instruction that will be passed to the agent?"
                  value={newScenarioInput}
                  onChange={(e) => setNewScenarioInput(e.target.value)}
                  className="input"
                  style={{ width: "100%", fontSize: "12.5px", fontFamily: "var(--mono)", background: "#ffffff", color: "#0f172a", border: "1px solid #cbd5e1" }}
                />
              </div>

              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Expected Tool (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. sql_query, http_request"
                  value={newScenarioExpectedTool}
                  onChange={(e) => setNewScenarioExpectedTool(e.target.value)}
                  className="input"
                  style={{ width: "100%", fontSize: "13px", background: "#ffffff", color: "#0f172a", border: "1px solid #cbd5e1" }}
                />
              </div>

              <div style={{ marginBottom: "18px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Forbidden Substrings (e.g. leaked secrets, system prompt keywords, comma separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. password, drop table, SYSTEM PROMPT"
                  value={newScenarioMustNotInclude}
                  onChange={(e) => setNewScenarioMustNotInclude(e.target.value)}
                  className="input"
                  style={{ width: "100%", fontSize: "13px", background: "#ffffff", color: "#0f172a", border: "1px solid #cbd5e1" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  className="btn btn-subtle"
                  onClick={() => setIsAddScenarioOpen(false)}
                  style={{ padding: "6px 14px", fontSize: "12.5px" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ padding: "6px 18px", fontSize: "12.5px", background: "#005eb8", color: "#ffffff" }}
                >
                  Save Test Scenario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
