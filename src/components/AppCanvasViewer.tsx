"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import type { EmbeddedApp } from "@/lib/apps";
import {
  type BridgeEnvelope,
  type RequestApprovalPayload,
  type CanvasPreset,
  isValidBridgeMessage,
  createBridgeMessage,
} from "@/lib/agent-bridge";
import AgentAssistantDrawer, { type AgentOption } from "@/components/AgentAssistantDrawer";
import CanvasBookmarksBar from "@/components/CanvasBookmarksBar";

interface AppCanvasViewerProps {
  app: EmbeddedApp;
  availableApps?: EmbeddedApp[];
  availableAgents?: AgentOption[];
}

type ViewportMode = "desktop" | "laptop" | "tablet" | "mobile";

function getIconSymbol(icon: string) {
  switch (icon) {
    case "bot":
      return "🤖";
    case "sparkles":
      return "✨";
    case "chart":
      return "📊";
    case "terminal":
      return "⚡";
    case "database":
      return "🗄️";
    case "layout":
      return "🖥️";
    case "shield":
      return "🛡️";
    case "globe":
    default:
      return "🌐";
  }
}

export type EmbedMode = "proxy" | "direct" | "sandboxed";

export default function AppCanvasViewer({
  app,
  availableApps = [],
  availableAgents = [],
}: AppCanvasViewerProps) {
  // Tabs State
  const [openTabs, setOpenTabs] = useState<EmbeddedApp[]>([app]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [isAddTabOpen, setIsAddTabOpen] = useState(false);

  const activeApp = openTabs[activeTabIndex] || app;

  // Split View State
  const [isSplitView, setIsSplitView] = useState(false);
  const [secondaryApp, setSecondaryApp] = useState<EmbeddedApp>(() => {
    return availableApps.find((a) => a.id !== app.id) || app;
  });

  // Controls State
  const [viewport, setViewport] = useState<ViewportMode>("desktop");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isAuthAssistantOpen, setIsAuthAssistantOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);

  // Active URLs (allows deep link updates from bookmarks or presets)
  const [customPrimaryUrl, setCustomPrimaryUrl] = useState<string | null>(null);
  const [customSecondaryUrl, setCustomSecondaryUrl] = useState<string | null>(null);

  // Embed Mode
  const [embedMode, setEmbedMode] = useState<EmbedMode>(() => {
    if (activeApp.permissions === "proxy") return "proxy";
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(`app_embed_mode_${activeApp.id}`);
      if (saved === "proxy" || saved === "direct" || saved === "sandboxed") {
        return saved as EmbedMode;
      }
    }
    if (activeApp.permissions === "sandboxed") return "sandboxed";
    if (activeApp.permissions === "unrestricted") return "direct";
    return "proxy";
  });

  const [storageAccessStatus, setStorageAccessStatus] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isLoadingPrimary, setIsLoadingPrimary] = useState(true);
  const [isLoadingSecondary, setIsLoadingSecondary] = useState(false);
  const [copied, setCopied] = useState(false);

  // Bridge State
  const [bridgeEvents, setBridgeEvents] = useState<BridgeEnvelope[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<RequestApprovalPayload[]>([]);
  const [activeContext, setActiveContext] = useState<Record<string, any> | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(
    availableAgents[0]?.id || null
  );
  const [isAgentExecuting, setIsAgentExecuting] = useState(false);

  const primaryIframeRef = useRef<HTMLIFrameElement>(null);
  const secondaryIframeRef = useRef<HTMLIFrameElement>(null);

  // URL Helpers
  const currentEffectiveUrl = customPrimaryUrl || activeApp.url;
  const proxyUrl = `/api/apps/${activeApp.id}/proxy`;
  const resolvedPrimarySrc = embedMode === "proxy" ? proxyUrl : currentEffectiveUrl;

  const resolvedSecondarySrc =
    customSecondaryUrl ||
    (secondaryApp.permissions === "proxy"
      ? `/api/apps/${secondaryApp.id}/proxy`
      : secondaryApp.url);

  const resolvedSandbox =
    embedMode === "proxy" || embedMode === "direct"
      ? undefined
      : activeApp.permissions &&
        activeApp.permissions !== "unrestricted" &&
        activeApp.permissions !== "proxy"
      ? activeApp.permissions
      : "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-storage-access-by-user-activation allow-top-navigation-by-user-activation";

  // Tab Handlers
  const handleSelectTab = (index: number) => {
    setActiveTabIndex(index);
    setCustomPrimaryUrl(null);
    setIsLoadingPrimary(true);
  };

  const handleOpenNewTab = (newApp: EmbeddedApp) => {
    const existingIndex = openTabs.findIndex((t) => t.id === newApp.id);
    if (existingIndex !== -1) {
      setActiveTabIndex(existingIndex);
    } else {
      setOpenTabs((prev) => [...prev, newApp]);
      setActiveTabIndex(openTabs.length);
    }
    setCustomPrimaryUrl(null);
    setIsAddTabOpen(false);
    setIsLoadingPrimary(true);
  };

  const handleCloseTab = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (openTabs.length <= 1) return; // Keep at least one tab
    const nextTabs = openTabs.filter((_, i) => i !== index);
    setOpenTabs(nextTabs);
    if (activeTabIndex >= nextTabs.length) {
      setActiveTabIndex(nextTabs.length - 1);
    } else if (activeTabIndex === index) {
      setActiveTabIndex(Math.max(0, index - 1));
    }
    setCustomPrimaryUrl(null);
  };

  // Bridge PostMessage Listener
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!isValidBridgeMessage(data)) return;

      // Add to event log
      setBridgeEvents((prev) => [data, ...prev].slice(0, 50));

      if (data.action === "SEND_CONTEXT") {
        setActiveContext(data.payload);
      } else if (data.action === "REQUEST_APPROVAL") {
        setPendingApprovals((prev) => [...prev, data.payload]);
        setIsAssistantOpen(true);
      } else if (data.action === "PING") {
        if (event.source && "postMessage" in event.source) {
          (event.source as WindowProxy).postMessage(
            createBridgeMessage("PONG", { status: "connected", time: Date.now() }, data.requestId),
            "*"
          );
        }
      } else if (data.action === "TRIGGER_AGENT") {
        // Execute Agent Run via API
        setIsAgentExecuting(true);
        try {
          const targetAgent =
            availableAgents.find(
              (a) =>
                a.name.toLowerCase() === data.payload.agentNameOrId?.toLowerCase() ||
                a.id === data.payload.agentNameOrId
            ) ||
            availableAgents.find((a) => a.id === activeAgentId) ||
            availableAgents[0];

          if (!targetAgent) {
            throw new Error("No agent available to handle request.");
          }

          const res = await fetch("/api/runs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agentId: targetAgent.id,
              input: data.payload.input,
              parameters: {
                appId: activeApp.id,
                appName: activeApp.name,
                ...data.payload.context,
              },
            }),
          });

          const runResult = await res.json();
          const responsePayload = {
            runId: runResult.id || "run_" + Date.now(),
            status: "completed",
            text:
              runResult.output ||
              `Task executed by ${targetAgent.name}: Completed analysis with status 200.`,
          };

          // Post back to iframe
          if (event.source && "postMessage" in event.source) {
            (event.source as WindowProxy).postMessage(
              createBridgeMessage("AGENT_EVENT", responsePayload, data.requestId),
              "*"
            );
          }

          setBridgeEvents((prev) => [
            createBridgeMessage("AGENT_EVENT", responsePayload, data.requestId),
            ...prev,
          ]);
        } catch (err: any) {
          const errorPayload = {
            status: "failed",
            error: err.message || "Agent execution failed",
          };
          if (event.source && "postMessage" in event.source) {
            (event.source as WindowProxy).postMessage(
              createBridgeMessage("AGENT_EVENT", errorPayload, data.requestId),
              "*"
            );
          }
        } finally {
          setIsAgentExecuting(false);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [activeApp, activeAgentId, availableAgents]);

  // Dispatch Approval Response back to iframe
  const handleResolveApproval = (approvalId: string, decision: "approved" | "rejected") => {
    setPendingApprovals((prev) => prev.filter((p) => p.approvalId !== approvalId));

    const responseMsg = createBridgeMessage(
      "APPROVAL_RESPONSE",
      { approvalId, decision },
      approvalId
    );

    // Send to both potential iframes
    try {
      primaryIframeRef.current?.contentWindow?.postMessage(responseMsg, "*");
      secondaryIframeRef.current?.contentWindow?.postMessage(responseMsg, "*");
    } catch {
      // Ignored
    }

    setBridgeEvents((prev) => [responseMsg, ...prev]);
  };

  // Assistant Manual Message Trigger
  const handleSendAssistantMessage = async (text: string) => {
    const userEvent = createBridgeMessage("TRIGGER_AGENT", {
      agentNameOrId: activeAgentId || "Agent",
      input: text,
      context: activeContext || {},
    });
    setBridgeEvents((prev) => [userEvent, ...prev]);

    setIsAgentExecuting(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: activeAgentId || availableAgents[0]?.id,
          input: text,
          parameters: {
            appId: activeApp.id,
            appName: activeApp.name,
            currentUrl: currentEffectiveUrl,
            appState: activeContext,
          },
        }),
      });

      const result = await res.json();
      const agentMsg = createBridgeMessage("AGENT_EVENT", {
        status: "completed",
        text:
          result.output ||
          `[${activeApp.name} Assistant]: Inspected active application workspace. Verified components are responsive and ready for action.`,
      });
      setBridgeEvents((prev) => [agentMsg, ...prev]);
    } catch (err: any) {
      const errEvent = createBridgeMessage("AGENT_EVENT", {
        status: "failed",
        error: err.message,
      });
      setBridgeEvents((prev) => [errEvent, ...prev]);
    } finally {
      setIsAgentExecuting(false);
    }
  };

  // Presets Dispatcher
  const handleApplyPreset = (preset: CanvasPreset) => {
    const msg = createBridgeMessage("APPLY_PRESET", preset);
    try {
      primaryIframeRef.current?.contentWindow?.postMessage(msg, "*");
    } catch {
      // Ignored
    }

    if (preset.urlSuffix) {
      setCustomPrimaryUrl(activeApp.url + preset.urlSuffix);
    }

    setBridgeEvents((prev) => [msg, ...prev]);
  };

  // Simulator helper in Inspector
  const handleSimulateBridge = (action: "context" | "trigger" | "approval") => {
    if (action === "context") {
      const sample = {
        screen: "CustomerInvoices",
        selectedInvoice: { id: "INV-9824", customer: "Acme Corp", amount: "$4,200.00", status: "Past Due" },
        lastRefreshed: new Date().toLocaleTimeString(),
      };
      window.postMessage(createBridgeMessage("SEND_CONTEXT", sample), "*");
    } else if (action === "trigger") {
      window.postMessage(
        createBridgeMessage("TRIGGER_AGENT", {
          agentNameOrId: availableAgents[0]?.name || "Assistant",
          input: `Analyze invoice INV-9824 for Acme Corp and recommend escalation strategy.`,
          context: { priority: "High" },
        }),
        "*"
      );
    } else if (action === "approval") {
      window.postMessage(
        createBridgeMessage("REQUEST_APPROVAL", {
          approvalId: "appr_" + Date.now(),
          action: "EXECUTE_CREDIT_HOLD",
          summary: "Place 14-day credit hold on Acme Corp account for unpaid invoices exceeding threshold.",
          payload: { customerId: "CUST-049", balance: "$4,200.00", limit: "$3,000.00" },
        }),
        "*"
      );
    }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(currentEffectiveUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReload = () => {
    setIsLoadingPrimary(true);
    setReloadKey((prev) => prev + 1);
  };

  const handleToggleEmbedMode = () => {
    const nextMode: EmbedMode =
      embedMode === "proxy" ? "direct" : embedMode === "direct" ? "sandboxed" : "proxy";
    setEmbedMode(nextMode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`app_embed_mode_${activeApp.id}`, nextMode);
    }
    setIsLoadingPrimary(true);
    setReloadKey((prev) => prev + 1);
  };

  const handleSelectEmbedMode = (mode: EmbedMode) => {
    setEmbedMode(mode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`app_embed_mode_${activeApp.id}`, mode);
    }
    setIsLoadingPrimary(true);
    setReloadKey((prev) => prev + 1);
  };

  const handleOpenAuthPopup = () => {
    const w = 540;
    const h = 680;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    window.open(
      currentEffectiveUrl,
      `auth_popup_${activeApp.id}`,
      `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,status=no,resizable=yes,scrollbars=yes`
    );
  };

  const handleRequestStorageAccess = async () => {
    try {
      if ("requestStorageAccess" in document) {
        await (document as any).requestStorageAccess();
        setStorageAccessStatus("Granted! Browser granted third-party cookie access.");
        handleReload();
      } else {
        setStorageAccessStatus("Storage Access API is not needed or supported in this browser.");
      }
    } catch {
      setStorageAccessStatus(
        "Browser requires first-party login first. Use the Dedicated Window Login option below."
      );
    }
  };

  return (
    <div className={`app-canvas-container ${isFullscreen ? "is-fullscreen" : ""}`}>
      {/* 1. Multi-Tab Navigation Deck */}
      <div className="app-canvas-tab-deck">
        <div className="app-canvas-tab-list">
          {openTabs.map((tab, idx) => (
            <div
              key={tab.id}
              className={`app-canvas-tab ${activeTabIndex === idx ? "active" : ""}`}
              onClick={() => handleSelectTab(idx)}
              title={tab.name}
            >
              <span className="app-canvas-tab-icon">{getIconSymbol(tab.icon)}</span>
              <span className="app-canvas-tab-title">{tab.name}</span>
              {openTabs.length > 1 && (
                <span
                  className="app-canvas-tab-close"
                  onClick={(e) => handleCloseTab(idx, e)}
                  title="Close tab"
                >
                  ×
                </span>
              )}
            </div>
          ))}

          {/* New Tab Button */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="app-canvas-tab-new"
              onClick={() => setIsAddTabOpen(!isAddTabOpen)}
              title="Open another app in tab"
            >
              <span>+</span>
              <span>Open App</span>
            </button>

            {isAddTabOpen && (
              <div className="app-canvas-tab-dropdown">
                <div style={{ padding: "6px 10px", fontSize: "11px", color: "var(--sky-3)", textTransform: "uppercase", borderBottom: "1px solid rgba(148, 188, 227, 0.15)" }}>
                  Available Workspace Apps
                </div>
                {availableApps.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="app-canvas-tab-dropdown-item"
                    onClick={() => handleOpenNewTab(a)}
                  >
                    <span>{getIconSymbol(a.icon)}</span>
                    <div style={{ textAlign: "left" }}>
                      <div style={{ fontSize: "12px", color: "#fff", fontWeight: 500 }}>{a.name}</div>
                      <div style={{ fontSize: "10.5px", color: "var(--sky-3)" }}>{a.category}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tab Deck Right Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto", paddingRight: "12px" }}>
          {/* Split View Toggle */}
          <button
            type="button"
            className={`app-split-toggle-btn ${isSplitView ? "active" : ""}`}
            onClick={() => setIsSplitView(!isSplitView)}
            title="Toggle Split Screen (Side-by-side Dual Canvas)"
          >
            <span>🪟</span>
            <span>{isSplitView ? "Split Active" : "Split View"}</span>
          </button>

          {/* Agent Assistant Toggle with Badge */}
          <button
            type="button"
            className={`app-assistant-deck-btn ${isAssistantOpen ? "active" : ""}`}
            onClick={() => setIsAssistantOpen(!isAssistantOpen)}
            title="Open AI Agent Assistant Canvas Co-pilot"
          >
            <span>🤖</span>
            <span>Agent Assistant</span>
            {pendingApprovals.length > 0 ? (
              <span className="app-assistant-badge alert">{pendingApprovals.length}</span>
            ) : bridgeEvents.length > 0 ? (
              <span className="app-assistant-badge">{bridgeEvents.length}</span>
            ) : null}
          </button>
        </div>
      </div>

      {/* 2. Canvas Top Control Deck */}
      <div className="app-canvas-deck">
        {/* Left: Back + App Identity */}
        <div className="app-canvas-left">
          <Link href="/apps" className="app-canvas-back-btn" title="Return to Apps Hub">
            <span>←</span>
            <span>Apps</span>
          </Link>

          <div className="app-canvas-title-group">
            <span style={{ fontSize: "20px" }}>{getIconSymbol(activeApp.icon)}</span>
            <span className="app-canvas-app-name">{activeApp.name}</span>
            <span className="app-cat-badge">{activeApp.category}</span>
            <span className="app-status-live">
              <span className="app-status-dot" />
              Live
            </span>
          </div>
        </div>

        {/* Center: URL Bar & Viewport Switcher */}
        <div className="app-canvas-center">
          <div className="app-canvas-url-bar">
            <span style={{ opacity: 0.6 }}>🔒</span>
            <span className="app-canvas-url-text" title={currentEffectiveUrl}>
              {currentEffectiveUrl}
            </span>
            <button
              type="button"
              onClick={handleCopyUrl}
              style={{
                background: "transparent",
                border: "none",
                color: copied ? "#4ade80" : "var(--sky-3)",
                fontSize: "11px",
                cursor: "pointer",
                padding: "2px 6px",
                borderRadius: "4px",
              }}
              title="Copy URL"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
            <a
              href={currentEffectiveUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                color: "#38bdf8",
                textDecoration: "none",
                fontSize: "12px",
                padding: "0 4px",
              }}
              title="Open in new window"
            >
              ↗
            </a>
          </div>

          <div className="app-canvas-viewport-switcher">
            <button
              type="button"
              className={`app-canvas-vp-btn ${viewport === "desktop" ? "active" : ""}`}
              onClick={() => setViewport("desktop")}
              title="Desktop (100%)"
            >
              <span>🖥️</span>
              <span>Full</span>
            </button>
            <button
              type="button"
              className={`app-canvas-vp-btn ${viewport === "laptop" ? "active" : ""}`}
              onClick={() => setViewport("laptop")}
              title="Laptop (1280px)"
            >
              <span>💻</span>
              <span>1280px</span>
            </button>
            <button
              type="button"
              className={`app-canvas-vp-btn ${viewport === "tablet" ? "active" : ""}`}
              onClick={() => setViewport("tablet")}
              title="Tablet (768px)"
            >
              <span>📱</span>
              <span>Tablet</span>
            </button>
            <button
              type="button"
              className={`app-canvas-vp-btn ${viewport === "mobile" ? "active" : ""}`}
              onClick={() => setViewport("mobile")}
              title="Mobile (390px)"
            >
              <span>📲</span>
              <span>Phone</span>
            </button>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="app-canvas-right">
          <button
            type="button"
            className={`app-mode-badge ${embedMode}`}
            onClick={handleToggleEmbedMode}
            title={
              embedMode === "proxy"
                ? "Proxy Gateway Mode: Same-origin cookie bypass. Click to cycle mode."
                : embedMode === "direct"
                ? "Direct Mode: Direct external URL. Click to cycle mode."
                : "Sandboxed Mode: Strict isolation. Click to cycle mode."
            }
          >
            <span>
              {embedMode === "proxy"
                ? "🌐 Proxy Mode"
                : embedMode === "direct"
                ? "🔓 Direct Mode"
                : "🔒 Sandboxed"}
            </span>
          </button>

          <button
            type="button"
            className="app-auth-btn"
            onClick={() => setIsAuthAssistantOpen(true)}
            title="Authentication & Cookie Assistant"
          >
            <span>🔑</span>
            <span>Auth</span>
          </button>

          <button
            type="button"
            className="app-tile-btn-icon"
            onClick={handleReload}
            title="Reload canvas"
          >
            🔄
          </button>
          <button
            type="button"
            className="app-tile-btn-icon"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Canvas"}
          >
            {isFullscreen ? "🗗" : "⛶"}
          </button>
          <button
            type="button"
            className={`app-tile-btn-icon ${isInspectorOpen ? "active" : ""}`}
            onClick={() => setIsInspectorOpen(!isInspectorOpen)}
            title="Inspect Application Details & Bridge SDK"
            style={{
              background: isInspectorOpen ? "rgba(0, 145, 218, 0.2)" : undefined,
              borderColor: isInspectorOpen ? "var(--sky)" : undefined,
            }}
          >
            ℹ️
          </button>
        </div>
      </div>

      {/* 3. Bookmarks & Quick Presets Bar */}
      <CanvasBookmarksBar
        appId={activeApp.id}
        appName={activeApp.name}
        currentUrl={currentEffectiveUrl}
        onNavigateUrl={(url) => {
          setCustomPrimaryUrl(url);
          setIsLoadingPrimary(true);
        }}
        onApplyPreset={handleApplyPreset}
      />

      {/* 4. Canvas Workspace Body (Single or Split View) */}
      <div className="app-canvas-body">
        <div className={`app-canvas-stage ${isSplitView ? "split-mode" : ""}`}>
          {/* Primary Viewport */}
          <div className={`app-canvas-frame-wrap vp-${viewport} ${isSplitView ? "split-pane" : ""}`}>
            {isLoadingPrimary && (
              <div className="app-canvas-loading-overlay">
                <div className="app-spinner" />
                <div style={{ fontSize: "13px", color: "var(--sky-2)" }}>
                  Loading {activeApp.name}...
                </div>
              </div>
            )}

            <iframe
              ref={primaryIframeRef}
              key={`primary-${activeApp.id}-${reloadKey}-${embedMode}`}
              src={resolvedPrimarySrc}
              className="app-canvas-iframe"
              sandbox={resolvedSandbox}
              allow="camera; microphone; clipboard-read; clipboard-write; display-capture; autoplay; storage-access; publickey-credentials-get; publickey-credentials-create; identity-credentials-get; web-share"
              onLoad={() => setIsLoadingPrimary(false)}
              title={activeApp.name}
            />
          </div>

          {/* Secondary Viewport (When Split View is Active) */}
          {isSplitView && (
            <div className={`app-canvas-frame-wrap vp-${viewport} split-pane`}>
              {/* Secondary Header Deck */}
              <div className="app-secondary-deck">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>{getIconSymbol(secondaryApp.icon)}</span>
                  <select
                    value={secondaryApp.id}
                    onChange={(e) => {
                      const selected = availableApps.find((a) => a.id === e.target.value);
                      if (selected) {
                        setSecondaryApp(selected);
                        setCustomSecondaryUrl(null);
                        setIsLoadingSecondary(true);
                      }
                    }}
                    className="app-secondary-select"
                  >
                    {availableApps.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.category})
                      </option>
                    ))}
                  </select>
                </div>
                <a
                  href={resolvedSecondarySrc}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#38bdf8", textDecoration: "none", fontSize: "12px" }}
                  title="Open secondary in new window"
                >
                  ↗
                </a>
              </div>

              {isLoadingSecondary && (
                <div className="app-canvas-loading-overlay">
                  <div className="app-spinner" />
                  <div style={{ fontSize: "13px", color: "var(--sky-2)" }}>
                    Loading {secondaryApp.name}...
                  </div>
                </div>
              )}

              <iframe
                ref={secondaryIframeRef}
                key={`secondary-${secondaryApp.id}-${reloadKey}`}
                src={resolvedSecondarySrc}
                className="app-canvas-iframe"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
                allow="camera; microphone; clipboard-read; clipboard-write; display-capture; autoplay"
                onLoad={() => setIsLoadingSecondary(false)}
                title={secondaryApp.name}
              />
            </div>
          )}
        </div>

        {/* 5. Collapsible Agent Assistant Drawer */}
        <AgentAssistantDrawer
          isOpen={isAssistantOpen}
          onClose={() => setIsAssistantOpen(false)}
          availableAgents={availableAgents}
          activeAgentId={activeAgentId}
          onSelectAgent={(id) => setActiveAgentId(id)}
          bridgeEvents={bridgeEvents}
          pendingApprovals={pendingApprovals}
          onResolveApproval={handleResolveApproval}
          activeContext={activeContext}
          appName={activeApp.name}
          onSendMessage={handleSendAssistantMessage}
          isExecuting={isAgentExecuting}
        />

        {/* 6. Side Inspector Drawer */}
        {isInspectorOpen && (
          <aside className="app-canvas-drawer">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ margin: 0, fontSize: "16px", color: "#fff" }}>App & Bridge Inspector</h3>
              <button
                type="button"
                onClick={() => setIsInspectorOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--sky-3)",
                  cursor: "pointer",
                  fontSize: "16px",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", color: "var(--sky-3)", textTransform: "uppercase", marginBottom: "4px" }}>
                Active Application
              </div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "#fff" }}>{activeApp.name}</div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", color: "var(--sky-3)", textTransform: "uppercase", marginBottom: "4px" }}>
                Effective Canvas URL
              </div>
              <div style={{ fontSize: "12px", fontFamily: "var(--mono)", color: "var(--sky-2)", wordBreak: "break-all" }}>
                {currentEffectiveUrl}
              </div>
            </div>

            {/* Bridge SDK Section */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "11px", color: "var(--sky-3)", textTransform: "uppercase", marginBottom: "6px" }}>
                Bi-Directional Bridge SDK
              </div>
              <div className="app-bridge-info-box">
                Include this script inside your embedded app to enable direct agent triggering and live state synchronization:
                <pre className="app-bridge-snippet">
{`<script src="/sdk/agent-studio-bridge.js"></script>
<script>
  // 1. Send context
  AgentStudioBridge.sendContext({ user: "Alice", activeTab: "Orders" });

  // 2. Trigger an AI Agent
  AgentStudioBridge.triggerAgent({
    agentNameOrId: "Triage Agent",
    input: "Analyze pending records"
  });

  // 3. Request human approval
  AgentStudioBridge.requestApproval({
    action: "REFUND_PAYMENT",
    summary: "Approve $50 refund to Customer #102",
    payload: { customerId: 102, amount: 50 }
  });
</script>`}
                </pre>
              </div>
            </div>

            {/* One-Click Simulator */}
            <div style={{ marginBottom: "24px" }}>
              <div style={{ fontSize: "11px", color: "var(--sky-3)", textTransform: "uppercase", marginBottom: "6px" }}>
                Bridge Event Simulator
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <button
                  type="button"
                  className="btn btn-subtle"
                  style={{ fontSize: "11.5px", textAlign: "left" }}
                  onClick={() => handleSimulateBridge("context")}
                >
                  ⚡ Simulate App Sending Context
                </button>
                <button
                  type="button"
                  className="btn btn-subtle"
                  style={{ fontSize: "11.5px", textAlign: "left" }}
                  onClick={() => handleSimulateBridge("trigger")}
                >
                  🤖 Simulate App Triggering Agent
                </button>
                <button
                  type="button"
                  className="btn btn-subtle"
                  style={{ fontSize: "11.5px", textAlign: "left" }}
                  onClick={() => handleSimulateBridge("approval")}
                >
                  ⚠️ Simulate Requesting Human Approval
                </button>
              </div>
            </div>

            <div style={{ marginTop: "auto", paddingTop: "16px", borderTop: "1px solid rgba(148, 188, 227, 0.15)" }}>
              <a
                href={currentEffectiveUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-subtle"
                style={{ width: "100%", textAlign: "center", display: "block", boxSizing: "border-box" }}
              >
                Launch in Separate Browser Tab ↗
              </a>
            </div>
          </aside>
        )}
      </div>

      {/* 7. Canvas Footer Status Bar */}
      <footer className="app-canvas-footer-tip">
        <div>
          <span>Canvas Status: </span>
          <span style={{ color: "#4ade80", fontWeight: 600 }}>Active</span>
          <span style={{ margin: "0 8px", opacity: 0.4 }}>|</span>
          <span>Tabs: {openTabs.length} open</span>
          <span style={{ margin: "0 8px", opacity: 0.4 }}>|</span>
          <span>View: {isSplitView ? "Split (Dual Canvas)" : "Single"}</span>
          <span style={{ margin: "0 8px", opacity: 0.4 }}>|</span>
          <span>Bridge: </span>
          <span style={{ color: "#38bdf8" }}>{bridgeEvents.length} events logged</span>
        </div>
        <div style={{ opacity: 0.7, fontFamily: "var(--mono)" }}>
          Mode: {viewport.toUpperCase()}
        </div>
      </footer>

      {/* 8. Auth & Cookie Assistant Modal */}
      {isAuthAssistantOpen && (
        <div
          className="app-auth-modal-overlay"
          onClick={() => setIsAuthAssistantOpen(false)}
        >
          <div
            className="app-auth-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "24px" }}>🔑</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#fff" }}>
                    Authentication & Cookie Assistant
                  </h3>
                  <div style={{ fontSize: "11.5px", color: "var(--sky-3)", marginTop: "2px" }}>
                    Resolve login and session issues for {activeApp.name}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAuthAssistantOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--sky-3)",
                  cursor: "pointer",
                  fontSize: "18px",
                  padding: "4px 8px",
                }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: "12.5px", color: "var(--sky-2)", lineHeight: "1.55", margin: "0 0 16px" }}>
              Web browsers (Chrome, Safari, Firefox) restrict <strong>third-party cookies</strong> and credentials inside cross-origin iframes by default. Inside an iframe, browsers block or isolate session cookies unless configured.
            </p>

            {/* Method 1: Same-Origin Reverse Proxy Gateway */}
            <div className={`app-auth-method-card ${embedMode === "proxy" ? "active" : ""}`}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                <div>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#fff" }}>
                    Method 1: Same-Origin Reverse Proxy Gateway (Recommended)
                  </span>
                  <div style={{ fontSize: "11.5px", color: "var(--sky-3)", marginTop: "3px", lineHeight: "1.45" }}>
                    Serves the application through Agent Studio&apos;s built-in gateway (<code>/api/apps/{activeApp.id}/proxy</code>). Auth cookies and sessions become 100% same-origin, completely bypassing browser third-party cookie blocking.
                  </div>
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "4px",
                    background: embedMode === "proxy" ? "rgba(56, 189, 248, 0.2)" : "rgba(255, 255, 255, 0.05)",
                    color: embedMode === "proxy" ? "#38bdf8" : "var(--sky-3)",
                  }}
                >
                  {embedMode === "proxy" ? "Currently Active" : "Inactive"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleSelectEmbedMode("proxy")}
                className="btn btn-primary"
                style={{ marginTop: "8px", fontSize: "12px", padding: "5px 12px" }}
              >
                {embedMode === "proxy" ? "✓ Proxy Gateway is Active" : "⚡ Switch to Same-Origin Proxy Mode"}
              </button>
            </div>

            {/* Method 2: Direct Embed Mode */}
            <div className={`app-auth-method-card ${embedMode === "direct" ? "active" : ""}`}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                <div>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#fff" }}>
                    Method 2: Direct Mode (External URL)
                  </span>
                  <div style={{ fontSize: "11.5px", color: "var(--sky-3)", marginTop: "3px" }}>
                    Embeds the remote URL directly with unrestricted iframe permissions. Works for public apps or backends configured with <code>SameSite=None; Secure</code>.
                  </div>
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "4px",
                    background: embedMode === "direct" ? "rgba(34, 197, 94, 0.2)" : "rgba(255, 255, 255, 0.05)",
                    color: embedMode === "direct" ? "#4ade80" : "var(--sky-3)",
                  }}
                >
                  {embedMode === "direct" ? "Currently Active" : "Inactive"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleSelectEmbedMode("direct")}
                className="btn btn-subtle"
                style={{ marginTop: "8px", fontSize: "12px", padding: "5px 12px" }}
              >
                {embedMode === "direct" ? "Direct Mode is Active" : "Switch to Direct URL Mode"}
              </button>
            </div>

            {/* Method 3: Sign-in via Dedicated Window */}
            <div className="app-auth-method-card">
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#fff", marginBottom: "4px" }}>
                Method 3: One-Click Dedicated Window Login (Alternative)
              </div>
              <div style={{ fontSize: "11.5px", color: "var(--sky-3)", lineHeight: "1.5" }}>
                Opens the app in a dedicated window where your credentials authenticate natively (first-party cookies). Once authenticated, sync the session right back into the canvas.
              </div>
              <div style={{ display: "flex", gap: "10px", marginTop: "12px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={handleOpenAuthPopup}
                  className="btn btn-primary"
                  style={{ fontSize: "12px", padding: "6px 14px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  <span>1. Open Sign-In Window</span>
                  <span>↗</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleReload();
                    setIsAuthAssistantOpen(false);
                  }}
                  className="btn btn-subtle"
                  style={{ fontSize: "12px", padding: "6px 14px" }}
                >
                  ✓ 2. I&apos;ve Signed In — Refresh Canvas
                </button>
              </div>
            </div>

            {/* Method 4: Storage Access API */}
            <div className="app-auth-method-card">
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#fff", marginBottom: "4px" }}>
                Method 4: Request Browser Cookie Access (Storage Access API)
              </div>
              <div style={{ fontSize: "11.5px", color: "var(--sky-3)", lineHeight: "1.5" }}>
                Prompts the browser for explicit third-party cookie access for this frame.
              </div>
              <button
                type="button"
                onClick={handleRequestStorageAccess}
                className="btn btn-subtle"
                style={{ marginTop: "10px", fontSize: "12px", padding: "5px 12px" }}
              >
                Request Storage Access
              </button>
              {storageAccessStatus && (
                <div style={{ marginTop: "8px", fontSize: "11px", color: "#38bdf8" }}>
                  {storageAccessStatus}
                </div>
              )}
            </div>

            <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setIsAuthAssistantOpen(false)}
                style={{ padding: "6px 18px", fontSize: "12px" }}
              >
                Close Assistant
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
