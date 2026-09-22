"use client";

import { useState, useEffect } from "react";
import { MCPTool, MCPDiscoveryResult } from "@/lib/mcp-client";

interface Props {
  connectionId: string;
  connectionName: string;
  onToolsUpdated?: (tools: MCPTool[]) => void;
}

export default function MCPSchemaBrowser({ connectionId, connectionName, onToolsUpdated }: Props) {
  const [loading, setLoading] = useState(true);
  const [discovery, setDiscovery] = useState<MCPDiscoveryResult | null>(null);
  const [error, setError] = useState("");
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [savingTool, setSavingTool] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");

  async function loadDiscovery() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/connections/${connectionId}/mcp-discover`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to introspect MCP server");
      setDiscovery(j.discovery);
      if (j.discovery?.tools?.length > 0 && !expandedTool) {
        setExpandedTool(j.discovery.tools[0].name);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load MCP tool schemas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDiscovery();
  }, [connectionId]);

  async function toggleTool(toolName: string, currentEnabled: boolean) {
    if (!discovery) return;
    setSavingTool(toolName);
    const updatedTools = discovery.tools.map((t) =>
      t.name === toolName ? { ...t, enabled: !currentEnabled } : t
    );

    try {
      const res = await fetch(`/api/connections/${connectionId}/mcp-discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tools: updatedTools }),
      });
      if (!res.ok) throw new Error("Failed to update tool state");
      setDiscovery({ ...discovery, tools: updatedTools });
      if (onToolsUpdated) onToolsUpdated(updatedTools);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingTool(null);
    }
  }

  const filteredTools = (discovery?.tools || []).filter((t) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
  });

  return (
    <div className="mcp-browser-wrap">
      {/* Header with Server Stats */}
      <div className="mcp-browser-header">
        <div>
          <h4 className="mcp-browser-title">
            MCP Tool Auto-Discovery & Schema Browser
          </h4>
          <p className="mcp-browser-subtitle">
            Tools exposed by {connectionName} via Model Context Protocol JSON-RPC
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: "4px 8px" }}
          onClick={loadDiscovery}
          disabled={loading}
        >
          {loading ? "Discovering…" : "↻ Re-discover"}
        </button>
      </div>

      {error && <div className="error" style={{ marginBottom: 12, fontSize: 12 }}>{error}</div>}

      {/* Meta Stats Bar */}
      {discovery && (
        <div className="mcp-meta-bar">
          <div className="mcp-meta-item">
            <span className="mcp-meta-label">Protocol:</span>
            <span className="mcp-meta-val mono">{discovery.protocolVersion}</span>
          </div>
          <div className="mcp-meta-item">
            <span className="mcp-meta-label">Tools:</span>
            <span className="mcp-meta-val">{discovery.tools.length} discovered</span>
          </div>
          <div className="mcp-meta-item">
            <span className="mcp-meta-label">Resources:</span>
            <span className="mcp-meta-val">{discovery.resourcesCount}</span>
          </div>
          <div className="mcp-meta-item">
            <span className="mcp-meta-label">Prompts:</span>
            <span className="mcp-meta-val">{discovery.promptsCount}</span>
          </div>
        </div>
      )}

      {/* Filter input */}
      <div style={{ marginBottom: 14 }}>
        <input
          type="text"
          className="input"
          placeholder="Filter discovered tools..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          style={{ fontSize: 12.5, padding: "6px 10px" }}
        />
      </div>

      {loading ? (
        <div className="mcp-loading-state">
          <span className="spinner" style={{ marginRight: 8 }} /> Introspecting MCP server tools & schemas…
        </div>
      ) : filteredTools.length === 0 ? (
        <div className="mcp-empty-state">
          No tools found matching your search.
        </div>
      ) : (
        <div className="mcp-tools-list">
          {filteredTools.map((tool) => {
            const isExpanded = expandedTool === tool.name;
            const isEnabled = tool.enabled !== false;

            return (
              <div
                key={tool.name}
                className={`mcp-tool-card ${isEnabled ? "enabled" : "disabled"}`}
              >
                {/* Tool Card Header */}
                <div
                  className="mcp-tool-head"
                  onClick={() => setExpandedTool(isExpanded ? null : tool.name)}
                >
                  <div className="mcp-tool-info">
                    <span className="mcp-tool-icon">⚡</span>
                    <span className="mcp-tool-name mono">{tool.name}</span>
                    <span
                      className={`mcp-tool-status-pill ${
                        isEnabled ? "active" : "inactive"
                      }`}
                    >
                      {isEnabled ? "Active" : "Disabled"}
                    </span>
                  </div>

                  <div className="mcp-tool-actions" onClick={(e) => e.stopPropagation()}>
                    <label
                      className="mcp-toggle-label"
                      title={isEnabled ? "Disable tool for agents" : "Enable tool for agents"}
                    >
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        disabled={savingTool === tool.name}
                        onChange={() => toggleTool(tool.name, isEnabled)}
                      />
                      <span className="mcp-toggle-slider" />
                    </label>
                    <button
                      type="button"
                      className="mcp-expand-btn"
                      onClick={() => setExpandedTool(isExpanded ? null : tool.name)}
                    >
                      {isExpanded ? "▲" : "▼"}
                    </button>
                  </div>
                </div>

                {/* Short blurb */}
                <p className="mcp-tool-desc">{tool.description}</p>

                {/* Expanded Details: Parameter Table & JSON Schema */}
                {isExpanded && (
                  <div className="mcp-tool-details">
                    <h5 className="mcp-details-heading">Parameters & Schema</h5>

                    {tool.parameters && tool.parameters.length > 0 ? (
                      <table className="mcp-param-table">
                        <thead>
                          <tr>
                            <th>Parameter</th>
                            <th>Type</th>
                            <th>Requirement</th>
                            <th>Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tool.parameters.map((param) => (
                            <tr key={param.name}>
                              <td className="mono" style={{ fontWeight: 600 }}>
                                {param.name}
                              </td>
                              <td className="mono" style={{ color: "#005eb8" }}>
                                {param.type}
                              </td>
                              <td>
                                <span
                                  className={`mcp-req-badge ${
                                    param.required ? "req" : "opt"
                                  }`}
                                >
                                  {param.required ? "Required" : "Optional"}
                                </span>
                              </td>
                              <td style={{ color: "#4b5563" }}>
                                {param.description || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="mcp-no-params">No input parameters required.</p>
                    )}

                    {/* Raw JSON Schema Preview */}
                    <div style={{ marginTop: 12 }}>
                      <details className="mcp-json-details">
                        <summary>View raw JSON schema</summary>
                        <pre className="mcp-json-pre">
                          {JSON.stringify(tool.inputSchema, null, 2)}
                        </pre>
                      </details>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
