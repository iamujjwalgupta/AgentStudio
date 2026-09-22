"use client";

import { useState, useEffect } from "react";

interface WebhookRecord {
  id: string;
  event_type: string;
  payload: any;
  headers: any;
  status: string;
  created_at: string;
}

interface Props {
  connectionId: string;
  connectionName: string;
}

export default function WebhookListenerPanel({ connectionId, connectionName }: Props) {
  const [webhooks, setWebhooks] = useState<WebhookRecord[]>([]);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [simEvent, setSimEvent] = useState("issue.created");
  const [showSecret, setShowSecret] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [expandedPayloadId, setExpandedPayloadId] = useState<string | null>(null);

  // Derive webhook URL using current origin
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const webhookUrl = `${origin || "https://your-studio.com"}/api/webhooks/${connectionId}`;

  async function loadWebhooks() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/connections/${connectionId}/webhooks`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to load webhook listener details");
      setWebhooks(j.webhooks || []);
      setWebhookSecret(j.webhookSecret || "whsec_live_default");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWebhooks();
  }, [connectionId]);

  async function handleCopy(text: string, isSecret = false) {
    if (navigator?.clipboard) {
      await navigator.clipboard.writeText(text);
      if (isSecret) {
        setCopiedSecret(true);
        setTimeout(() => setCopiedSecret(false), 2000);
      } else {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
      }
    }
  }

  async function handleSimulate() {
    setSimulating(true);
    setError("");
    try {
      const res = await fetch(`/api/connections/${connectionId}/webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: simEvent,
          payload: {
            event: simEvent,
            timestamp: new Date().toISOString(),
            source: connectionName,
            data: {
              id: `rec_${Math.floor(Math.random() * 100000)}`,
              title: `Automated event triggered from ${connectionName}`,
              actor: "Agent Studio Inbound Webhook Listener",
            },
          },
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to simulate webhook");
      if (j.webhook) {
        setWebhooks([j.webhook, ...webhooks]);
        setExpandedPayloadId(j.webhook.id);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div className="webhook-panel-wrap">
      <div className="webhook-panel-header">
        <div>
          <h4 className="webhook-panel-title">Inbound Webhook Listener & Event Triggers</h4>
          <p className="webhook-panel-subtitle">
            Configure third-party events to stream into Agent Studio and trigger agents automatically
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: "4px 8px" }}
          onClick={loadWebhooks}
          disabled={loading}
        >
          ↻ Refresh
        </button>
      </div>

      {error && <div className="error" style={{ marginBottom: 12, fontSize: 12 }}>{error}</div>}

      {/* Webhook Endpoint Display */}
      <div className="webhook-endpoint-box">
        <label className="webhook-box-label">Inbound Webhook URL</label>
        <div className="webhook-copy-row">
          <input
            type="text"
            readOnly
            value={webhookUrl}
            className="input mono"
            style={{ fontSize: 12, background: "#f8fafc" }}
          />
          <button
            type="button"
            className="btn"
            style={{ fontSize: 12, whiteSpace: "nowrap" }}
            onClick={() => handleCopy(webhookUrl, false)}
          >
            {copiedUrl ? "✓ Copied!" : "Copy URL"}
          </button>
        </div>
        <span className="webhook-help-note">
          Paste this URL into the webhook configuration of {connectionName} (e.g. GitHub Webhooks, Slack Events API).
        </span>
      </div>

      {/* Signing Secret */}
      <div className="webhook-endpoint-box" style={{ marginTop: 12 }}>
        <label className="webhook-box-label">Signing Secret (HMAC-SHA256)</label>
        <div className="webhook-copy-row">
          <input
            type={showSecret ? "text" : "password"}
            readOnly
            value={webhookSecret}
            className="input mono"
            style={{ fontSize: 12, background: "#f8fafc" }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            onClick={() => setShowSecret(!showSecret)}
          >
            {showSecret ? "Hide" : "Reveal"}
          </button>
          <button
            type="button"
            className="btn"
            style={{ fontSize: 12, whiteSpace: "nowrap" }}
            onClick={() => handleCopy(webhookSecret, true)}
          >
            {copiedSecret ? "✓ Copied!" : "Copy"}
          </button>
        </div>
      </div>

      {/* Simulator Toolbar */}
      <div className="webhook-sim-box">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#374151" }}>Simulate Event:</span>
          <select
            className="input"
            value={simEvent}
            onChange={(e) => setSimEvent(e.target.value)}
            style={{ fontSize: 12, padding: "5px 10px", width: "auto" }}
          >
            <option value="issue.created">issue.created</option>
            <option value="message.posted">message.posted</option>
            <option value="record.updated">record.updated</option>
            <option value="pull_request.opened">pull_request.opened</option>
            <option value="custom.ping">custom.ping</option>
          </select>
          <button
            type="button"
            className="btn btn-primary"
            style={{ fontSize: 12, padding: "6px 14px" }}
            onClick={handleSimulate}
            disabled={simulating}
          >
            {simulating ? "Sending…" : "Trigger Test Webhook"}
          </button>
        </div>
      </div>

      {/* Event Deliveries Log */}
      <div className="webhook-log-section">
        <h5 className="webhook-log-heading">Recent Inbound Deliveries ({webhooks.length})</h5>

        {loading ? (
          <div className="webhook-loading">Loading webhook events…</div>
        ) : webhooks.length === 0 ? (
          <div className="webhook-empty-log">
            No incoming webhooks received yet. Use the simulator above or configure the webhook URL in {connectionName}.
          </div>
        ) : (
          <div className="webhook-table-wrap">
            <table className="webhook-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Event Type</th>
                  <th>Received</th>
                  <th style={{ textAlign: "right" }}>Payload</th>
                </tr>
              </thead>
              <tbody>
                {webhooks.map((w) => {
                  const isExpanded = expandedPayloadId === w.id;
                  return (
                    <tr key={w.id}>
                      <td>
                        <span className="webhook-status-badge">
                          ✓ 200 OK
                        </span>
                      </td>
                      <td className="mono" style={{ fontWeight: 600, color: "#111827" }}>
                        {w.event_type}
                      </td>
                      <td style={{ color: "#6b7280", fontSize: 12 }}>
                        {new Date(w.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: "2px 8px" }}
                          onClick={() => setExpandedPayloadId(isExpanded ? null : w.id)}
                        >
                          {isExpanded ? "Hide JSON" : "View JSON"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Expanded Payload Viewer */}
            {expandedPayloadId && (() => {
              const activeRec = webhooks.find((w) => w.id === expandedPayloadId);
              if (!activeRec) return null;
              return (
                <div className="webhook-payload-viewer">
                  <div className="webhook-payload-viewer-head">
                    <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                      Payload: {activeRec.event_type}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11, padding: "2px 6px" }}
                      onClick={() => setExpandedPayloadId(null)}
                    >
                      ✕ Close
                    </button>
                  </div>
                  <pre className="webhook-payload-pre">
                    {JSON.stringify(activeRec.payload, null, 2)}
                  </pre>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
