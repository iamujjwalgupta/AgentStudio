"use client";

import { useState, useRef, useEffect } from "react";
import type { BridgeEnvelope, RequestApprovalPayload } from "@/lib/agent-bridge";

export interface AgentOption {
  id: string;
  name: string;
  archetype?: string;
  description?: string;
}

interface ChatMessage {
  id: string;
  sender: "user" | "agent" | "system";
  text: string;
  timestamp: string;
  source?: string;
}

interface AgentAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  availableAgents: AgentOption[];
  activeAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  bridgeEvents: BridgeEnvelope[];
  pendingApprovals: RequestApprovalPayload[];
  onResolveApproval: (approvalId: string, decision: "approved" | "rejected") => void;
  activeContext: Record<string, any> | null;
  appName: string;
  onSendMessage: (text: string) => void;
  isExecuting?: boolean;
}

export default function AgentAssistantDrawer({
  isOpen,
  onClose,
  availableAgents,
  activeAgentId,
  onSelectAgent,
  bridgeEvents,
  pendingApprovals,
  onResolveApproval,
  activeContext,
  appName,
  onSendMessage,
  isExecuting = false,
}: AgentAssistantDrawerProps) {
  const [inputText, setInputText] = useState("");
  const [activeTab, setActiveTab] = useState<"chat" | "bridge" | "context">("chat");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedAgent = availableAgents.find((a) => a.id === activeAgentId) || availableAgents[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isExecuting) return;
    onSendMessage(inputText.trim());
    setInputText("");
  };

  return (
    <div className={`app-assistant-drawer ${isOpen ? "open" : ""}`}>
      {/* Drawer Header */}
      <div className="app-assistant-header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div className="app-assistant-avatar">🤖</div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "14px", fontWeight: 700, color: "#fff" }}>
                Agent Assistant
              </span>
              <span className="app-assistant-pill">Canvas Co-pilot</span>
            </div>
            <div style={{ fontSize: "11px", color: "var(--sky-3)", marginTop: "1px" }}>
              Paired with: <strong style={{ color: "#38bdf8" }}>{appName}</strong>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="app-tile-btn-icon"
          title="Close Agent Assistant"
          style={{ width: "28px", height: "28px", fontSize: "14px" }}
        >
          ✕
        </button>
      </div>

      {/* Agent Selector Bar */}
      <div className="app-assistant-agent-bar">
        <span style={{ fontSize: "11px", color: "var(--sky-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Active Agent:
        </span>
        <select
          value={activeAgentId || (availableAgents[0]?.id ?? "")}
          onChange={(e) => onSelectAgent(e.target.value)}
          className="app-assistant-select"
          disabled={availableAgents.length === 0}
        >
          {availableAgents.length === 0 ? (
            <option value="">No agents found (Create in Studio)</option>
          ) : (
            availableAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} {agent.archetype ? `(${agent.archetype})` : ""}
              </option>
            ))
          )}
        </select>
      </div>

      {/* Pending Approval Banner if any */}
      {pendingApprovals.length > 0 && (
        <div className="app-assistant-approvals-alert">
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
            <span style={{ fontSize: "16px" }}>⚠️</span>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#fbbf24" }}>
              {pendingApprovals.length} Pending Approval Request{pendingApprovals.length > 1 ? "s" : ""}
            </span>
          </div>
          {pendingApprovals.map((req) => (
            <div key={req.approvalId} className="app-approval-card">
              <div style={{ fontSize: "11px", color: "var(--sky-3)", textTransform: "uppercase", marginBottom: "2px" }}>
                Action: <strong style={{ color: "#fff" }}>{req.action}</strong>
              </div>
              <div style={{ fontSize: "12px", color: "#e2e8f0", marginBottom: "8px", lineHeight: "1.4" }}>
                {req.summary}
              </div>
              {req.payload && Object.keys(req.payload).length > 0 && (
                <pre className="app-approval-payload">
                  {JSON.stringify(req.payload, null, 2)}
                </pre>
              )}
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={() => onResolveApproval(req.approvalId, "approved")}
                  className="btn btn-primary"
                  style={{ flex: 1, padding: "4px 8px", fontSize: "11.5px", background: "#16a34a", borderColor: "#22c55e" }}
                >
                  ✓ Approve
                </button>
                <button
                  type="button"
                  onClick={() => onResolveApproval(req.approvalId, "rejected")}
                  className="btn btn-subtle"
                  style={{ flex: 1, padding: "4px 8px", fontSize: "11.5px", color: "#f87171", borderColor: "rgba(239, 68, 68, 0.4)" }}
                >
                  ✕ Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Navigation Sub-Tabs: Chat | Bridge Events | Synced Context */}
      <div className="app-assistant-tabs">
        <button
          type="button"
          className={`app-assistant-tab-btn ${activeTab === "chat" ? "active" : ""}`}
          onClick={() => setActiveTab("chat")}
        >
          💬 Chat & Actions
        </button>
        <button
          type="button"
          className={`app-assistant-tab-btn ${activeTab === "context" ? "active" : ""}`}
          onClick={() => setActiveTab("context")}
        >
          🌐 App State {activeContext ? "•" : ""}
        </button>
        <button
          type="button"
          className={`app-assistant-tab-btn ${activeTab === "bridge" ? "active" : ""}`}
          onClick={() => setActiveTab("bridge")}
        >
          ⚡ Bridge Feed ({bridgeEvents.length})
        </button>
      </div>

      {/* Tab 1: Chat Feed */}
      {activeTab === "chat" && (
        <div className="app-assistant-content-pane">
          {/* Quick Action Chips */}
          <div className="app-assistant-chips">
            <button
              type="button"
              className="app-assistant-chip"
              onClick={() =>
                onSendMessage(
                  `Inspect the current ${appName} screen and suggest the next best automated steps.`
                )
              }
            >
              🔍 Analyze Current Screen
            </button>
            <button
              type="button"
              className="app-assistant-chip"
              onClick={() =>
                onSendMessage(
                  `Extract key data records, tables, and IDs currently visible in ${appName}.`
                )
              }
            >
              📊 Extract App Data
            </button>
            <button
              type="button"
              className="app-assistant-chip"
              onClick={() =>
                onSendMessage(
                  `Verify backend connectivity, webhook status, and API health for ${appName}.`
                )
              }
            >
              ⚡ Check Health
            </button>
          </div>

          <div className="app-assistant-messages">
            <div className="app-assistant-bubble system">
              <span className="app-bubble-sender">SYSTEM</span>
              <div style={{ fontSize: "12px", lineHeight: "1.4" }}>
                Agent Assistant initialized. You are collaborating with{" "}
                <strong>{selectedAgent?.name || "Agent"}</strong> inside the{" "}
                <strong>{appName}</strong> canvas. Type an instruction or trigger actions directly from the app.
              </div>
            </div>

            {bridgeEvents
              .filter((ev) => ev.action === "TRIGGER_AGENT" || ev.action === "AGENT_EVENT")
              .map((ev, i) => (
                <div
                  key={i}
                  className={`app-assistant-bubble ${
                    ev.action === "TRIGGER_AGENT" ? "user" : "agent"
                  }`}
                >
                  <span className="app-bubble-sender">
                    {ev.action === "TRIGGER_AGENT" ? "APP TRIGGER" : selectedAgent?.name || "AGENT"}
                  </span>
                  <div style={{ fontSize: "12px", lineHeight: "1.45" }}>
                    {ev.action === "TRIGGER_AGENT"
                      ? ev.payload?.input || "Triggered Agent Action"
                      : ev.payload?.text || JSON.stringify(ev.payload)}
                  </div>
                  <span className="app-bubble-time">
                    {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}

            {isExecuting && (
              <div className="app-assistant-bubble agent">
                <span className="app-bubble-sender">AGENT THINKING</span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
                  <div className="app-spinner-mini" />
                  <span>Processing canvas task...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input */}
          <form onSubmit={handleSubmit} className="app-assistant-input-form">
            <input
              type="text"
              placeholder={`Ask ${selectedAgent?.name || "agent"} about this app...`}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="app-assistant-input"
              disabled={isExecuting}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isExecuting || !inputText.trim()}
              style={{ padding: "6px 12px", fontSize: "13px" }}
            >
              Send
            </button>
          </form>
        </div>
      )}

      {/* Tab 2: Synced Context */}
      {activeTab === "context" && (
        <div className="app-assistant-content-pane" style={{ padding: "14px" }}>
          <div style={{ fontSize: "11px", color: "var(--sky-3)", textTransform: "uppercase", marginBottom: "8px" }}>
            Bi-Directional Synced App State
          </div>
          {activeContext ? (
            <div className="app-context-viewer">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ fontSize: "12px", color: "#4ade80", fontWeight: 600 }}>● Live Connected</span>
                <span style={{ fontSize: "11px", color: "var(--sky-3)" }}>Updated via SDK</span>
              </div>
              <pre style={{ margin: 0, fontSize: "11.5px", fontFamily: "var(--mono)", color: "var(--sky-2)", maxHeight: "360px", overflow: "auto" }}>
                {JSON.stringify(activeContext, null, 2)}
              </pre>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "30px 10px", color: "var(--sky-3)", fontSize: "12px" }}>
              <div style={{ fontSize: "28px", marginBottom: "8px" }}>📡</div>
              <div>No state pushed yet from {appName}.</div>
              <div style={{ fontSize: "11px", marginTop: "6px", color: "var(--sky-3)" }}>
                Use <code>AgentStudioBridge.sendContext(...)</code> inside your web app to push selected entities, filters, or active views here.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Bridge Activity Log */}
      {activeTab === "bridge" && (
        <div className="app-assistant-content-pane" style={{ padding: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <span style={{ fontSize: "11px", color: "var(--sky-3)", textTransform: "uppercase" }}>
              PostMessage Event Log
            </span>
            <span style={{ fontSize: "11px", color: "#38bdf8" }}>{bridgeEvents.length} events</span>
          </div>

          {bridgeEvents.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 10px", color: "var(--sky-3)", fontSize: "12px" }}>
              No bridge messages detected yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {bridgeEvents.map((ev, index) => (
                <div key={index} className="app-bridge-event-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <span className={`app-bridge-tag ${ev.action}`}>
                      {ev.action}
                    </span>
                    <span style={{ fontSize: "10.5px", color: "var(--sky-3)" }}>
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <pre style={{ margin: 0, fontSize: "11px", fontFamily: "var(--mono)", color: "var(--sky-2)", maxHeight: "100px", overflow: "auto" }}>
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
