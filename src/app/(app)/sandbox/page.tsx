"use client";

import { useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface SandboxEnvironment {
  id: string;
  framework: "google" | "langchain" | "foundry" | "openai";
  frameworkLabel: string;
  name: string;
  route: string;
  badge: string;
  badgeColor: string;
  badgeBg: string;
  badgeBorder: string;
  iconBg: string;
  iconBorder: string;
  headline: string;
  description: string;
  features: string[];
  presetsCount: number;
  popularPresets: { id: string; label: string }[];
  runtimeEngine: string;
  accentColor: string;
}

const ENVIRONMENTS: SandboxEnvironment[] = [
  {
    id: "google-adk",
    framework: "google",
    frameworkLabel: "Google ADK",
    name: "Google Agent Development Kit",
    route: "/sandbox/google-adk",
    badge: "GOOGLE ADK",
    badgeColor: "#0284c7",
    badgeBg: "rgba(2,132,199,0.08)",
    badgeBorder: "rgba(2,132,199,0.25)",
    iconBg: "rgba(2,132,199,0.08)",
    iconBorder: "rgba(2,132,199,0.2)",
    headline: "Google Agent Development Kit (ADK)",
    description:
      "Native Python, TypeScript & JSON agent development. Decompile state machines, inspect Gemini tools and function calling, test with Gemini 2.5 Flash, and promote directly into Agent Studio.",
    features: [
      "Gemini Function Calling & Tools",
      "Bidirectional Python / TS / JSON Transpilation",
      "Native State Machine Loop Simulator",
      "Data Pipeline Sentinel & DevOps Presets",
    ],
    presetsCount: 4,
    popularPresets: [
      { id: "order-support", label: "Order & Refund Support" },
      { id: "data-pipeline-sentinel", label: "Data Pipeline Sentinel" },
      { id: "devops-incident", label: "DevOps Incident Triage" },
      { id: "invoice-auditor", label: "Invoice Compliance Auditor" },
    ],
    runtimeEngine: "Gemini 2.5 Flash / Claude 3.5",
    accentColor: "#0284c7",
  },
  {
    id: "langchain",
    framework: "langchain",
    frameworkLabel: "LangChain & LangGraph",
    name: "LangChain & LangGraph Studio",
    route: "/sandbox/langchain",
    badge: "LANGGRAPH & REACT",
    badgeColor: "#0f766e",
    badgeBg: "rgba(15,118,110,0.08)",
    badgeBorder: "rgba(15,118,110,0.25)",
    iconBg: "rgba(15,118,110,0.08)",
    iconBorder: "rgba(15,118,110,0.2)",
    headline: "LangChain & LangGraph Studio",
    description:
      "Import LangChain ReAct loops (`create_react_agent`, `@tool`) and LangGraph state machine agents. Inspect Thought/Action reasoning traces, evaluate tool schemas, and test live loop iterations.",
    features: [
      "ReAct Reasoning Loop Tracing",
      "@tool Python Decorator Extraction",
      "LangGraph State Node Decompilation",
      "Claude 3.5 Sonnet Native Reasoning",
    ],
    presetsCount: 3,
    popularPresets: [
      { id: "customer-support-react", label: "Customer Support ReAct" },
      { id: "financial-research-graph", label: "Financial Research Graph" },
      { id: "sql-analyst-react", label: "Enterprise SQL Analyst" },
    ],
    runtimeEngine: "Claude 3.5 Sonnet / Gemini 2.5",
    accentColor: "#0f766e",
  },
  {
    id: "foundry",
    framework: "foundry",
    frameworkLabel: "Palantir Foundry AIP",
    name: "Palantir Foundry AIP Sandbox",
    route: "/sandbox/foundry",
    badge: "ENTERPRISE ONTOLOGY",
    badgeColor: "#7e22ce",
    badgeBg: "rgba(126,34,206,0.08)",
    badgeBorder: "rgba(126,34,206,0.25)",
    iconBg: "rgba(126,34,206,0.08)",
    iconBorder: "rgba(126,34,206,0.2)",
    headline: "Palantir Foundry AIP Sandbox",
    description:
      "Enterprise agent simulation with Palantir AIP Ontology object bindings (`Shipment`, `TrialSubject`, `Flight`) and human-in-the-loop approval gated `ActionType` calls.",
    features: [
      "Enterprise Ontology Object Type Bindings",
      "ActionType Human-in-the-Loop Approval Gates",
      "AIP Policy & Governance Rule Simulation",
      "Supply Chain & Healthcare Presets",
    ],
    presetsCount: 3,
    popularPresets: [
      { id: "supply-chain-mitigation", label: "Supply Chain Disruption" },
      { id: "clinical-compliance", label: "Clinical Trial Protocol" },
      { id: "fleet-maintenance", label: "Aviation Fleet Maintenance" },
    ],
    runtimeEngine: "Gemini 2.5 Flash / AIP Gateway",
    accentColor: "#7e22ce",
  },
  {
    id: "openai",
    framework: "openai",
    frameworkLabel: "OpenAI Swarm",
    name: "OpenAI Assistants & Swarm Sandbox",
    route: "/sandbox/openai",
    badge: "MULTI-AGENT SWARM",
    badgeColor: "#047857",
    badgeBg: "rgba(4,120,87,0.08)",
    badgeBorder: "rgba(4,120,87,0.25)",
    iconBg: "rgba(4,120,87,0.08)",
    iconBorder: "rgba(4,120,87,0.2)",
    headline: "OpenAI Assistants & Swarm Sandbox",
    description:
      "Multi-agent choreography routines (`transfer_to_...`), intent handoffs, and OpenAI Assistants API function tool specifications. Test collaborative handoff execution and promote into unified catalog.",
    features: [
      "Swarm Agent Handoff Routines (transfer_to)",
      "OpenAI Function Calling & Tool Schemas",
      "Multi-Agent Choreography Simulation",
      "Customer Ops & DevSecOps Presets",
    ],
    presetsCount: 2,
    popularPresets: [
      { id: "tiered-support-swarm", label: "Tiered Customer Support Swarm" },
      { id: "security-code-reviewer", label: "Security PR Reviewer" },
    ],
    runtimeEngine: "Claude 3.5 Sonnet / Mock Swarm",
    accentColor: "#047857",
  },
];

export default function SandboxesHubPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Cloud Agent Import State
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [importError, setImportError] = useState<string>("");
  const [importedAgent, setImportedAgent] = useState<{
    name: string;
    ecosystem: string;
    archetype: string;
    domain: string;
    tools: { id: string; gate: "auto" | "approval" }[];
    steps: string[];
    purpose: string;
    spec: any;
    rawCode: string;
    rawLanguage: "python" | "typescript" | "json";
    targetSandbox: string;
  } | null>(null);
  const [promoting, setPromoting] = useState<boolean>(false);
  const [promoteSuccess, setPromoteSuccess] = useState<string | null>(null);

  async function processUploadedFile(file: File) {
    setImporting(true);
    setImportError("");
    setImportedAgent(null);
    setPromoteSuccess(null);

    try {
      let code = "";
      let lang: "python" | "typescript" | "json" = "json";
      let ecosystem = "Cloud Export";
      let targetSandbox = "/sandbox/google-adk";

      if (file.name.endsWith(".zip")) {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(file);

        // Detect ecosystem from files
        const fileNames = Object.keys(zip.files).map((f) => f.toLowerCase());
        const hasAzure = fileNames.some((f) => f.includes("azure") || f.includes("bicep"));
        const hasGcp = fileNames.some((f) => f.includes("gcp") || f.includes("procfile"));
        const hasAws = fileNames.some((f) => f.includes("aws") || f.includes("template.yaml"));
        const hasDocker = fileNames.some((f) => f.includes("docker-compose"));

        if (hasAzure) ecosystem = "Microsoft Azure";
        else if (hasGcp) ecosystem = "Google Cloud (GCP)";
        else if (hasAws) ecosystem = "Amazon Web Services (AWS)";
        else if (hasDocker) ecosystem = "Docker Container";
        else if (file.name.toLowerCase().includes("gcp")) ecosystem = "Google Cloud (GCP)";
        else if (file.name.toLowerCase().includes("azure")) ecosystem = "Microsoft Azure";

        // Look for agent.json first
        const agentJsonFile =
          zip.file("agent.json") ||
          Object.values(zip.files).find((f) => f.name.endsWith("agent.json"));

        if (agentJsonFile) {
          code = await agentJsonFile.async("string");
          lang = "json";
        } else {
          // Look for runner files
          const runnerMjs = Object.values(zip.files).find(
            (f) => !f.dir && (f.name.endsWith("runner.mjs") || f.name.endsWith("handler.mjs") || f.name.endsWith("server.mjs"))
          );
          if (runnerMjs) {
            code = await runnerMjs.async("string");
            lang = "typescript";
          } else {
            const runnerPy = Object.values(zip.files).find(
              (f) => !f.dir && (f.name.endsWith("runner.py") || f.name.endsWith("main.py"))
            );
            if (runnerPy) {
              code = await runnerPy.async("string");
              lang = "python";
            }
          }
        }
      } else {
        if (file.name.endsWith(".py")) {
          lang = "python";
        } else if (file.name.endsWith(".ts") || file.name.endsWith(".mjs") || file.name.endsWith(".js")) {
          lang = "typescript";
        } else {
          lang = "json";
        }
        code = await file.text();
      }

      if (!code) {
        throw new Error("Could not extract agent specification from this file.");
      }

      // Parse code via sandbox parse API
      const res = await fetch("/api/sandbox/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language: lang, framework: "adk" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to parse agent package.");
      }

      const parsed = data.parsed;
      if (!parsed || !parsed.spec) {
        throw new Error("Invalid agent specification detected.");
      }

      // Check framework keywords in code for target sandbox routing
      if (code.includes("@langchain") || code.includes("create_react_agent") || code.includes("langgraph")) {
        targetSandbox = "/sandbox/langchain";
        if (ecosystem === "Cloud Export") ecosystem = "LangChain";
      } else if (code.includes("transfer_to_") || code.includes("OpenAI") || code.includes("Swarm")) {
        targetSandbox = "/sandbox/openai";
        if (ecosystem === "Cloud Export") ecosystem = "OpenAI Swarm";
      } else if (code.includes("@ActionType") || code.includes("foundry") || code.includes("AipAgent")) {
        targetSandbox = "/sandbox/foundry";
        if (ecosystem === "Cloud Export") ecosystem = "Palantir Foundry AIP";
      }

      setImportedAgent({
        name: parsed.name || parsed.spec.name || "Imported Agent",
        ecosystem,
        archetype: parsed.spec.archetype || "analyst",
        domain: parsed.spec.domain || "General",
        tools: parsed.spec.tools || [],
        steps: parsed.spec.steps || [],
        purpose: parsed.spec.purpose || parsed.spec.brief || "",
        spec: parsed.spec,
        rawCode: code,
        rawLanguage: lang,
        targetSandbox,
      });
    } catch (err: any) {
      setImportError(err.message || String(err));
    } finally {
      setImporting(false);
    }
  }

  async function handlePromoteImportedAgent() {
    if (!importedAgent) return;
    setPromoting(true);
    setImportError("");
    try {
      const res = await fetch("/api/sandbox/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: importedAgent.name,
          spec: importedAgent.spec,
          sourceCode: importedAgent.rawCode,
          framework: importedAgent.ecosystem,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to promote agent into workspace.");
      }
      setPromoteSuccess(data.agentId);
      setTimeout(() => {
        router.push(`/agents/${data.agentId}`);
      }, 1000);
    } catch (err: any) {
      setImportError(err.message || String(err));
    } finally {
      setPromoting(false);
    }
  }

  function handleOpenInSandbox() {
    if (!importedAgent) return;
    sessionStorage.setItem("sandbox_imported_code", importedAgent.rawCode);
    sessionStorage.setItem("sandbox_imported_lang", importedAgent.rawLanguage);
    router.push(importedAgent.targetSandbox);
  }

  const filteredEnvironments = useMemo(() => {
    return ENVIRONMENTS.filter((env) => {
      if (selectedCategory !== "all" && env.framework !== selectedCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          env.name.toLowerCase().includes(q) ||
          env.headline.toLowerCase().includes(q) ||
          env.description.toLowerCase().includes(q) ||
          env.features.some((f) => f.toLowerCase().includes(q)) ||
          env.frameworkLabel.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [selectedCategory, searchQuery]);

  return (
    <div className="page">
      {/* Top Header */}
      <header className="page-head" style={{ marginBottom: 24 }}>
        <div>
          <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span>AGENT RUNTIMES & SIMULATION</span>
            <span style={{ opacity: 0.35 }}>·</span>
            <span className="tag ok" style={{ fontSize: 10, padding: "1px 7px" }}>
              4 ACTIVE RUNTIMES
            </span>
          </div>
          <h1>AGENT SANDBOXES</h1>
          <p className="sub" style={{ maxWidth: 840, fontSize: 13.5, margin: 0 }}>
            Dedicated simulation environments for top enterprise AI frameworks. Select a sandbox below to import, decompile,
            test interactive reasoning traces with live LLMs, and promote directly into production Agent Studio assets.
          </p>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", alignSelf: "flex-start", marginTop: 4 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 14px",
              background: "var(--panel, #ffffff)",
              border: "1px solid rgba(0,51,141,0.15)",
              borderRadius: "var(--radius)",
              boxShadow: "0 1px 2px rgba(0,51,141,.05)",
              fontSize: 12,
              color: "var(--text, #0a1b3d)",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block", boxShadow: "0 0 6px rgba(34,197,94,0.6)" }} />
            <span style={{ fontWeight: 500 }}>All Engines Operational</span>
          </div>
        </div>
      </header>

      {/* Cloud Agent Import Dropzone & Preview Section */}
      <div
        style={{
          marginBottom: 24,
          background: "var(--panel, #ffffff)",
          border: isDragging ? "2px dashed #005eb8" : "1px solid rgba(0,51,141,0.16)",
          borderRadius: "var(--radius)",
          padding: 20,
          boxShadow: "0 1px 2px rgba(0,51,141,.04), 0 8px 24px -12px rgba(0,51,141,.08)",
          transition: "border 0.2s ease",
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) processUploadedFile(file);
        }}
      >
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: "none" }}
          accept=".zip,.json,.py,.ts,.tsx,.js,.mjs"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) processUploadedFile(file);
          }}
        />

        {!importedAgent ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 8,
                  background: "rgba(0,51,141,0.06)",
                  border: "1px solid rgba(0,51,141,0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                }}
              >
                ☁️
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "var(--text)" }}>
                    Import & Promote Cloud Agent
                  </h3>
                  <span className="tag" style={{ fontSize: 10, padding: "1px 6px", background: "rgba(0,94,184,0.08)", color: "#005eb8" }}>
                    GCP · Azure · AWS · Docker
                  </span>
                </div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 0" }}>
                  Exported an agent in GCP or Azure? Drop your package (<code style={{ fontSize: 11 }}>.zip</code>, <code style={{ fontSize: 11 }}>agent.json</code>, or code) here to inspect in sandbox and promote directly to Agent Studio.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                style={{ fontSize: 12.5, height: 34 }}
              >
                {importing ? "Unpacking Package..." : "Upload Agent Package (.zip, .json)"}
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Active Imported Agent Inspection Card */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span
                    className="tag"
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      padding: "2px 8px",
                      background: importedAgent.ecosystem.includes("Azure")
                        ? "rgba(0,120,212,0.12)"
                        : importedAgent.ecosystem.includes("GCP")
                        ? "rgba(66,133,244,0.12)"
                        : "rgba(0,51,141,0.1)",
                      color: importedAgent.ecosystem.includes("Azure")
                        ? "#0078d4"
                        : importedAgent.ecosystem.includes("GCP")
                        ? "#1a73e8"
                        : "#00338d",
                      border: "1px solid rgba(0,51,141,0.2)",
                    }}
                  >
                    {importedAgent.ecosystem}
                  </span>
                  <span className="tag" style={{ fontSize: 10.5, textTransform: "uppercase" }}>
                    {importedAgent.archetype}
                  </span>
                  <span className="tag" style={{ fontSize: 10.5 }}>
                    {importedAgent.domain}
                  </span>
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--text)" }}>
                  {importedAgent.name}
                </h3>
                <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0", maxWidth: 700 }}>
                  {importedAgent.purpose}
                </p>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setImportedAgent(null)}
                  disabled={promoting}
                  style={{ fontSize: 12, height: 32 }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleOpenInSandbox}
                  disabled={promoting}
                  style={{ fontSize: 12, height: 32 }}
                  title="Open code in dedicated sandbox simulator"
                >
                  Open in Sandbox →
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handlePromoteImportedAgent}
                  disabled={promoting}
                  style={{ fontSize: 12, height: 32 }}
                >
                  {promoting ? "Promoting to Studio..." : "Promote to Agent Studio ✓"}
                </button>
              </div>
            </div>

            {/* Spec Breakdown */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, background: "rgba(0,51,141,0.02)", padding: 14, borderRadius: 6, border: "1px solid rgba(0,51,141,0.08)" }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>
                  Tools & Approval Gates ({importedAgent.tools.length})
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {importedAgent.tools.map((t, idx) => (
                    <span
                      key={idx}
                      style={{
                        fontSize: 11,
                        padding: "3px 8px",
                        borderRadius: 4,
                        background: t.gate === "approval" ? "rgba(198,0,126,0.08)" : "rgba(0,163,161,0.08)",
                        color: t.gate === "approval" ? "#c6007e" : "#00a3a1",
                        border: `1px solid ${t.gate === "approval" ? "rgba(198,0,126,0.3)" : "rgba(0,163,161,0.3)"}`,
                        fontWeight: 600,
                      }}
                    >
                      {t.id} <span style={{ opacity: 0.6, fontSize: 10 }}>({t.gate})</span>
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>
                  Procedure Steps ({importedAgent.steps.length})
                </div>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text)" }}>
                  {importedAgent.steps.slice(0, 3).map((s, i) => (
                    <li key={i} style={{ marginBottom: 2 }}>{s}</li>
                  ))}
                  {importedAgent.steps.length > 3 && (
                    <li style={{ color: "var(--muted)", listStyleType: "none" }}>
                      + {importedAgent.steps.length - 3} more steps...
                    </li>
                  )}
                </ol>
              </div>
            </div>

            {promoteSuccess && (
              <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#166534", fontSize: 12.5, fontWeight: 600 }}>
                ✓ Agent promoted successfully! Redirecting to Agent Studio Builder...
              </div>
            )}
          </div>
        )}

        {importError && (
          <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#b91c1c", fontSize: 12 }}>
            {importError}
          </div>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 14,
          marginBottom: 24,
          padding: "12px 18px",
          background: "var(--panel, #ffffff)",
          border: "1px solid rgba(0,51,141,0.15)",
          borderRadius: "var(--radius)",
          boxShadow: "0 1px 2px rgba(0,51,141,.05), 0 10px 26px -14px rgba(0,51,141,.12)",
        }}
      >
        {/* Category Pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {[
            { id: "all", label: `All Sandboxes (${ENVIRONMENTS.length})` },
            { id: "google", label: "Google ADK" },
            { id: "langchain", label: "LangChain & LangGraph" },
            { id: "foundry", label: "Palantir Foundry AIP" },
            { id: "openai", label: "OpenAI Swarm" },
          ].map((cat) => {
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: isActive ? "1px solid var(--link, #005eb8)" : "1px solid rgba(0,51,141,0.14)",
                  background: isActive ? "rgba(0,94,184,0.1)" : "transparent",
                  color: isActive ? "var(--link, #005eb8)" : "var(--muted, #516a92)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Search Bar */}
        <div style={{ position: "relative", minWidth: 280 }}>
          <input
            type="text"
            placeholder="Search frameworks, features, tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input"
            style={{
              width: "100%",
              padding: "7px 12px 7px 32px",
              fontSize: 12.5,
              background: "var(--panel, #ffffff)",
              border: "1px solid rgba(0,51,141,0.2)",
              color: "var(--text, #0a1b3d)",
            }}
          />
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted, #516a92)" }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                color: "var(--muted, #516a92)",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Grid of Sandbox Tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(440px, 1fr))",
          gap: 22,
          marginBottom: 36,
        }}
      >
        {filteredEnvironments.map((env) => (
          <div
            key={env.id}
            className="card"
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: 24,
              background: "var(--panel, #ffffff)",
              border: "1px solid rgba(0,51,141,0.15)",
              borderRadius: "var(--radius)",
              position: "relative",
              overflow: "hidden",
              boxShadow: "0 1px 2px rgba(0,51,141,.05), 0 10px 26px -14px rgba(0,51,141,.22)",
              transition: "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,51,141,0.08), 0 16px 32px -12px rgba(0,51,141,0.2)";
              e.currentTarget.style.borderColor = "rgba(0,94,184,0.45)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,51,141,.05), 0 10px 26px -14px rgba(0,51,141,.22)";
              e.currentTarget.style.borderColor = "rgba(0,51,141,0.15)";
            }}
          >
            {/* Top Row: Icon + Badge + Presets counter */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {/* Framework Icon Container */}
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: env.iconBg,
                      border: `1px solid ${env.iconBorder}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: env.accentColor,
                    }}
                  >
                    {env.framework === "google" && (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="12 2 2 7 12 12 22 7 12 2" />
                        <polyline points="2 17 12 22 22 17" />
                        <polyline points="2 12 12 17 22 12" />
                      </svg>
                    )}
                    {env.framework === "langchain" && (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                    )}
                    {env.framework === "foundry" && (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        <circle cx="12" cy="11" r="3" />
                      </svg>
                    )}
                    {env.framework === "openai" && (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                    )}
                  </div>

                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 650, margin: 0, color: "var(--text, #0a1b3d)" }}>
                      {env.headline}
                    </h3>
                    <div style={{ fontSize: 11, color: "var(--muted, #516a92)", marginTop: 2 }}>
                      Runtime: {env.runtimeEngine}
                    </div>
                  </div>
                </div>

                <span
                  style={{
                    padding: "3px 9px",
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    color: env.badgeColor,
                    background: env.badgeBg,
                    border: `1px solid ${env.badgeBorder}`,
                  }}
                >
                  {env.badge}
                </span>
              </div>

              {/* Description */}
              <p style={{ fontSize: 13, color: "var(--muted-2, #2c4372)", lineHeight: 1.55, margin: "0 0 16px" }}>
                {env.description}
              </p>

              {/* Key Features Pill List */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted, #516a92)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Framework Capabilities
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {env.features.map((feat, idx) => (
                    <span
                      key={idx}
                      style={{
                        fontSize: 11,
                        padding: "3px 8px",
                        background: "rgba(0,51,141,0.04)",
                        border: "1px solid rgba(0,51,141,0.1)",
                        borderRadius: 4,
                        color: "var(--text, #0a1b3d)",
                      }}
                    >
                      <span style={{ color: env.accentColor, fontWeight: 700, marginRight: 4 }}>✓</span>
                      {feat}
                    </span>
                  ))}
                </div>
              </div>

              {/* Presets List */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted, #516a92)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Included Agent Templates ({env.presetsCount})
                  </span>
                  <span style={{ fontSize: 11, color: env.accentColor, fontWeight: 600 }}>
                    Ready to load
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {env.popularPresets.map((preset) => (
                    <span
                      key={preset.id}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        background: "#f0f4fa",
                        border: "1px solid rgba(0,51,141,0.12)",
                        borderRadius: 4,
                        color: "var(--ink, #00338d)",
                        fontFamily: "var(--mono)",
                      }}
                    >
                      {preset.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom Actions Bar */}
            <div
              style={{
                paddingTop: 16,
                borderTop: "1px solid rgba(0,51,141,0.08)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 11.5, color: "var(--muted, #516a92)" }}>
                Isolated Execution Sandbox
              </span>
              <Link
                href={env.route}
                className="btn btn-primary"
                style={{
                  padding: "8px 18px",
                  fontSize: 13,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: "var(--link, #005eb8)",
                  color: "#ffffff",
                  textDecoration: "none",
                  borderRadius: "var(--radius)",
                }}
              >
                <span>Launch Sandbox</span>
                <span style={{ fontSize: 14 }}>→</span>
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* Enterprise Architecture Value Section */}
      <div
        className="panel"
        style={{
          padding: 24,
          background: "var(--panel, #ffffff)",
          border: "1px solid rgba(0,51,141,0.15)",
          borderRadius: "var(--radius)",
          boxShadow: "0 1px 2px rgba(0,51,141,.05), 0 10px 26px -14px rgba(0,51,141,.18)",
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <span className="tag blue" style={{ fontSize: 10, padding: "1px 7px" }}>
            UNIVERSAL AGENT RUNTIME
          </span>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "6px 0 4px", color: "var(--text, #0a1b3d)" }}>
            Why Use Agent Studio Sandboxes?
          </h2>
          <p style={{ fontSize: 13, color: "var(--muted-2, #2c4372)", margin: 0, maxWidth: 880 }}>
            Bridge disparate agent engineering ecosystems without rewriting business logic or vendor locking your operations.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
          <div style={{ padding: "14px 16px", background: "#f8fafd", borderRadius: 6, border: "1px solid rgba(0,51,141,0.1)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink, #00338d)", marginBottom: 4 }}>
              1. Universal Ingestion
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-2, #2c4372)", lineHeight: 1.5 }}>
              Import code written for Google ADK, LangChain, Palantir Foundry, or OpenAI Swarm. Our AST parsers automatically decompile schemas, instructions, and tools.
            </div>
          </div>

          <div style={{ padding: "14px 16px", background: "#f8fafd", borderRadius: 6, border: "1px solid rgba(0,51,141,0.1)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink, #00338d)", marginBottom: 4 }}>
              2. Isolated Simulation
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-2, #2c4372)", lineHeight: 1.5 }}>
              Run agents with simulated enterprise telemetry, mock LLM gateways, or live frontier models (Gemini 2.5 Flash, Claude 3.5 Sonnet) before connecting live tools.
            </div>
          </div>

          <div style={{ padding: "14px 16px", background: "#f8fafd", borderRadius: 6, border: "1px solid rgba(0,51,141,0.1)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink, #00338d)", marginBottom: 4 }}>
              3. Governed Promotion
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-2, #2c4372)", lineHeight: 1.5 }}>
              Promote sandbox prototypes directly to Agent Studio. Action types and tool calls receive enterprise human-in-the-loop approval gates automatically.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
