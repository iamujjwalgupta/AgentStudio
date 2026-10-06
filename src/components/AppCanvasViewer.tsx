"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { EmbeddedApp } from "@/lib/apps";
import {
  type BridgeEnvelope,
  type RequestApprovalPayload,
  type CanvasPreset,
  isValidBridgeMessage,
  createBridgeMessage,
} from "@/lib/agent-bridge";
import AgentAssistantDrawer, { type AgentOption, type AssistantMessage } from "@/components/AgentAssistantDrawer";
import { AppTile, MODES, SANDBOX_DEFAULT, hostOf, modeOf, type EmbedMode } from "@/components/apps/AppVisuals";
import { ArrowLeftIcon, CheckIcon, ChevronIcon, CopyIcon, CrossIcon, SparkIcon } from "@/components/agent-ui";

export type { EmbedMode };

interface AppCanvasViewerProps {
  app: EmbeddedApp;
  availableApps?: EmbeddedApp[];
  availableAgents?: AgentOption[];
}

type ViewportMode = "desktop" | "laptop" | "tablet" | "mobile";
const VIEWPORTS: { id: ViewportMode; label: string; path: string }[] = [
  { id: "desktop", label: "Full width", path: "M3 5h18v11H3zM8 20h8M12 16v4" },
  { id: "laptop", label: "Laptop · 1280px", path: "M5 6h14v9H5zM2 18h20" },
  { id: "tablet", label: "Tablet · 768px", path: "M6 3h12v18H6zM11 18h2" },
  { id: "mobile", label: "Phone · 390px", path: "M8 3h8v18H8zM11 18h2" },
];

const I = ({ d, size = 15 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const ICON = {
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
  newTab: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  reload: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  shrink: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
  code: "M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14",
  key: "M14.5 9.5a4 4 0 1 0-4 4l-1 1H8v1.5H6.5V17H5v-2l5.5-5.5M16 8h.01",
};

/**
 * Settings an app can be sent over the bridge. They only do something in an app
 * that listens for APPLY_PRESET, so they sit with the developer tools.
 */
const PRESETS: CanvasPreset[] = [
  { id: "preset-dark-mode", name: "Dark mode", description: "Ask the app to switch to dark mode", parameters: { theme: "dark", highContrast: false } },
  { id: "preset-test-data", name: "Test data", description: "Ask the app to load its sample or test data", parameters: { mode: "sandbox", mockData: true, tenant: "qa-team" } },
  { id: "preset-live-stream", name: "Refresh every 5s", description: "Ask the app to refresh its data every five seconds", parameters: { pollIntervalMs: 5000, streamingEnabled: true } },
];

const TERMINAL = new Set(["completed", "failed", "cancelled", "rejected", "stopped", "error", "succeeded"]);
const uid = () => Math.random().toString(36).slice(2, 10);

export default function AppCanvasViewer({ app, availableApps = [], availableAgents = [] }: AppCanvasViewerProps) {
  // The app on screen; kept in state so a saved loading setting shows at once.
  const [activeApp, setActiveApp] = useState<EmbeddedApp>(app);

  // ---- layout ----------------------------------------------------------------------
  const [viewport, setViewport] = useState<ViewportMode>("desktop");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const [modeMenu, setModeMenu] = useState(false);

  const [customPrimaryUrl, setCustomPrimaryUrl] = useState<string | null>(null);
  // The app's own setting decides how it loads. A different choice from the menu
  // applies to this visit only, unless it is saved as the app's setting.
  const savedMode = modeOf(activeApp.permissions);
  const [embedMode, setEmbedMode] = useState<EmbedMode>(savedMode);
  const [savingMode, setSavingMode] = useState(false);
  useEffect(() => {
    setEmbedMode(modeOf(activeApp.permissions));
  }, [activeApp.id, activeApp.permissions]);
  // Earlier versions remembered a menu choice per app in the browser, and it
  // overrode the app's setting. Those leftovers are cleared.
  useEffect(() => {
    try {
      for (const a of [app, ...availableApps]) window.localStorage.removeItem(`app_embed_mode_${a.id}`);
    } catch {}
  }, [app, availableApps]);
  const [storageAccessStatus, setStorageAccessStatus] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingPrimary, setLoadingPrimary] = useState(true);
  const [slowPrimary, setSlowPrimary] = useState(false);
  const [copied, setCopied] = useState("");

  // ---- bridge and assistant ------------------------------------------------------
  const [bridgeEvents, setBridgeEvents] = useState<BridgeEnvelope[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<RequestApprovalPayload[]>([]);
  const [activeContext, setActiveContext] = useState<Record<string, any> | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(availableAgents[0]?.id || null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [running, setRunning] = useState(0);

  const primaryIframeRef = useRef<HTMLIFrameElement>(null);
  const contextRef = useRef(activeContext);
  contextRef.current = activeContext;

  const currentEffectiveUrl = customPrimaryUrl || activeApp.url;
  const proxyUrl = `/api/apps/${activeApp.id}/proxy`;
  const resolvedPrimarySrc = embedMode === "proxy" ? proxyUrl : currentEffectiveUrl;
  const resolvedSandbox =
    embedMode !== "sandboxed"
      ? undefined
      : activeApp.permissions && activeApp.permissions !== "unrestricted" && activeApp.permissions !== "proxy"
        ? activeApp.permissions
        : SANDBOX_DEFAULT;

  // A frame that has not loaded after a while is usually one that refuses to be embedded.
  useEffect(() => {
    setSlowPrimary(false);
    if (!loadingPrimary) return;
    const t = setTimeout(() => setSlowPrimary(true), 12000);
    return () => clearTimeout(t);
  }, [loadingPrimary, reloadKey, activeApp.id, embedMode]);

  const log = (m: BridgeEnvelope) => setBridgeEvents((prev) => [m, ...prev].slice(0, 80));

  // ---- running an agent ------------------------------------------------------------
  /**
   * Starts a real run and follows it to the end, updating the agent's line in
   * the conversation. What the app has shared goes into the input, since that is
   * the only way the agent learns about it.
   */
  const askAgent = useCallback(
    async (agentId: string | undefined, text: string, extra?: Record<string, any>) => {
      const agent = availableAgents.find((a) => a.id === agentId) || availableAgents[0];
      const lineId = uid();
      const set = (patch: Partial<AssistantMessage>) => setMessages((prev) => prev.map((m) => (m.id === lineId ? { ...m, ...patch } : m)));
      if (!agent) {
        setMessages((prev) => [...prev, { id: lineId, from: "agent", text: "There is no agent in this workspace to ask.", at: new Date().toISOString(), status: "failed" }]);
        return { status: "failed", error: "No agent available." };
      }
      setMessages((prev) => [...prev, { id: lineId, from: "agent", agentName: agent.name, text: "Starting a run…", at: new Date().toISOString(), status: "running" }]);
      setRunning((n) => n + 1);
      const shared = { ...(contextRef.current || {}), ...(extra || {}) };
      const input =
        `${text}\n\n---\nAsked from the app “${activeApp.name}” (${currentEffectiveUrl}).` +
        (Object.keys(shared).length ? `\nWhat the app shared:\n\`\`\`json\n${JSON.stringify(shared, null, 2)}\n\`\`\`` : "");
      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: agent.id, input }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.runId) throw new Error(j.error || `The run could not be started (HTTP ${res.status}).`);
        const runId: string = j.runId;
        set({ runId, text: "Working on it…" });
        const deadline = Date.now() + 5 * 60_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          const r = await fetch(`/api/runs/${runId}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
          const run = r?.run;
          if (!run) continue;
          if (run.status === "awaiting_approval") {
            set({ status: "waiting", text: "Waiting for an approval before it can carry on. Decide it under Approvals, or open the run." });
            return { runId, status: "awaiting_approval" };
          }
          if (TERMINAL.has(run.status)) {
            const ok = run.status === "completed" || run.status === "succeeded";
            const out = String(run.output || "").trim();
            set({ status: ok ? "done" : "failed", text: ok ? out || "Finished, without a written answer. Open the run to see what it did." : `The run ${run.status}.${run.error ? ` ${run.error}` : ""}` });
            return { runId, status: run.status, text: out };
          }
        }
        set({ status: "running", text: "Still running. Open the run to follow it." });
        return { runId, status: "running" };
      } catch (e: any) {
        set({ status: "failed", text: e.message || "The run could not be started." });
        return { status: "failed", error: e.message };
      } finally {
        setRunning((n) => n - 1);
      }
    },
    [availableAgents, activeApp.name, currentEffectiveUrl],
  );

  // ---- messages from the embedded app ---------------------------------------------
  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!isValidBridgeMessage(data)) return;
      log(data);
      const reply = (m: BridgeEnvelope) => {
        if (event.source && "postMessage" in event.source) (event.source as WindowProxy).postMessage(m, "*");
      };
      if (data.action === "SEND_CONTEXT") setActiveContext(data.payload);
      else if (data.action === "REQUEST_APPROVAL") {
        setPendingApprovals((prev) => [...prev, data.payload]);
        setAssistOpen(true);
      } else if (data.action === "PING") reply(createBridgeMessage("PONG", { status: "connected", time: Date.now() }, data.requestId));
      else if (data.action === "TRIGGER_AGENT") {
        const p = data.payload || {};
        const target = availableAgents.find((a) => a.name.toLowerCase() === String(p.agentNameOrId || "").toLowerCase() || a.id === p.agentNameOrId);
        setMessages((prev) => [...prev, { id: uid(), from: "app", text: p.input || "Asked an agent to act.", at: new Date().toISOString() }]);
        setAssistOpen(true);
        const result = await askAgent(target?.id || activeAgentId || undefined, p.input || "", p.context);
        const m = createBridgeMessage("AGENT_EVENT", result, data.requestId);
        reply(m);
        log(m);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [availableAgents, activeAgentId, askAgent]);

  function resolveApproval(approvalId: string, decision: "approved" | "rejected") {
    setPendingApprovals((prev) => prev.filter((p) => p.approvalId !== approvalId));
    const m = createBridgeMessage("APPROVAL_RESPONSE", { approvalId, decision }, approvalId);
    try {
      primaryIframeRef.current?.contentWindow?.postMessage(m, "*");
    } catch {}
    log(m);
  }

  function sendFromChat(text: string) {
    setMessages((prev) => [...prev, { id: uid(), from: "you", text, at: new Date().toISOString() }]);
    askAgent(activeAgentId || undefined, text);
  }

  function applyPreset(preset: CanvasPreset) {
    const m = createBridgeMessage("APPLY_PRESET", preset);
    try {
      primaryIframeRef.current?.contentWindow?.postMessage(m, "*");
    } catch {}
    if (preset.urlSuffix) setCustomPrimaryUrl(activeApp.url + preset.urlSuffix);
    log(m);
  }

  /** Test messages, as if the embedded app had sent them — for checking the bridge without an app wired up. */
  function simulate(kind: "context" | "trigger" | "approval") {
    if (kind === "context") {
      window.postMessage(createBridgeMessage("SEND_CONTEXT", { screen: "CustomerInvoices", selectedInvoice: { id: "INV-9824", customer: "Acme Corp", amount: "$4,200.00", status: "Past due" } }), "*");
    } else if (kind === "trigger") {
      window.postMessage(createBridgeMessage("TRIGGER_AGENT", { agentNameOrId: availableAgents.find((a) => a.id === activeAgentId)?.name || availableAgents[0]?.name, input: "Review invoice INV-9824 for Acme Corp and recommend what to do next.", context: { priority: "High" } }), "*");
    } else {
      window.postMessage(createBridgeMessage("REQUEST_APPROVAL", { approvalId: `appr_${Date.now()}`, action: "EXECUTE_CREDIT_HOLD", summary: "Place a 14-day credit hold on Acme Corp for unpaid invoices over its limit.", payload: { customerId: "CUST-049", balance: "$4,200.00", limit: "$3,000.00" } }), "*");
    }
  }

  // ---- controls ----------------------------------------------------------------------
  function copy(label: string, value: string) {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    }).catch(() => {});
  }
  const reload = () => {
    setLoadingPrimary(true);
    setReloadKey((k) => k + 1);
  };
  function chooseMode(m: EmbedMode) {
    setEmbedMode(m);
    setModeMenu(false);
    reload();
  }
  /** Makes the way it is loading now the app's setting, for everyone. */
  async function saveMode() {
    const permissions =
      embedMode === "proxy" ? "proxy"
      : embedMode === "direct" ? "unrestricted"
      : activeApp.permissions && activeApp.permissions !== "proxy" && activeApp.permissions !== "unrestricted" ? activeApp.permissions : SANDBOX_DEFAULT;
    setSavingMode(true);
    try {
      const res = await fetch(`/api/apps/${activeApp.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permissions }) });
      if (res.ok) setActiveApp((a) => ({ ...a, permissions }));
    } finally {
      setSavingMode(false);
      setModeMenu(false);
    }
  }
  function openSignInWindow() {
    const w = 540;
    const h = 680;
    window.open(currentEffectiveUrl, `auth_popup_${activeApp.id}`, `width=${w},height=${h},left=${window.screenX + (window.outerWidth - w) / 2},top=${window.screenY + (window.outerHeight - h) / 2},resizable=yes,scrollbars=yes`);
  }
  async function requestStorageAccess() {
    try {
      if ("requestStorageAccess" in document) {
        await (document as any).requestStorageAccess();
        setStorageAccessStatus("Allowed. Reloading the app…");
        reload();
      } else setStorageAccessStatus("This browser doesn't need or support this step.");
    } catch {
      setStorageAccessStatus("The browser refused. Sign in through a separate window first (option 3), then try again.");
    }
  }

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (signInOpen) setSignInOpen(false);
      else if (modeMenu) setModeMenu(false);
      else if (isFullscreen) setIsFullscreen(false);
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [signInOpen, modeMenu, isFullscreen]);

  const badge = pendingApprovals.length || (running > 0 ? "…" : 0);

  return (
    <div className={`cv ${isFullscreen ? "is-fullscreen" : ""}`}>
      <div className="cv-top">
        <Link href="/apps" className="cv-back" title="Back to Apps"><ArrowLeftIcon size={13} /> Apps</Link>
        <div className="cv-title">
          <AppTile icon={activeApp.icon} category={activeApp.category} size={26} />
          <b title={activeApp.name}>{activeApp.name}</b>
        </div>
        <div className="cv-top-right">
          <button className={`cv-btn primary ${assistOpen ? "on" : ""}`} onClick={() => setAssistOpen(!assistOpen)}>
            <SparkIcon size={14} /> Ask an agent
            {badge ? <span className={`cv-badge ${pendingApprovals.length ? "alert" : ""}`}>{badge}</span> : null}
          </button>
        </div>
      </div>

      {/* ---- the app's bar ---- */}
      <div className="cv-bar">
        <div className="cv-address" title={currentEffectiveUrl}>
          <I d={ICON.lock} size={13} />
          <span className="cv-address-text"><b>{hostOf(currentEffectiveUrl)}</b>{currentEffectiveUrl.replace(/^https?:\/\/[^/]+/, "")}</span>
          <button onClick={() => copy("url", currentEffectiveUrl)} title="Copy address" aria-label="Copy address">{copied === "url" ? <CheckIcon size={12} /> : <CopyIcon size={12} />}</button>
          <a href={currentEffectiveUrl} target="_blank" rel="noreferrer" title="Open in a new browser tab" aria-label="Open in a new tab"><I d={ICON.newTab} size={13} /></a>
        </div>

        <div className="cv-mode-wrap">
          <button className={`cv-mode ${embedMode}`} onClick={() => setModeMenu(!modeMenu)} aria-expanded={modeMenu} title={MODES[embedMode].body}>
            <span className="cv-mode-dot" /> {MODES[embedMode].label}
            {embedMode !== savedMode && <em className="cv-mode-temp">this visit</em>}
            <ChevronIcon size={11} />
          </button>
          {modeMenu && (
            <div className="cv-menu" role="menu">
              <div className="cv-menu-label">How this app loads</div>
              {(Object.keys(MODES) as EmbedMode[]).map((m) => (
                <button key={m} role="menuitemradio" aria-checked={embedMode === m} className={embedMode === m ? "on" : ""} onClick={() => chooseMode(m)}>
                  <span className={`cv-mode-dot ${m}`} />
                  <span className="grow">
                    <b>{MODES[m].label}{m === savedMode && <em className="cv-saved-tag">App setting</em>}</b>
                    <span>{MODES[m].when}</span>
                  </span>
                  {embedMode === m && <CheckIcon size={12} />}
                </button>
              ))}
              {embedMode !== savedMode && (
                <div className="cv-menu-save">
                  <span>Trying <b>{MODES[embedMode].label}</b> for this visit. The app&apos;s setting is <b>{MODES[savedMode].label}</b>.</span>
                  <div>
                    <button className="btn btn-sm" onClick={() => chooseMode(savedMode)}>Undo</button>
                    <button className="btn btn-sm btn-primary" onClick={saveMode} disabled={savingMode}>{savingMode ? "Saving…" : "Save as setting"}</button>
                  </div>
                </div>
              )}
              <div className="cv-menu-sep" />
              <button onClick={() => { setModeMenu(false); setSignInOpen(true); }}>
                <I d={ICON.key} size={14} />
                <span className="grow"><b>Trouble signing in?</b><span>Ways to get past a login inside the frame</span></span>
              </button>
            </div>
          )}
        </div>

        <div className="cv-vp" role="group" aria-label="Width">
          {VIEWPORTS.map((v) => (
            <button key={v.id} className={viewport === v.id ? "on" : ""} onClick={() => setViewport(v.id)} title={v.label} aria-label={v.label} aria-pressed={viewport === v.id}><I d={v.path} size={14} /></button>
          ))}
        </div>

        <div className="cv-bar-right">
          <button className="cv-icon-btn" onClick={reload} title="Reload" aria-label="Reload"><I d={ICON.reload} /></button>
          <button className="cv-icon-btn" onClick={() => setIsFullscreen(!isFullscreen)} title={isFullscreen ? "Exit full screen (Esc)" : "Full screen"} aria-label="Full screen"><I d={isFullscreen ? ICON.shrink : ICON.expand} /></button>
          <button className={`cv-icon-btn ${devOpen ? "on" : ""}`} onClick={() => setDevOpen(!devOpen)} title="Developer: connect this app to agents" aria-label="Developer panel"><I d={ICON.code} /></button>
        </div>
      </div>

      {/* ---- the app ---- */}
      <div className="cv-body">
        <div className="cv-stage">
          <div className={`cv-frame vp-${viewport}`}>
            {loadingPrimary && (
              <div className="cv-loading">
                <span className="cv-spinner" />
                <b>Loading {activeApp.name}…</b>
                {slowPrimary && (
                  <div className="cv-slow">
                    <p>This is taking a while. Some apps refuse to be shown inside another site, or need you to sign in first.</p>
                    <div>
                      <button className="btn btn-sm" onClick={() => setSignInOpen(true)}>Sign-in help</button>
                      <button className="btn btn-sm" onClick={() => chooseMode(embedMode === "proxy" ? "direct" : "proxy")}>Try loading it {embedMode === "proxy" ? "directly" : "via Agent Studio"}</button>
                      <a className="btn btn-sm" href={currentEffectiveUrl} target="_blank" rel="noreferrer">Open in a new tab</a>
                    </div>
                  </div>
                )}
              </div>
            )}
            <iframe
              ref={primaryIframeRef}
              key={`primary-${activeApp.id}-${reloadKey}-${embedMode}-${customPrimaryUrl ?? ""}`}
              src={resolvedPrimarySrc}
              className="cv-iframe"
              sandbox={resolvedSandbox}
              allow="camera; microphone; clipboard-read; clipboard-write; display-capture; autoplay; storage-access; publickey-credentials-get; publickey-credentials-create; identity-credentials-get; web-share"
              onLoad={() => setLoadingPrimary(false)}
              title={activeApp.name}
            />
          </div>

        </div>

        <AgentAssistantDrawer
          isOpen={assistOpen}
          onClose={() => setAssistOpen(false)}
          availableAgents={availableAgents}
          activeAgentId={activeAgentId}
          onSelectAgent={setActiveAgentId}
          messages={messages}
          bridgeEvents={bridgeEvents}
          pendingApprovals={pendingApprovals}
          onResolveApproval={resolveApproval}
          activeContext={activeContext}
          appName={activeApp.name}
          onSendMessage={sendFromChat}
          isExecuting={running > 0}
        />

        {devOpen && (
          <aside className="cv-dev" aria-label="Developer panel">
            <div className="cv-assist-head">
              <span className="cv-assist-ic"><I d={ICON.code} /></span>
              <div className="grow"><b>Connect this app to agents</b><span>For the team that builds {activeApp.name}</span></div>
              <button className="cv-icon-btn" onClick={() => setDevOpen(false)} aria-label="Close"><CrossIcon size={12} /></button>
            </div>
            <div className="cv-dev-body">
              <section>
                <h4>1 · Add the bridge to the app</h4>
                <p>With this script on its pages, the app can share what&apos;s on screen, ask an agent to act, and ask a person to approve something — all shown here.</p>
                <div className="cv-code">
                  <button onClick={() => copy("sdk", SDK_SNIPPET)} title="Copy">{copied === "sdk" ? <><CheckIcon size={11} /> Copied</> : <><CopyIcon size={11} /> Copy</>}</button>
                  <pre>{SDK_SNIPPET}</pre>
                </div>
              </section>
              <section>
                <h4>2 · Try it without the app</h4>
                <p>Send the messages an app would send, to see how they appear.</p>
                <div className="cv-dev-btns">
                  <button className="btn btn-sm" onClick={() => simulate("context")}>Share sample screen data</button>
                  <button className="btn btn-sm" onClick={() => simulate("trigger")} disabled={!availableAgents.length}>Ask an agent to act</button>
                  <button className="btn btn-sm" onClick={() => simulate("approval")}>Ask for an approval</button>
                </div>
              </section>
              <section>
                <h4>3 · Send settings to the app</h4>
                <p>Only apps that listen for <code>APPLY_PRESET</code> react to these.</p>
                <div className="cv-dev-btns">
                  {PRESETS.map((p) => <button key={p.id} className="btn btn-sm" onClick={() => applyPreset(p)} title={p.description}>{p.name}</button>)}
                </div>
              </section>
              <section>
                <h4>Addresses</h4>
                <dl className="cv-dl">
                  <dt>App</dt><dd className="mono">{currentEffectiveUrl}</dd>
                  <dt>Via Agent Studio</dt><dd className="mono">{proxyUrl}</dd>
                </dl>
              </section>
            </div>
          </aside>
        )}
      </div>

      {/* ---- sign-in help ---- */}
      {signInOpen && (
        <div className="modal-back" onMouseDown={() => setSignInOpen(false)} style={{ zIndex: 10050 }}>
          <div className="panel modal cv-signin" role="dialog" aria-modal="true" aria-labelledby="cv-signin-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="eyebrow">Sign-in help</div>
            <h2 id="cv-signin-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>Getting past a login inside {activeApp.name}</h2>
            <p className="help" style={{ marginTop: 0 }}>
              Browsers often block an app&apos;s sign-in cookies when it is shown inside another site. Try these in order.
            </p>
            <ol className="cv-steps">
              <li className={embedMode === "proxy" ? "on" : ""}>
                <div className="grow">
                  <b>Load it via Agent Studio</b>
                  <span>Its cookies then count as this site&apos;s own, which gets round most blocks.</span>
                </div>
                {embedMode === "proxy" ? <span className="cv-pill ok">In use</span> : <button className="btn btn-sm btn-primary" onClick={() => { chooseMode("proxy"); setSignInOpen(false); }}>Use this</button>}
              </li>
              <li className={embedMode === "direct" ? "on" : ""}>
                <div className="grow">
                  <b>Load it directly</b>
                  <span>Works when the app&apos;s cookies are set with <code>SameSite=None; Secure</code>.</span>
                </div>
                {embedMode === "direct" ? <span className="cv-pill ok">In use</span> : <button className="btn btn-sm" onClick={() => { chooseMode("direct"); setSignInOpen(false); }}>Use this</button>}
              </li>
              <li>
                <div className="grow">
                  <b>Sign in in a separate window</b>
                  <span>Sign in there as normal, close it, then reload here.</span>
                </div>
                <div className="cv-steps-go">
                  <button className="btn btn-sm" onClick={openSignInWindow}>Open sign-in window</button>
                  <button className="btn btn-sm" onClick={() => { reload(); setSignInOpen(false); }}>I&apos;ve signed in — reload</button>
                </div>
              </li>
              <li>
                <div className="grow">
                  <b>Allow its cookies in this browser</b>
                  <span>Asks the browser to let the app use its own cookies here.</span>
                  {storageAccessStatus && <em>{storageAccessStatus}</em>}
                </div>
                <button className="btn btn-sm" onClick={requestStorageAccess}>Ask the browser</button>
              </li>
            </ol>
            <div className="panel-foot">
              <a className="btn" href={currentEffectiveUrl} target="_blank" rel="noreferrer">Open in a new tab instead</a>
              <button className="btn btn-primary" onClick={() => setSignInOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const SDK_SNIPPET = `<script src="${typeof window !== "undefined" ? window.location.origin : ""}/sdk/agent-studio-bridge.js"></script>
<script>
  // Share what is on screen
  AgentStudioBridge.sendContext({ screen: "Orders", selected: "PO-1042" });

  // Ask an agent to act
  AgentStudioBridge.triggerAgent({
    agentNameOrId: "Duplicate Payment Detector",
    input: "Check this invoice batch for duplicates"
  });

  // Ask a person to approve
  AgentStudioBridge.requestApproval({
    action: "RELEASE_PAYMENT",
    summary: "Release $12,400 to Acme Corp",
    payload: { vendor: "Acme Corp", amount: 12400 }
  });
</script>`;
