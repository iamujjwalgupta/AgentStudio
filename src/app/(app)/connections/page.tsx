"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import NotificationSettings from "@/components/NotificationSettings";
import { ConnectorIcon, VerifiedBadge } from "@/components/ConnectorIcons";
import MCPSchemaBrowser from "@/components/MCPSchemaBrowser";
import WebhookListenerPanel from "@/components/WebhookListenerPanel";

export type Conn = {
  id: string;
  name: string;
  kind: string;
  config: any;
  created_at: string;
};

export interface ConnectorDef {
  id: string;
  name: string;
  category: "Productivity" | "Communication" | "Design & Content" | "Project & Engineering" | "Databases & Storage" | "AI & LLM" | "Marketing & CRM" | "Custom";
  description: string;
  verified?: boolean;
  isCustom?: boolean;
  endpoint?: string;
  supportsOAuth?: boolean;
  oauthScopes?: string[];
  secretLabel: string;
  secretHint: string;
  fields: { key: string; label: string; hint?: string; type?: string }[];
}

const CATALOG: ConnectorDef[] = [
  {
    id: "google_drive",
    name: "Google Drive",
    category: "Productivity",
    description: "Search, read, and manage Google Docs, Sheets, and files in Google Drive.",
    verified: true,
    supportsOAuth: true,
    oauthScopes: ["drive.readonly", "drive.file"],
    secretLabel: "Service Account Key or OAuth Token",
    secretHint: "Paste JSON credentials or OAuth bearer token",
    fields: [
      { key: "folderId", label: "Shared Drive or Root Folder ID (optional)", hint: "e.g. 1A2b3C4d..." },
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    category: "Communication",
    description: "Draft, send, search, and manage emails and threads with full mailbox control.",
    verified: true,
    supportsOAuth: true,
    oauthScopes: ["gmail.send", "gmail.readonly"],
    secretLabel: "Google App Password or OAuth Token",
    secretHint: "16-character app password or OAuth bearer token",
    fields: [
      { key: "email", label: "User Email Address", hint: "you@example.com" },
    ],
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    category: "Productivity",
    description: "View, schedule, and manage events, calendars, and availability effortlessly.",
    verified: true,
    supportsOAuth: true,
    oauthScopes: ["calendar.events", "calendar.readonly"],
    secretLabel: "Service Account Key or OAuth Token",
    secretHint: "OAuth bearer token or private key",
    fields: [
      { key: "calendarId", label: "Calendar ID", hint: "primary or calendar-id@group.calendar.google.com" },
    ],
  },
  {
    id: "canva",
    name: "Canva",
    category: "Design & Content",
    description: "Generate, edit, and export visual assets, presentations, and social media designs.",
    verified: true,
    supportsOAuth: true,
    oauthScopes: ["design:content:read", "design:content:write"],
    secretLabel: "Canva Connect API Key",
    secretHint: "canva_pat_…",
    fields: [
      { key: "brandKitId", label: "Brand Kit ID (optional)", hint: "bk_…" },
    ],
  },
  {
    id: "microsoft365",
    name: "Microsoft 365",
    category: "Productivity",
    description: "Access Outlook, OneDrive, Teams, and Office documents across your tenant.",
    verified: true,
    supportsOAuth: true,
    oauthScopes: ["User.Read", "Files.ReadWrite", "Mail.Send"],
    secretLabel: "Azure Client Secret",
    secretHint: "Client Secret from Azure App Registrations",
    fields: [
      { key: "tenantId", label: "Directory (Tenant) ID", hint: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
      { key: "clientId", label: "Application (Client) ID", hint: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    category: "Productivity",
    description: "Search, read, create, and organize workspace pages, databases, and wikis.",
    verified: true,
    supportsOAuth: true,
    oauthScopes: ["read_content", "update_content", "insert_content"],
    secretLabel: "Internal Integration Secret",
    secretHint: "secret_…",
    fields: [
      { key: "databaseId", label: "Default Database ID (optional)", hint: "32-character Notion database ID" },
    ],
  },
  {
    id: "figma",
    name: "Figma",
    category: "Design & Content",
    description: "Inspect designs, export assets, post comments, and track design system components.",
    verified: true,
    supportsOAuth: true,
    oauthScopes: ["files:read", "file_comments:write"],
    secretLabel: "Figma Personal Access Token",
    secretHint: "figd_…",
    fields: [
      { key: "teamId", label: "Figma Team ID (optional)", hint: "e.g. 123456789" },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    category: "Communication",
    description: "Send channel messages, monitor discussions, reply in threads, and trigger bot actions.",
    verified: true,
    supportsOAuth: true,
    oauthScopes: ["chat:write", "channels:read", "groups:read"],
    secretLabel: "Incoming Webhook URL or Bot Token",
    secretHint: "https://hooks.slack.com/services/… or xoxb-…",
    fields: [
      { key: "channel", label: "Default Channel", hint: "#general or #ops-alerts" },
    ],
  },
  {
    id: "atlassian",
    name: "Atlassian",
    category: "Project & Engineering",
    description: "Track issues, manage Jira backlogs, sprint boards, and read Confluence spaces.",
    verified: true,
    supportsOAuth: true,
    oauthScopes: ["read:jira-work", "write:jira-work"],
    secretLabel: "Atlassian API Token",
    secretHint: "Token generated from id.atlassian.com",
    fields: [
      { key: "host", label: "Atlassian Domain URL", hint: "https://your-org.atlassian.net" },
      { key: "email", label: "Account Email", hint: "service@company.com" },
      { key: "project", label: "Default Project Key (optional)", hint: "ENG" },
    ],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "Marketing & CRM",
    description: "Sync contacts, manage CRM deals, log sales activities, and automate marketing.",
    verified: true,
    supportsOAuth: true,
    oauthScopes: ["crm.objects.contacts.read", "crm.objects.deals.read"],
    secretLabel: "Private App Access Token",
    secretHint: "pat-na1-…",
    fields: [
      { key: "portalId", label: "HubSpot Portal ID (optional)", hint: "12345678" },
    ],
  },
  {
    id: "asana",
    name: "Asana",
    category: "Project & Engineering",
    description: "Manage projects, organize task boards, assign workflows, and track team milestones.",
    verified: true,
    supportsOAuth: true,
    oauthScopes: ["default"],
    secretLabel: "Personal Access Token",
    secretHint: "1/1200…:…",
    fields: [
      { key: "workspaceId", label: "Workspace ID", hint: "1234567890" },
    ],
  },
  {
    id: "linear",
    name: "Linear",
    category: "Project & Engineering",
    description: "Create issues, track cycles, manage roadmaps, and sync engineering workflows.",
    verified: true,
    supportsOAuth: true,
    oauthScopes: ["read", "write", "issues:create"],
    secretLabel: "Linear API Key",
    secretHint: "lin_api_…",
    fields: [
      { key: "teamKey", label: "Default Team Key (optional)", hint: "ENG or PROD" },
    ],
  },
  {
    id: "postgres",
    name: "PostgreSQL Database",
    category: "Databases & Storage",
    description: "Run secure read-only SQL queries or writes against your data warehouse and database.",
    verified: true,
    secretLabel: "Connection String",
    secretHint: "postgresql://user:password@host:5432/database",
    fields: [],
  },
  {
    id: "s3",
    name: "Amazon S3 Storage",
    category: "Databases & Storage",
    description: "Upload deliverables, exports, and datasets directly to Amazon S3, Cloudflare R2, or MinIO.",
    verified: true,
    secretLabel: "Secret Access Key",
    secretHint: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    fields: [
      { key: "bucket", label: "Bucket Name", hint: "finance-reports" },
      { key: "region", label: "AWS Region", hint: "us-east-1" },
      { key: "accessKeyId", label: "Access Key ID", hint: "AKIAIOSFODNN7EXAMPLE" },
      { key: "endpoint", label: "Custom Endpoint (optional)", hint: "https://<account>.r2.cloudflarestorage.com" },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    category: "Project & Engineering",
    description: "Inspect repository files, pull requests, commit trees, and open tracked issues.",
    verified: true,
    supportsOAuth: true,
    oauthScopes: ["repo", "read:user", "read:org"],
    secretLabel: "Personal Access Token",
    secretHint: "ghp_… or github_pat_…",
    fields: [
      { key: "repo", label: "Default Repository", hint: "owner/repo" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    category: "AI & LLM",
    description: "Primary LLM intelligence engine powering agent reasoning, planning, and autonomous tasks.",
    verified: true,
    secretLabel: "Anthropic API Key",
    secretHint: "sk-ant-…",
    fields: [
      { key: "model", label: "Model override (optional)", hint: "claude-sonnet-4-6 (default)" },
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    category: "AI & LLM",
    description: "Native Google Gemini engine powering ADK sandbox code execution and multimodal workflows.",
    verified: true,
    secretLabel: "Gemini API Key",
    secretHint: "AIzaSy…",
    fields: [
      { key: "model", label: "Model override", hint: "gemini-2.5-flash or gemini-1.5-pro" },
    ],
  },
  {
    id: "redis",
    name: "Redis Cache & Memory",
    category: "Databases & Storage",
    description: "Shared key-value cache allowing agents to persist state, locks, and memory across runs.",
    verified: true,
    secretLabel: "Connection URL",
    secretHint: "redis://default:password@host:6379",
    fields: [
      { key: "keyPrefix", label: "Key prefix (optional)", hint: "agent-studio:" },
    ],
  },
];

const DEFAULT_CUSTOM_CONNECTOR: ConnectorDef = {
  id: "aivm_brain",
  name: "aivm brain",
  category: "Custom",
  isCustom: true,
  endpoint: "mcp-brain.aivm.io",
  description: "Autonomous AI Virtual Machine MCP brain server for memory, tools, and sub-agent orchestration.",
  secretLabel: "MCP Auth Token",
  secretHint: "Bearer token",
  fields: [
    { key: "endpoint", label: "Server Endpoint", hint: "mcp-brain.aivm.io" },
  ],
};

const CATEGORIES = [
  "All",
  "Productivity",
  "Communication",
  "Design & Content",
  "Project & Engineering",
  "Databases & Storage",
  "AI & LLM",
  "Custom",
] as const;

export default function ConnectionsPage() {
  const router = useRouter();
  const [conns, setConns] = useState<Conn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Directory UI state
  const [subTab, setSubTab] = useState<"yours" | "custom" | "discover">("discover");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [showAllTop, setShowAllTop] = useState(false);
  const [customViewMode, setCustomViewMode] = useState<"grid" | "table">("grid");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeConnId, setActiveConnId] = useState<string | null>(null);

  // Heartbeat tracking per connection ID
  const [heartbeats, setHeartbeats] = useState<Record<string, { status: string; latencyMs: number; lastPing?: string }>>({});
  const [pingingId, setPingingId] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalConnector, setModalConnector] = useState<ConnectorDef | null>(null);
  const [authModeTab, setAuthModeTab] = useState<"oauth" | "manual">("oauth");
  const [activeModalTab, setActiveModalTab] = useState<"overview" | "mcp" | "webhooks">("overview");

  // Form state
  const [customName, setCustomName] = useState("");
  const [customKind, setCustomKind] = useState("mcp");
  const [secret, setSecret] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok?: boolean; detail?: string } | null>(null);
  const [connectingOAuth, setConnectingOAuth] = useState(false);

  // Helper: Copy to clipboard with temporary feedback
  function handleCopy(text: string, id: string, e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // Helper: Time ago string
  function formatTimeAgo(dateString?: string) {
    if (!dateString) return "";
    try {
      const diff = Date.now() - new Date(dateString).getTime();
      const sec = Math.floor(diff / 1000);
      if (sec < 60) return "just now";
      const min = Math.floor(sec / 60);
      if (min < 60) return `${min}m ago`;
      const hr = Math.floor(min / 60);
      if (hr < 24) return `${hr}h ago`;
      return `${Math.floor(hr / 24)}d ago`;
    } catch {
      return "";
    }
  }

  async function load() {
    try {
      const res = await fetch("/api/connections");
      if (!res.ok) throw new Error("Connections could not be loaded.");
      const j = await res.json();
      const list: Conn[] = j.connections ?? [];
      setConns(list);

      // Hydrate initial heartbeats from connection config
      const hbInit: Record<string, { status: string; latencyMs: number; lastPing?: string }> = {};
      for (const c of list) {
        if (c.config?.health) {
          hbInit[c.id] = c.config.health;
        }
      }
      setHeartbeats(hbInit);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Map of connected kinds and IDs to their Conn record
  const connectedMap = useMemo(() => {
    const map = new Map<string, Conn>();
    for (const c of conns) {
      map.set(c.id, c);
      map.set(c.kind, c);
      map.set(c.name.toLowerCase().replace(/\s+/g, "_"), c);
    }
    return map;
  }, [conns]);

  // Filtered connectors
  const filteredConnectors = useMemo(() => {
    return CATALOG.filter((item) => {
      if (subTab === "yours") {
        const isConnected = connectedMap.has(item.id) || connectedMap.has(item.name.toLowerCase());
        if (!isConnected) return false;
      }

      if (category !== "All" && item.category !== category) {
        return false;
      }

      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchName = item.name.toLowerCase().includes(q);
        const matchDesc = item.description.toLowerCase().includes(q);
        const matchCat = item.category.toLowerCase().includes(q);
        if (!matchName && !matchDesc && !matchCat) return false;
      }

      return true;
    });
  }, [subTab, category, search, connectedMap]);

  // Top connectors slice
  const displayedConnectors = useMemo(() => {
    if (showAllTop || search.trim() || category !== "All" || subTab === "yours") {
      return filteredConnectors;
    }
    return filteredConnectors.slice(0, 12);
  }, [filteredConnectors, showAllTop, search, category, subTab]);

  // Ping heartbeat
  async function pingHeartbeat(connId: string) {
    setPingingId(connId);
    try {
      const res = await fetch(`/api/connections/${connId}/heartbeat`, { method: "POST" });
      const j = await res.json();
      if (res.ok) {
        setHeartbeats((prev) => ({
          ...prev,
          [connId]: {
            status: j.status || "healthy",
            latencyMs: j.latencyMs || 24,
            lastPing: j.testedAt || new Date().toISOString(),
          },
        }));
      }
    } catch (err) {
      // ignore error
    } finally {
      setPingingId(null);
    }
  }

  // Open modal for a specific connector
  function handleOpenConnector(connector: ConnectorDef, explicitConnId?: string) {
    setActiveConnId(explicitConnId || null);
    setModalConnector(connector);
    setCustomName(connector.name);
    setCustomKind(connector.id);
    setSecret("");
    setTestResult(null);
    setActiveModalTab("overview");
    setAuthModeTab(connector.supportsOAuth ? "oauth" : "manual");

    const existing = explicitConnId
      ? conns.find((c) => c.id === explicitConnId)
      : connectedMap.get(connector.id) || connectedMap.get(connector.name.toLowerCase().replace(/\s+/g, "_"));
    if (existing) {
      setConfig(existing.config || {});
    } else {
      setConfig(connector.endpoint ? { endpoint: connector.endpoint } : {});
    }

    setModalOpen(true);
  }

  // Open modal for adding custom connector
  function handleOpenAddCustom() {
    setActiveConnId(null);
    setModalConnector(null);
    setCustomName("");
    setCustomKind("mcp");
    setSecret("");
    setConfig({});
    setTestResult(null);
    setActiveModalTab("overview");
    setAuthModeTab("manual");
    setModalOpen(true);
  }

  // Open modal for configuring an existing custom connector
  function handleOpenCustom(c: Conn) {
    const def: ConnectorDef = {
      id: c.kind,
      name: c.name,
      category: "Custom",
      isCustom: true,
      description: "Custom MCP or REST endpoint configured in your workspace.",
      endpoint: c.config?.baseUrl || c.config?.endpoint || "",
      secretLabel: "Auth Token / Secret",
      secretHint: "Bearer token",
      fields: [
        { key: "baseUrl", label: "Server Endpoint / Base URL", hint: "https://..." },
      ],
    };
    handleOpenConnector(def, c.id);
  }

  // 1-Click OAuth Connect
  async function handleOAuthConnect(connector: ConnectorDef) {
    setConnectingOAuth(true);
    setError("");
    try {
      const res = await fetch(`/api/connections/oauth/${connector.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: connector.name,
          scopes: connector.oauthScopes,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "OAuth connection failed");
      await load();
      setModalOpen(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConnectingOAuth(false);
    }
  }

  // Save manual connection
  async function handleSave() {
    const kind = modalConnector ? modalConnector.id : customKind;
    const name = customName.trim() || modalConnector?.name || "Custom Connector";
    if (!name) {
      setError("Please give the connection a name.");
      return;
    }

    setSaving(true);
    setError("");
    setTestResult(null);

    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind, config, secret }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The connection could not be saved.");
      await load();
      setModalOpen(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // Test existing connection
  async function handleTest(connId: string) {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/connections/${connId}`, { method: "POST" });
      const j = await res.json();
      setTestResult({ ok: j.ok, detail: j.detail || (j.ok ? "Connected successfully" : "Connection failed") });
      if (res.ok) {
        await pingHeartbeat(connId);
      }
    } catch (e: any) {
      setTestResult({ ok: false, detail: e.message || "Failed to reach server" });
    } finally {
      setTesting(false);
    }
  }

  // Remove / Disconnect
  async function handleRemove(connId: string, name: string) {
    if (!confirm(`Disconnect "${name}"? Agents using it will lose access.`)) return;
    try {
      await fetch(`/api/connections/${connId}`, { method: "DELETE" });
      await load();
      setModalOpen(false);
    } catch (e: any) {
      setError(e.message);
    }
  }

  // Custom connectors list
  const customConnsFromDb = useMemo(() => {
    return conns.filter(
      (c) =>
        c.kind === "mcp" ||
        c.kind === "http" ||
        c.kind === "rest" ||
        c.kind === "aivm_brain" ||
        c.config?.isCustom ||
        !CATALOG.some((cat) => cat.id === c.kind)
    );
  }, [conns]);

  // Filtered custom connectors based on search query
  const filteredCustomConns = useMemo(() => {
    if (!search.trim()) return customConnsFromDb;
    const q = search.toLowerCase().trim();
    return customConnsFromDb.filter((c) => {
      const matchName = c.name.toLowerCase().includes(q);
      const matchKind = c.kind.toLowerCase().includes(q);
      const endpoint = (c.config?.baseUrl || c.config?.endpoint || "").toLowerCase();
      const matchEndpoint = endpoint.includes(q);
      return matchName || matchKind || matchEndpoint;
    });
  }, [customConnsFromDb, search]);

  return (
    <div className="conn-directory-page">
      {/* Top Navigation Bar */}
      <div className="conn-top-bar">
        <div className="conn-pills-group">
          {/* Sub-tabs: Yours vs Custom vs Discover */}
          <div className="conn-pill-segmented">
            <button
              type="button"
              className={`conn-pill-btn ${subTab === "yours" ? "active" : ""}`}
              onClick={() => setSubTab("yours")}
            >
              Yours
            </button>
            <button
              type="button"
              className={`conn-pill-btn ${subTab === "custom" ? "active" : ""}`}
              onClick={() => setSubTab("custom")}
            >
              Custom & MCP ({customConnsFromDb.length})
            </button>
            <button
              type="button"
              className={`conn-pill-btn ${subTab === "discover" ? "active" : ""}`}
              onClick={() => setSubTab("discover")}
            >
              Discover
            </button>
          </div>
        </div>

        {/* Top right Add button */}
        <button
          type="button"
          className="conn-top-add-btn"
          onClick={handleOpenAddCustom}
          title="Add a custom connector or MCP server"
        >
          <span className="conn-add-plus">+</span> Add
        </button>
      </div>

      {/* Breadcrumb Header */}
      <div className="conn-breadcrumb-wrap">
        <span className="conn-breadcrumb-parent">Connectors</span>
        <span className="conn-breadcrumb-slash">/</span>
        <span className="conn-breadcrumb-current">Directory</span>
      </div>

      {/* Error alert if any */}
      {error && (
        <div className="error" style={{ marginBottom: 16 }}>
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError("")}
            style={{ float: "right", background: "none", border: "none", cursor: "pointer", color: "inherit" }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="conn-toolbar">
        <div className="conn-search-box">
          <svg className="conn-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="conn-search-input"
            placeholder="Search connectors"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="conn-search-clear"
              onClick={() => setSearch("")}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div className="conn-filter-dropdown-wrap">
          <span className="conn-filter-label">Filter:</span>
          <select
            className="conn-filter-select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Section 1: Custom Connectors & MCP Servers */}
      {(subTab === "custom" || subTab === "yours" || category === "Custom" || (subTab === "discover" && category === "All")) && (
        <section className="conn-custom-section">
          <div className="conn-section-head-v2">
            <div className="conn-section-title-wrap">
              <div className="conn-section-title-row">
                <h2 className="conn-section-title" style={{ margin: 0 }}>
                  Custom Connectors & MCP Servers
                </h2>
                <span className="conn-section-count">{filteredCustomConns.length}</span>
              </div>
              <p className="conn-section-sub">
                Internal enterprise APIs, Model Context Protocol endpoints, and private microservices configured for your workspace.
              </p>
            </div>

            <div className="conn-section-actions">
              <div className="conn-view-switcher">
                <button
                  type="button"
                  className={`conn-view-btn ${customViewMode === "grid" ? "active" : ""}`}
                  onClick={() => setCustomViewMode("grid")}
                  title="Card Grid View"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                  </svg>
                  Cards
                </button>
                <button
                  type="button"
                  className={`conn-view-btn ${customViewMode === "table" ? "active" : ""}`}
                  onClick={() => setCustomViewMode("table")}
                  title="Table List View"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                  Table
                </button>
              </div>

              <button
                type="button"
                className="conn-btn-add-custom"
                onClick={handleOpenAddCustom}
                title="Add a custom connector or MCP server"
              >
                + New Connector
              </button>
            </div>
          </div>

          {filteredCustomConns.length === 0 ? (
            <div className="conn-custom-empty-box">
              <div className="conn-custom-empty-icon">🔌</div>
              <div className="conn-custom-empty-title">
                {search.trim() ? "No custom connectors match your search" : "No custom connectors yet"}
              </div>
              <p className="conn-custom-empty-sub">
                {search.trim()
                  ? `No custom integrations match "${search}". Try clearing your search or switching categories.`
                  : "Connect your enterprise ERPs, internal microservices, or private MCP servers to provide specialized tools for your agents."}
              </p>
              {search.trim() ? (
                <button type="button" className="btn btn-ghost" onClick={() => setSearch("")}>
                  Clear search
                </button>
              ) : (
                <button type="button" className="conn-btn-add-custom" onClick={handleOpenAddCustom}>
                  + Add Your First Custom Connector
                </button>
              )}
            </div>
          ) : customViewMode === "grid" ? (
            <div className="conn-custom-grid-v2">
              {filteredCustomConns.map((c) => {
                const hb = heartbeats[c.id];
                const endpointUrl = c.config?.baseUrl || c.config?.endpoint || "Configured endpoint";
                const isCopied = copiedId === c.id;

                return (
                  <div
                    key={c.id}
                    className="conn-custom-card-v2"
                    onClick={() => handleOpenCustom(c)}
                    role="button"
                    tabIndex={0}
                  >
                    {/* Header: Icon, Title, Badges, Status */}
                    <div className="conn-custom-v2-head">
                      <div className="conn-custom-v2-head-left">
                        <div className="conn-custom-v2-icon-wrap">
                          <ConnectorIcon id={c.kind} size={38} />
                        </div>
                        <div className="conn-custom-v2-head-info">
                          <div className="conn-custom-v2-title" title={c.name}>
                            {c.name}
                          </div>
                          <div className="conn-custom-v2-badges">
                            {c.kind === "mcp" ? (
                              <span className="conn-badge-protocol mcp">⚡ MCP Server</span>
                            ) : c.kind === "http" || c.kind === "rest" ? (
                              <span className="conn-badge-protocol http">🌐 REST API</span>
                            ) : c.kind === "aivm_brain" ? (
                              <span className="conn-badge-protocol aivm">🧠 AIVM Brain</span>
                            ) : (
                              <span className="conn-badge-protocol generic">{c.kind}</span>
                            )}
                            <span className="conn-badge-tag">Custom</span>
                            {c.config?.authScheme && (
                              <span className="conn-badge-auth">🔒 {c.config.authScheme}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="conn-custom-v2-status-wrap">
                        <span
                          className={`conn-heartbeat-badge ${hb?.status === "healthy" ? "healthy" : "idle"}`}
                          title={`Heartbeat status: ${hb?.status || "active"}`}
                        >
                          <span className="conn-hb-dot" />
                          {hb ? `${hb.latencyMs}ms · Healthy` : "Active"}
                        </span>
                      </div>
                    </div>

                    {/* Body: Endpoint URL Code Snippet */}
                    <div className="conn-custom-v2-endpoint-box" onClick={(e) => e.stopPropagation()}>
                      <span className="conn-endpoint-prefix">Endpoint</span>
                      <span className="conn-endpoint-text" title={endpointUrl}>
                        {endpointUrl}
                      </span>
                      <button
                        type="button"
                        className="conn-copy-endpoint-btn"
                        onClick={(e) => handleCopy(endpointUrl, c.id, e)}
                        title="Copy endpoint URL to clipboard"
                      >
                        {isCopied ? (
                          <span className="conn-copied-text">✓ Copied</span>
                        ) : (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                            Copy
                          </>
                        )}
                      </button>
                    </div>

                    {/* Footer: Metadata & Actions */}
                    <div className="conn-custom-v2-footer">
                      <div className="conn-custom-v2-footer-left">
                        <span className="conn-footer-meta-text">
                          {hb?.lastPing ? `Pinged ${formatTimeAgo(hb.lastPing)}` : "Verified integration"}
                        </span>
                      </div>

                      <div className="conn-custom-v2-footer-actions">
                        <button
                          type="button"
                          className="conn-ping-btn"
                          title="Ping Heartbeat"
                          onClick={(e) => {
                            e.stopPropagation();
                            pingHeartbeat(c.id);
                          }}
                          disabled={pingingId === c.id}
                        >
                          {pingingId === c.id ? "…" : "⚡ Ping"}
                        </button>
                        <button
                          type="button"
                          className="conn-btn-configure"
                          title="Configure connection settings, MCP tools, and webhooks"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenCustom(c);
                          }}
                        >
                          ⚙ Configure
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Add New Custom Connector Card */}
              <div
                className="conn-custom-add-card"
                onClick={handleOpenAddCustom}
                role="button"
                tabIndex={0}
              >
                <div className="conn-custom-add-icon">+</div>
                <div className="conn-custom-add-title">Add Custom Connector</div>
                <div className="conn-custom-add-sub">
                  Register a private MCP server, REST API, or internal webhook service.
                </div>
              </div>
            </div>
          ) : (
            /* Table View */
            <div className="conn-custom-table-wrap">
              <table className="conn-custom-table">
                <thead>
                  <tr>
                    <th>Connector</th>
                    <th>Type</th>
                    <th>Target Endpoint</th>
                    <th>Heartbeat</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomConns.map((c) => {
                    const hb = heartbeats[c.id];
                    const endpointUrl = c.config?.baseUrl || c.config?.endpoint || "Configured endpoint";
                    const isCopied = copiedId === c.id;

                    return (
                      <tr
                        key={c.id}
                        onClick={() => handleOpenCustom(c)}
                        style={{ cursor: "pointer" }}
                      >
                        <td>
                          <div className="conn-table-name-cell">
                            <ConnectorIcon id={c.kind} size={28} />
                            <div>
                              <div className="conn-table-title">{c.name}</div>
                              <div className="conn-table-sub">
                                {c.config?.authScheme ? `Auth: ${c.config.authScheme}` : "Custom Connector"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {c.kind === "mcp" ? (
                            <span className="conn-badge-protocol mcp">⚡ MCP</span>
                          ) : c.kind === "http" || c.kind === "rest" ? (
                            <span className="conn-badge-protocol http">🌐 REST</span>
                          ) : c.kind === "aivm_brain" ? (
                            <span className="conn-badge-protocol aivm">🧠 AIVM</span>
                          ) : (
                            <span className="conn-badge-protocol generic">{c.kind}</span>
                          )}
                        </td>
                        <td>
                          <div className="conn-table-endpoint-cell" onClick={(e) => e.stopPropagation()}>
                            <span className="conn-table-endpoint-text" title={endpointUrl}>
                              {endpointUrl}
                            </span>
                            <button
                              type="button"
                              className="conn-table-copy-btn"
                              onClick={(e) => handleCopy(endpointUrl, c.id, e)}
                              title="Copy URL"
                            >
                              {isCopied ? "✓" : "📋"}
                            </button>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`conn-heartbeat-badge ${hb?.status === "healthy" ? "healthy" : "idle"}`}
                          >
                            <span className="conn-hb-dot" />
                            {hb ? `${hb.latencyMs}ms` : "Active"}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div
                            style={{ display: "inline-flex", gap: 8, alignItems: "center" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="conn-ping-btn"
                              title="Ping Heartbeat"
                              onClick={() => pingHeartbeat(c.id)}
                              disabled={pingingId === c.id}
                            >
                              {pingingId === c.id ? "…" : "⚡ Ping"}
                            </button>
                            <button
                              type="button"
                              className="conn-btn-configure"
                              title="Configure connection settings"
                              onClick={() => handleOpenCustom(c)}
                            >
                              ⚙ Configure
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Section 2: Catalog connectors */}
      {subTab !== "custom" && category !== "Custom" && (
        <section className="conn-section">
          <div className="conn-section-head">
            <h2 className="conn-section-title">
              {subTab === "yours" ? "Connected catalog tools" : category !== "All" ? `${category} connectors` : "Top connectors"}
            </h2>
          {subTab !== "yours" && category === "All" && !search.trim() && (
            <button
              type="button"
              className="conn-show-all-btn"
              onClick={() => setShowAllTop(!showAllTop)}
            >
              {showAllTop ? "Show top" : "Show all"}
            </button>
          )}
        </div>

        {loading ? (
          <div className="conn-loading">Loading connectors directory…</div>
        ) : displayedConnectors.length === 0 ? (
          <div className="conn-empty-notice">
            <p>No connectors match the selected filter or search term.</p>
          </div>
        ) : (
          <div className="conn-grid">
            {displayedConnectors.map((item) => {
              const isConnected = connectedMap.has(item.id) || connectedMap.has(item.name.toLowerCase().replace(/\s+/g, "_"));
              const activeConn = connectedMap.get(item.id) || connectedMap.get(item.name.toLowerCase().replace(/\s+/g, "_"));
              const hb = activeConn ? heartbeats[activeConn.id] : null;

              return (
                <div
                  key={item.id}
                  className="conn-card"
                  onClick={() => handleOpenConnector(item)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="conn-card-body">
                    <div className="conn-card-icon-wrap">
                      <ConnectorIcon id={item.id} size={36} />
                    </div>

                    <div className="conn-card-content">
                      <div className="conn-card-title-row">
                        <span className="conn-card-title">{item.name}</span>
                        {item.verified && <VerifiedBadge size={15} />}
                        {isConnected && (
                          <span
                            className={`conn-heartbeat-badge ${hb?.status === "healthy" ? "healthy" : "idle"}`}
                            title="Heartbeat health"
                          >
                            <span className="conn-hb-dot" />
                            {hb ? `${hb.latencyMs}ms` : "Active"}
                          </span>
                        )}
                      </div>
                      <p className="conn-card-desc">{item.description}</p>
                    </div>
                  </div>

                  <div className="conn-card-action">
                    {isConnected ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          type="button"
                          className="conn-ping-btn"
                          title="Ping Heartbeat"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (activeConn) pingHeartbeat(activeConn.id);
                          }}
                          disabled={pingingId === activeConn?.id}
                        >
                          {pingingId === activeConn?.id ? "…" : "⚡ Ping"}
                        </button>
                        <span
                          className="conn-btn-connected"
                          title={`Connected (${activeConn?.name}) — click to view, test, or inspect webhooks`}
                        >
                          ✓
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="conn-btn-add"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenConnector(item);
                        }}
                        title={`Connect ${item.name}`}
                      >
                        +
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}

      {/* Connector Configuration & Management Modal */}
      {modalOpen && (
        <div className="conn-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="conn-modal" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="conn-modal-head">
              <div className="conn-modal-title-group">
                <ConnectorIcon id={modalConnector?.id || customKind} size={34} />
                <div>
                  <h3 className="conn-modal-title">
                    {modalConnector ? modalConnector.name : "Add Custom Connector"}
                  </h3>
                  <div className="conn-modal-subtitle">
                    {modalConnector?.category || "Custom Integration"} · {modalConnector?.supportsOAuth ? "OAuth 2.0 & Webhooks Supported" : "Encrypted Vault"}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="conn-modal-close"
                onClick={() => setModalOpen(false)}
              >
                ✕
              </button>
            </div>

            {/* Modal Tabs for Connected Services */}
            {(() => {
              const existing =
                activeConnId
                  ? conns.find((c) => c.id === activeConnId)
                  : modalConnector
                  ? connectedMap.get(modalConnector.id) || connectedMap.get(modalConnector.name.toLowerCase().replace(/\s+/g, "_"))
                  : undefined;

              if (existing) {
                const isMcp = modalConnector?.id === "aivm_brain" || modalConnector?.id === "mcp" || existing.kind === "mcp" || existing.kind === "aivm_brain" || existing.config?.baseUrl;

                return (
                  <div>
                    {/* Tab Navigation for Connected Service */}
                    <div className="conn-modal-tabs">
                      <button
                        type="button"
                        className={`conn-modal-tab-btn ${activeModalTab === "overview" ? "active" : ""}`}
                        onClick={() => setActiveModalTab("overview")}
                      >
                        Overview & Credentials
                      </button>

                      {isMcp && (
                        <button
                          type="button"
                          className={`conn-modal-tab-btn ${activeModalTab === "mcp" ? "active" : ""}`}
                          onClick={() => setActiveModalTab("mcp")}
                        >
                          ⚡ MCP Schema Browser
                        </button>
                      )}

                      <button
                        type="button"
                        className={`conn-modal-tab-btn ${activeModalTab === "webhooks" ? "active" : ""}`}
                        onClick={() => setActiveModalTab("webhooks")}
                      >
                        🔔 Webhook Listeners
                      </button>
                    </div>

                    {/* Tab: MCP Schema Browser */}
                    {activeModalTab === "mcp" && (
                      <MCPSchemaBrowser
                        connectionId={existing.id}
                        connectionName={existing.name}
                      />
                    )}

                    {/* Tab: Webhook Listeners */}
                    {activeModalTab === "webhooks" && (
                      <WebhookListenerPanel
                        connectionId={existing.id}
                        connectionName={existing.name}
                      />
                    )}

                    {/* Tab: Overview */}
                    {activeModalTab === "overview" && (
                      <div className="conn-modal-connected-view">
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                          <div className="conn-status-badge active">
                            <span className="conn-status-dot" />
                            <span>Connected to workspace</span>
                          </div>

                          {heartbeats[existing.id] && (
                            <span className="conn-heartbeat-badge healthy">
                              <span className="conn-hb-dot" />
                              Latency: {heartbeats[existing.id].latencyMs}ms
                            </span>
                          )}
                        </div>

                        <div className="conn-detail-box">
                          <div className="conn-detail-row">
                            <span className="conn-detail-k">Connection Name:</span>
                            <span className="conn-detail-v">{existing.name}</span>
                          </div>
                          <div className="conn-detail-row">
                            <span className="conn-detail-k">Auth Mode:</span>
                            <span className="conn-detail-v mono">
                              {existing.config?.authMode === "oauth2" ? "OAuth 2.0 (Auto-refreshed)" : "Encrypted Secret"}
                            </span>
                          </div>
                          <div className="conn-detail-row">
                            <span className="conn-detail-k">Type / Kind:</span>
                            <span className="conn-detail-v mono">{existing.kind}</span>
                          </div>
                          <div className="conn-detail-row">
                            <span className="conn-detail-k">Connected since:</span>
                            <span className="conn-detail-v">
                              {new Date(existing.created_at).toLocaleDateString(undefined, {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          </div>
                          {existing.config?.oauth?.scopes && (
                            <div className="conn-detail-row">
                              <span className="conn-detail-k">Authorized Scopes:</span>
                              <span className="conn-detail-v mono" style={{ fontSize: 11 }}>
                                {existing.config.oauth.scopes.join(", ")}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Test feedback */}
                        {testResult && (
                          <div
                            className={`conn-test-feedback ${testResult.ok ? "success" : "fail"}`}
                          >
                            <span className="conn-test-icon">{testResult.ok ? "✓" : "✗"}</span>
                            <span>{testResult.detail}</span>
                          </div>
                        )}

                        <div className="conn-modal-actions">
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => handleTest(existing.id)}
                              disabled={testing}
                            >
                              {testing ? "Testing connection…" : "Test connection"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => pingHeartbeat(existing.id)}
                              disabled={pingingId === existing.id}
                            >
                              {pingingId === existing.id ? "Pinging…" : "⚡ Ping Heartbeat"}
                            </button>
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ color: "#ef4444" }}
                            onClick={() => handleRemove(existing.id, existing.name)}
                          >
                            Disconnect
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              // Unconnected: Render Connection Setup
              return (
                <div className="conn-form">
                  <p className="conn-form-blurb">
                    {modalConnector?.description ||
                      "Connect custom Model Context Protocol (MCP) or REST endpoints to enable agent access."}
                  </p>

                  {/* Mode Toggle: 1-Click OAuth vs Manual Key */}
                  {modalConnector?.supportsOAuth && (
                    <div className="conn-auth-toggle-bar">
                      <button
                        type="button"
                        className={`conn-auth-tab-btn ${authModeTab === "oauth" ? "active" : ""}`}
                        onClick={() => setAuthModeTab("oauth")}
                      >
                        ⚡ 1-Click OAuth 2.0 (Recommended)
                      </button>
                      <button
                        type="button"
                        className={`conn-auth-tab-btn ${authModeTab === "manual" ? "active" : ""}`}
                        onClick={() => setAuthModeTab("manual")}
                      >
                        Manual API Key / Secret
                      </button>
                    </div>
                  )}

                  {/* 1-Click OAuth View */}
                  {modalConnector?.supportsOAuth && authModeTab === "oauth" ? (
                    <div className="conn-oauth-box">
                      <div className="conn-oauth-badge">
                        <span className="conn-oauth-icon">🔒</span>
                        <span>Enterprise OAuth 2.0 Flow</span>
                      </div>
                      <h4 className="conn-oauth-heading">
                        Connect {modalConnector.name} with 1-Click
                      </h4>
                      <p className="conn-oauth-sub">
                        Authorizes Agent Studio with secure, scoped access. Tokens are encrypted at rest with AES-256 GCM and refreshed automatically.
                      </p>

                      {modalConnector.oauthScopes && (
                        <div className="conn-oauth-scopes-wrap">
                          <span className="conn-oauth-scopes-label">Requested Scopes:</span>
                          <div className="conn-oauth-scopes-list">
                            {modalConnector.oauthScopes.map((s) => (
                              <span key={s} className="conn-scope-pill mono">
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div style={{ marginTop: 24, textAlign: "center" }}>
                        <button
                          type="button"
                          className="conn-oauth-connect-btn"
                          onClick={() => handleOAuthConnect(modalConnector)}
                          disabled={connectingOAuth}
                        >
                          <ConnectorIcon id={modalConnector.id} size={20} />
                          <span>
                            {connectingOAuth ? "Authorizing with OAuth 2.0…" : `Connect ${modalConnector.name}`}
                          </span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Manual Configuration Form */
                    <div>
                      {/* If adding new custom connector */}
                      {!modalConnector && (
                        <div className="conn-form-field">
                          <label className="conn-label">Connector Type</label>
                          <select
                            className="conn-input"
                            value={customKind}
                            onChange={(e) => setCustomKind(e.target.value)}
                          >
                            <option value="mcp">Model Context Protocol (MCP Server)</option>
                            <option value="http">REST API / HTTP Webhook</option>
                            <option value="aivm_brain">AIVM Brain</option>
                          </select>
                        </div>
                      )}

                      <div className="conn-form-field">
                        <label className="conn-label">Connection Name</label>
                        <input
                          className="conn-input"
                          placeholder="e.g. Production Workspace"
                          value={customName}
                          onChange={(e) => setCustomName(e.target.value)}
                        />
                      </div>

                      {/* Specific Fields */}
                      {(modalConnector?.fields || [
                        { key: "baseUrl", label: "Server Endpoint / Base URL", hint: "https://mcp.yourdomain.com" },
                      ]).map((f) => (
                        <div className="conn-form-field" key={f.key}>
                          <label className="conn-label">{f.label}</label>
                          <input
                            className="conn-input"
                            placeholder={f.hint}
                            value={config[f.key] ?? ""}
                            onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                          />
                        </div>
                      ))}

                      {/* Secret Input */}
                      <div className="conn-form-field">
                        <label className="conn-label">
                          {modalConnector?.secretLabel || "API Key or Secret Token"}
                        </label>
                        <input
                          type="password"
                          className="conn-input mono"
                          placeholder={modalConnector?.secretHint || "Enter secret key or bearer token"}
                          value={secret}
                          onChange={(e) => setSecret(e.target.value)}
                        />
                        <span className="conn-help-text">
                          Stored securely with AES-256 GCM encryption. Never exposed to browser clients.
                        </span>
                      </div>

                      <div className="conn-modal-foot">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setModalOpen(false)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={handleSave}
                          disabled={saving}
                        >
                          {saving ? "Saving…" : "Save & Connect"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Preserve NotificationSettings at the bottom */}
      <div style={{ marginTop: 40 }}>
        <NotificationSettings />
      </div>
    </div>
  );
}
