"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ParsedAdkAgent, AdkTool } from "@/lib/adk-parser";
import type { SandboxRunResult, SandboxStepLog } from "@/lib/adk-sandbox";

type Template = {
  id: string;
  title: string;
  language: "python" | "typescript" | "json";
  blurb: string;
  code: string;
};

export default function ADKSandboxPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("order-support");
  const [language, setLanguage] = useState<"python" | "typescript" | "json">("python");
  const [sourceCode, setSourceCode] = useState<string>("");
  const [parsing, setParsing] = useState<boolean>(false);
  const [parseError, setParseError] = useState<string>("");
  const [parsedAgent, setParsedAgent] = useState<ParsedAdkAgent | null>(null);

  // Execution state
  const [engine, setEngine] = useState<"auto" | "gemini" | "claude" | "simulation">("auto");
  const [model, setModel] = useState<string>("gemini-2.5-flash");
  const [inputMessage, setInputMessage] = useState<string>(
    "Customer Alex requests full refund for order #ORD-98231 because goods were defective."
  );
  const [running, setRunning] = useState<boolean>(false);
  const [runError, setRunError] = useState<string>("");
  const [runResult, setRunResult] = useState<SandboxRunResult | null>(null);

  // Promote state
  const [showPromoteModal, setShowPromoteModal] = useState<boolean>(false);
  const [promoteName, setPromoteName] = useState<string>("");
  const [promoteDescription, setPromoteDescription] = useState<string>("");
  const [promoting, setPromoting] = useState<boolean>(false);
  const [promoteSuccess, setPromoteSuccess] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState<string>("");

  // Copy notification
  const [copied, setCopied] = useState<boolean>(false);

  // Load templates on mount
  useEffect(() => {
    async function loadTemplates() {
      try {
        if (typeof window !== "undefined") {
          const imported = sessionStorage.getItem("sandbox_imported_code");
          const importedLang = sessionStorage.getItem("sandbox_imported_lang") as "python" | "typescript" | "json";
          if (imported) {
            sessionStorage.removeItem("sandbox_imported_code");
            sessionStorage.removeItem("sandbox_imported_lang");
            setSelectedTemplateId("");
            setLanguage(importedLang || "json");
            setSourceCode(imported);
            parseSource(imported, importedLang || "json");
            return;
          }
        }

        const res = await fetch("/api/sandbox/templates");
        if (res.ok) {
          const data = await res.json();
          setTemplates(data.templates || []);
          if (data.templates?.length) {
            const first = data.templates[0];
            setSelectedTemplateId(first.id);
            setLanguage(first.language);
            setSourceCode(first.code);
            parseSource(first.code, first.language);
          }
        }
      } catch (err) {
        console.error("Failed to load templates", err);
      }
    }
    loadTemplates();
  }, []);

  async function parseSource(codeToParse: string, lang: "python" | "typescript" | "json") {
    setParsing(true);
    setParseError("");
    try {
      const res = await fetch("/api/sandbox/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeToParse, language: lang }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to parse ADK specification");
      }
      const agent: ParsedAdkAgent = data.parsed;
      setParsedAgent(agent);
      setPromoteName(agent.name || "Imported Google ADK Agent");
      setPromoteDescription(agent.spec?.purpose || agent.instruction?.slice(0, 140) || "");
    } catch (err: any) {
      setParseError(err.message || String(err));
      setParsedAgent(null);
    } finally {
      setParsing(false);
    }
  }

  function handleSelectTemplate(tmpl: Template) {
    setSelectedTemplateId(tmpl.id);
    setLanguage(tmpl.language);
    setSourceCode(tmpl.code);
    setRunResult(null);
    parseSource(tmpl.code, tmpl.language);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith(".zip")) {
      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(file);

        // 1. Look for agent.json
        const agentJsonFile = zip.file("agent.json") || Object.values(zip.files).find((f) => f.name.endsWith("agent.json"));
        if (agentJsonFile) {
          const content = await agentJsonFile.async("string");
          setSelectedTemplateId("");
          setLanguage("json");
          setSourceCode(content);
          setRunResult(null);
          parseSource(content, "json");
          return;
        }

        // 2. Look for runner.mjs, server.mjs, or handler.mjs
        const runnerJs = Object.values(zip.files).find((f) => !f.dir && (f.name.endsWith("runner.mjs") || f.name.endsWith("handler.mjs") || f.name.endsWith("server.mjs")));
        if (runnerJs) {
          const content = await runnerJs.async("string");
          setSelectedTemplateId("");
          setLanguage("typescript");
          setSourceCode(content);
          setRunResult(null);
          parseSource(content, "typescript");
          return;
        }

        // 3. Look for runner.py or main.py
        const runnerPy = Object.values(zip.files).find((f) => !f.dir && (f.name.endsWith("runner.py") || f.name.endsWith("main.py") || f.name.endsWith("agent.py")));
        if (runnerPy) {
          const content = await runnerPy.async("string");
          setSelectedTemplateId("");
          setLanguage("python");
          setSourceCode(content);
          setRunResult(null);
          parseSource(content, "python");
          return;
        }

        // 4. Any json or code file
        const anyCode = Object.values(zip.files).find((f) => !f.dir && (f.name.endsWith(".json") || f.name.endsWith(".py") || f.name.endsWith(".ts") || f.name.endsWith(".mjs")));
        if (anyCode) {
          const content = await anyCode.async("string");
          const lang = anyCode.name.endsWith(".json") ? "json" : anyCode.name.endsWith(".py") ? "python" : "typescript";
          setSelectedTemplateId("");
          setLanguage(lang);
          setSourceCode(content);
          setRunResult(null);
          parseSource(content, lang);
          return;
        }
      } catch (err: any) {
        console.error("Failed to extract zip archive:", err);
      }
    }

    let inferredLang: "python" | "typescript" | "json" = "python";
    if (file.name.endsWith(".ts") || file.name.endsWith(".tsx") || file.name.endsWith(".js") || file.name.endsWith(".mjs")) {
      inferredLang = "typescript";
    } else if (file.name.endsWith(".json")) {
      inferredLang = "json";
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setSelectedTemplateId("");
        setLanguage(inferredLang);
        setSourceCode(text);
        setRunResult(null);
        parseSource(text, inferredLang);
      }
    };
    reader.readAsText(file);
  }

  function handleFormatChange(newFmt: "python" | "typescript" | "json") {
    setLanguage(newFmt);
    const trimmed = sourceCode.trim();

    // 1. If switching to JSON and current code is Python or TypeScript
    if (newFmt === "json" && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      if (parsedAgent) {
        // Transpile active agent into valid Google ADK JSON config
        const jsonObj = {
          name: parsedAgent.name || "Google ADK Agent",
          model: parsedAgent.model || "gemini-2.5-flash",
          instruction: parsedAgent.instruction || "Execute assigned goals according to ADK specification.",
          tools: (parsedAgent.tools || []).map((t) => ({
            name: t.name,
            description: t.description || `Execute ${t.name}`,
            parameters: t.parameters || { type: "object", properties: {}, required: [] },
          })),
        };
        const pretty = JSON.stringify(jsonObj, null, 2);
        setSourceCode(pretty);
        parseSource(pretty, "json");
        return;
      } else {
        const jsonTmpl = templates.find((t) => t.language === "json");
        if (jsonTmpl) {
          setSourceCode(jsonTmpl.code);
          parseSource(jsonTmpl.code, "json");
          return;
        }
      }
    }

    // 2. If switching to Python and current code is JSON
    if (newFmt === "python" && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
      if (parsedAgent) {
        const toolsPy = (parsedAgent.tools || [])
          .map(
            (t) => `@tool
def ${t.name}(**kwargs) -> dict:
    """${t.description || t.name}"""
    return {"status": "success"}`
          )
          .join("\n\n");
        const toolsList = (parsedAgent.tools || []).map((t) => t.name).join(", ");
        const pyCode = `from google.adk import Agent
from google.adk.tools import tool

${toolsPy}

agent = Agent(
    name="${parsedAgent.name}",
    model="${parsedAgent.model || "gemini-2.5-flash"}",
    instruction="""${parsedAgent.instruction}""",
    tools=[${toolsList}]
)
`;
        setSourceCode(pyCode);
        parseSource(pyCode, "python");
        return;
      }
    }

    // 3. If switching to TypeScript and current code is JSON
    if (newFmt === "typescript" && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
      if (parsedAgent) {
        const toolsTs = (parsedAgent.tools || [])
          .map(
            (t) => `const ${t.name} = tool({
  name: "${t.name}",
  description: "${t.description || t.name}",
  parameters: ${JSON.stringify(t.parameters || { type: "object", properties: {} }, null, 2)}
});`
          )
          .join("\n\n");
        const toolsList = (parsedAgent.tools || []).map((t) => t.name).join(", ");
        const tsCode = `import { Agent, tool } from "@google/adk";

${toolsTs}

export const agent = new Agent({
  name: "${parsedAgent.name}",
  model: "${parsedAgent.model || "gemini-2.5-flash"}",
  instruction: \`${parsedAgent.instruction}\`,
  tools: [${toolsList}]
});
`;
        setSourceCode(tsCode);
        parseSource(tsCode, "typescript");
        return;
      }
    }

    parseSource(sourceCode, newFmt);
  }

  async function handleRunTest() {
    if (!parsedAgent) return;
    setRunning(true);
    setRunError("");
    try {
      const res = await fetch("/api/sandbox/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec: parsedAgent.spec,
          tools: parsedAgent.tools,
          input: inputMessage,
          engine,
          model,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Execution failed");
      }
      setRunResult(data.result);
    } catch (err: any) {
      setRunError(err.message || String(err));
    } finally {
      setRunning(false);
    }
  }

  async function handlePromote() {
    if (!parsedAgent) return;
    setPromoting(true);
    setPromoteError("");
    setPromoteSuccess(null);
    try {
      const res = await fetch("/api/sandbox/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: promoteName,
          spec: {
            ...parsedAgent.spec,
            name: promoteName,
            purpose: promoteDescription,
          },
          sourceCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to promote agent");
      }
      setPromoteSuccess(data.agentId);
      setTimeout(() => {
        router.push(`/agents/${data.agentId}`);
      }, 1000);
    } catch (err: any) {
      setPromoteError(err.message || String(err));
    } finally {
      setPromoting(false);
    }
  }

  function handleCopySource() {
    navigator.clipboard.writeText(sourceCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="page">
      {/* Header */}
      <header className="page-head" style={{ marginBottom: 20 }}>
        <div>
          <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Link href="/sandbox" style={{ color: "var(--link)", textDecoration: "none" }}>← SANDBOXES HUB</Link>
            <span style={{ opacity: 0.35 }}>/</span>
            <span style={{ color: "var(--sky-4, #007a78)" }}>GOOGLE ADK</span>
            <span className="tag green" style={{ fontSize: 10, padding: "1px 7px" }}>READY</span>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: "4px 0 6px" }}>Google ADK Sandbox</h1>
          <p className="sub" style={{ maxWidth: 840, fontSize: 13, color: "var(--muted-2)", margin: 0 }}>
            Import Google Agent Development Kit (ADK) agents defined in Python, TypeScript, or JSON. Decompile instructions,
            inspect enterprise tool bindings, simulate or execute live reasoning traces with Gemini / Claude, and promote directly into Agent Studio.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", alignSelf: "flex-start", marginTop: 4 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleCopySource}
            title="Copy ADK code"
            style={{ fontSize: 12.5 }}
          >
            {copied ? "✓ Copied" : "Copy Code"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowPromoteModal(true)}
            disabled={!parsedAgent}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            Promote to Agent Studio
          </button>
        </div>
      </header>

      {/* Main Grid: Left = Unified Code Studio, Right = Decompiled Spec & Execution */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.08fr", gap: 22, alignItems: "start" }}>
        
        {/* LEFT COLUMN: UNIFIED ADK CODE STUDIO */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            border: "1px solid rgba(0,51,141,.18)",
            borderRadius: "var(--radius)",
            background: "#080e1c",
            overflow: "hidden",
            boxShadow: "0 2px 10px rgba(0,20,60,.12)",
            minHeight: 700,
          }}
        >
          {/* Top Control Bar: Presets & File Actions */}
          <div
            style={{
              padding: "10px 14px",
              background: "#0f1a33",
              borderBottom: "1px solid rgba(255,255,255,.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            {/* Presets Segmented Tabs */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10.5, fontFamily: "var(--mono)", letterSpacing: ".08em", color: "#94a3b8", textTransform: "uppercase" }}>
                Presets:
              </span>
              <div style={{ display: "inline-flex", background: "rgba(0,0,0,.3)", borderRadius: 7, padding: 2, gap: 2 }}>
                {templates.map((tmpl) => {
                  const label =
                    tmpl.id === "order-support"
                      ? "Order Support"
                      : tmpl.id === "forensic-audit"
                      ? "Forensic Audit"
                      : tmpl.id === "data-pipeline"
                      ? "Data Pipeline"
                      : "DevOps Triage";
                  const active = selectedTemplateId === tmpl.id;
                  return (
                    <button
                      key={tmpl.id}
                      type="button"
                      onClick={() => handleSelectTemplate(tmpl)}
                      style={{
                        padding: "5px 11px",
                        fontSize: 12,
                        fontWeight: active ? 600 : 500,
                        borderRadius: 5,
                        border: "none",
                        cursor: "pointer",
                        background: active ? "var(--ink, #00338d)" : "transparent",
                        color: active ? "#ffffff" : "#94a3b8",
                        transition: "all .15s ease",
                        whiteSpace: "nowrap",
                      }}
                      title={tmpl.title}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Action: File Upload */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".zip,.py,.ts,.tsx,.js,.mjs,.json"
                style={{ display: "none" }}
              />
              <button
                type="button"
                className="btn"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  fontSize: 11.5,
                  padding: "4px 10px",
                  height: 28,
                  background: "rgba(255,255,255,.08)",
                  borderColor: "rgba(255,255,255,.14)",
                  color: "#cbd5e1",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
                title="Upload .py, .ts, or .json file"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Upload File
              </button>
            </div>
          </div>

          {/* Subheader: Editor Tab, Format Tags & Decompile Button */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "7px 14px",
              background: "#0a1224",
              borderBottom: "1px solid rgba(255,255,255,.06)",
              fontSize: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "var(--mono)", color: "#e2e8f0", fontSize: 12 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: language === "python" ? "#38bdf8" : language === "typescript" ? "#facc15" : "#4ade80",
                  }}
                />
                <span style={{ fontWeight: 500 }}>
                  {language === "python" ? "agent_adk.py" : language === "typescript" ? "agent_adk.ts" : "agent_spec.json"}
                </span>
              </div>

              {/* Format pills */}
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {(["python", "typescript", "json"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => handleFormatChange(fmt)}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10,
                      padding: "2px 7px",
                      borderRadius: 4,
                      border: language === fmt ? "1px solid #38bdf8" : "1px solid rgba(255,255,255,.12)",
                      background: language === fmt ? "rgba(56,189,248,.18)" : "transparent",
                      color: language === fmt ? "#38bdf8" : "#94a3b8",
                      cursor: "pointer",
                      textTransform: "uppercase",
                      letterSpacing: ".04em",
                    }}
                  >
                    {fmt === "python" ? "py" : fmt === "typescript" ? "ts" : "json"}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => parseSource(sourceCode, language)}
                disabled={parsing || !sourceCode.trim()}
                style={{
                  fontSize: 11.5,
                  padding: "3px 12px",
                  height: 26,
                  borderRadius: 5,
                  fontWeight: 500,
                }}
              >
                {parsing ? "Parsing..." : "Decompile ADK"}
              </button>
            </div>
          </div>

          {/* Editor Body */}
          <div style={{ flex: 1, display: "flex", position: "relative" }}>
            <textarea
              value={sourceCode}
              onChange={(e) => setSourceCode(e.target.value)}
              placeholder="Paste Google ADK Python code (Agent(...)), TypeScript, or JSON config here..."
              style={{
                flex: 1,
                width: "100%",
                padding: "14px 16px",
                background: "transparent",
                color: "#e2e8f0",
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                lineHeight: 1.65,
                border: "none",
                outline: "none",
                resize: "none",
                minHeight: 560,
              }}
              spellCheck={false}
            />
          </div>

          {parseError && (
            <div
              style={{
                margin: "8px 12px 12px",
                padding: "8px 12px",
                background: "var(--warn-bg)",
                border: "1px solid rgba(198,0,126,.2)",
                color: "var(--warn)",
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              <strong>Decompilation Error:</strong> {parseError}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: DECOMPILED SPEC & INTERACTIVE RUNNER */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          
          {/* Decompiled Summary Panel */}
          {parsedAgent ? (
            <div
              style={{
                background: "#ffffff",
                border: "1px solid rgba(0,51,141,.15)",
                borderRadius: "var(--radius)",
                padding: "18px 20px",
                boxShadow: "0 1px 3px rgba(0,51,141,.05)",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {/* Card Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="eyebrow" style={{ fontSize: 10.5 }}>DECOMPILED SPEC</span>
                  <span className="tag green" style={{ fontSize: 10, padding: "1px 7px" }}>{parsedAgent.archetype.toUpperCase()}</span>
                  <span className="tag tag-neutral" style={{ fontSize: 10, padding: "1px 7px" }}>{parsedAgent.model}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowPromoteModal(true)}
                  style={{ fontSize: 12, color: "var(--link)", padding: "2px 6px" }}
                >
                  Edit & Promote →
                </button>
              </div>

              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 3px", color: "var(--text)" }}>{parsedAgent.name}</h2>
                {parsedAgent.spec?.purpose && (
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted-2)", lineHeight: 1.45 }}>
                    {parsedAgent.spec.purpose}
                  </p>
                )}
              </div>

              {/* Steps Extraction */}
              <div>
                <div className="eyebrow" style={{ fontSize: 10.5, marginBottom: 7 }}>
                  Identified Execution Steps ({parsedAgent.steps?.length || 0}):
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {(parsedAgent.steps || []).map((st: string, idx: number) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "7px 11px",
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 6,
                        fontSize: 12,
                        lineHeight: 1.45,
                      }}
                    >
                      <span
                        style={{
                          width: 19,
                          height: 19,
                          borderRadius: "50%",
                          background: "#e2e8f0",
                          color: "#334155",
                          fontSize: 10.5,
                          fontWeight: 700,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          marginTop: 1,
                        }}
                      >
                        {idx + 1}
                      </span>
                      <span style={{ color: "#334155" }}>{st}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mapped Tools & Approval Gates */}
              <div>
                <div className="eyebrow" style={{ fontSize: 10.5, marginBottom: 7 }}>
                  Transpiled Tool Bindings & Governance ({parsedAgent.tools?.length || 0}):
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {(parsedAgent.tools || []).map((t: AdkTool, idx: number) => (
                    <div
                      key={idx}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "180px 1fr auto",
                        alignItems: "center",
                        gap: 12,
                        padding: "7px 12px",
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    >
                      <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }} title={t.name}>
                          {t.name}
                        </span>
                      </div>
                      <div style={{ color: "#64748b", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.description}>
                        {t.description}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <span className="tag green" style={{ fontSize: 10, padding: "1px 7px" }}>
                          ACTIVE TOOL
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: 36,
                textAlign: "center",
                background: "#f8fafc",
                border: "1px dashed #cbd5e1",
                borderRadius: "var(--radius)",
              }}
            >
              <div className="eyebrow">Ready for Decompilation</div>
              <p style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 0" }}>
                Select a preset template or paste your Google ADK agent code on the left to extract the execution graph.
              </p>
            </div>
          )}

          {/* Interactive Test & Trace Runner Panel */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid rgba(0,51,141,.15)",
              borderRadius: "var(--radius)",
              padding: "18px 20px",
              boxShadow: "0 1px 3px rgba(0,51,141,.05)",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Header: Title and Engine / Model Selectors */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div className="eyebrow" style={{ fontSize: 10.5 }}>LIVE EXECUTION RUNNER</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: "2px 0 0", color: "var(--text)" }}>Test Agent Reasoning</h3>
              </div>

              {/* Engine Selector */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <select
                  value={engine}
                  onChange={(e) => {
                    const newEngine = e.target.value as any;
                    setEngine(newEngine);
                    if (newEngine === "gemini") setModel("gemini-2.5-flash");
                    else if (newEngine === "claude") setModel("claude-3-5-sonnet-20241022");
                    else if (newEngine === "simulation") setModel("simulator");
                    else setModel("gemini-2.5-flash");
                  }}
                  className="select-sm"
                  style={{ fontSize: 12, padding: "4px 8px", height: 28 }}
                >
                  <option value="auto">Auto (Gemini / Claude / Sim)</option>
                  <option value="gemini">Google Gemini (Native ADK)</option>
                  <option value="claude">Anthropic Claude</option>
                  <option value="simulation">Local Simulator</option>
                </select>

                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="select-sm"
                  style={{ fontSize: 12, padding: "4px 8px", height: 28 }}
                >
                  {engine === "gemini" ? (
                    <>
                      <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                      <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                    </>
                  ) : engine === "claude" ? (
                    <>
                      <option value="claude-3-5-sonnet-20241022">claude-3-5-sonnet</option>
                      <option value="claude-3-5-haiku-20241022">claude-3-5-haiku</option>
                    </>
                  ) : engine === "simulation" ? (
                    <option value="simulator">Deterministic Simulator</option>
                  ) : (
                    <>
                      <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                      <option value="claude-3-5-sonnet-20241022">claude-3-5-sonnet</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            {/* Input Prompt Box with integrated Run Test Button */}
            <div>
              <div className="eyebrow" style={{ fontSize: 10.5, marginBottom: 6 }}>Test User Input:</div>
              <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="Enter a prompt to test your ADK agent..."
                  className="input"
                  style={{ flex: 1, fontSize: 12.5, height: 36, padding: "7px 12px" }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !running && parsedAgent) {
                      handleRunTest();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleRunTest}
                  disabled={running || !parsedAgent || !inputMessage.trim()}
                  style={{ minWidth: 96, height: 36, justifyContent: "center", fontSize: 12.5, fontWeight: 600, flexShrink: 0 }}
                >
                  {running ? "Running..." : "Run Test"}
                </button>
              </div>
            </div>

            {runError && (
              <div
                style={{
                  padding: "8px 12px",
                  background: "var(--warn-bg)",
                  border: "1px solid rgba(198,0,126,.2)",
                  color: "var(--warn)",
                  borderRadius: "var(--radius)",
                  fontSize: 12.5,
                }}
              >
                <strong>Execution Error:</strong> {runError}
              </div>
            )}

            {/* Execution Trace Stream */}
            {runResult && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 2 }}>
                
                {/* Metrics header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "7px 12px",
                    background: "#f1f5f9",
                    borderRadius: 6,
                    fontSize: 11.5,
                    color: "#475569",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="tag green" style={{ fontSize: 10, padding: "1px 6px" }}>COMPLETED</span>
                    <span>Engine: <strong>{runResult.engine}</strong> ({runResult.model})</span>
                  </div>
                  <span className="mono" style={{ fontSize: 11 }}>Duration: <strong>{runResult.durationMs}ms</strong></span>
                </div>

                {/* Steps Trace Accordion */}
                <div
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    background: "#0a1122",
                    padding: "12px 14px",
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    color: "#cbd5e1",
                    maxHeight: 340,
                    overflowY: "auto",
                  }}
                >
                  <div style={{ color: "#38bdf8", marginBottom: 8, fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>❯</span>
                    <span>LIVE REASONING & TOOL TRACE</span>
                  </div>

                  {(runResult.steps || []).map((tr: SandboxStepLog, idx: number) => (
                    <div key={idx} style={{ marginBottom: 12, borderBottom: "1px solid rgba(255,255,255,.06)", paddingBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#94a3b8", fontSize: 11 }}>
                        <span style={{ color: "#38bdf8", fontWeight: 600 }}>Step {tr.step}:</span>
                        <span>{tr.durationMs}ms</span>
                      </div>

                      {tr.thought && (
                        <div style={{ color: "#e2e8f0", margin: "4px 0", fontStyle: "italic", fontSize: 11.5, lineHeight: 1.5 }}>
                          💭 {tr.thought}
                        </div>
                      )}

                      {tr.tool && (
                        <div
                          style={{
                            margin: "5px 0",
                            background: "rgba(56,189,248,.08)",
                            border: "1px solid rgba(56,189,248,.2)",
                            padding: "6px 8px",
                            borderRadius: 4,
                          }}
                        >
                          <div style={{ color: "#38bdf8", fontWeight: 600, fontSize: 11.5 }}>
                            ⚡ Tool Call: <span style={{ color: "#fff" }}>{tr.tool}</span>
                          </div>
                          {tr.input && (
                            <pre style={{ margin: "4px 0 0", fontSize: 11, color: "#93c5fd", overflowX: "auto" }}>
                              {JSON.stringify(tr.input, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}

                      {tr.output && (
                        <div
                          style={{
                            margin: "5px 0",
                            background:
                              tr.status === "error"
                                ? "rgba(239,68,68,.1)"
                                : "rgba(34,197,94,.08)",
                            border: `1px solid ${
                              tr.status === "error"
                                ? "rgba(239,68,68,.3)"
                                : "rgba(34,197,94,.2)"
                            }`,
                            padding: "6px 8px",
                            borderRadius: 4,
                          }}
                        >
                          <div
                            style={{
                              color: tr.status === "error" ? "#f87171" : "#4ade80",
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {tr.status === "error" ? "✕ Tool Error" : "✓ Tool Result"}
                          </div>
                          <pre
                            style={{
                              margin: "4px 0 0",
                              fontSize: 11,
                              color: "#bbf7d0",
                              overflowX: "auto",
                            }}
                          >
                            {JSON.stringify(tr.output, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Final Answer Deliverable */}
                <div
                  style={{
                    padding: "12px 14px",
                    background: "#f8fafc",
                    border: "1px solid #cbd5e1",
                    borderRadius: 6,
                  }}
                >
                  <div className="eyebrow" style={{ fontSize: 10, color: "var(--ink)", marginBottom: 4 }}>
                    FINAL AGENT OUTPUT / DELIVERABLE
                  </div>
                  <div style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {runResult.output}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Promote to Production Modal */}
      {showPromoteModal && parsedAgent && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(13,21,39,.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPromoteModal(false);
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              background: "#ffffff",
              padding: "24px 28px",
              borderRadius: "var(--radius)",
              boxShadow: "0 20px 50px rgba(0,0,0,.3)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              border: "1px solid rgba(0,51,141,.2)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <div className="eyebrow" style={{ fontSize: 10 }}>GOVERNANCE PROMOTION</div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: "4px 0 0", color: "var(--text)" }}>Promote ADK Agent to Agent Studio</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowPromoteModal(false)}
                title="Close"
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: 13, color: "var(--muted-2)", margin: 0, lineHeight: 1.5 }}>
              Promoting creates a full Agent Studio agent with audit trails, encrypted connections, scheduled automations,
              and human-in-the-loop approval gates.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label className="field">
                <div className="eyebrow">Agent Name</div>
                <input
                  type="text"
                  value={promoteName}
                  onChange={(e) => setPromoteName(e.target.value)}
                  className="input"
                  placeholder="e.g. Order Support Concierge"
                  required
                />
              </label>

              <label className="field">
                <div className="eyebrow">Description / Mission</div>
                <textarea
                  value={promoteDescription}
                  onChange={(e) => setPromoteDescription(e.target.value)}
                  className="textarea"
                  rows={3}
                  placeholder="What does this agent do?"
                />
              </label>

              <div
                style={{
                  background: "#f8fafc",
                  padding: "10px 14px",
                  borderRadius: 6,
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                  color: "#475569",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 5, color: "var(--ink)" }}>Attached Security Policies:</div>
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                  <li>{parsedAgent.tools?.length || 0} ADK tools transpiled to studio specifications</li>
                  <li>All database queries constrained to read-only replica pools</li>
                  <li>Multi-cloud export enabled (GCP Cloud Run, AWS Lambda, Azure Container Apps)</li>
                </ul>
              </div>
            </div>

            {promoteError && (
              <div
                style={{
                  padding: "8px 12px",
                  background: "var(--warn-bg)",
                  color: "var(--warn)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                {promoteError}
              </div>
            )}

            {promoteSuccess && (
              <div
                style={{
                  padding: "8px 12px",
                  background: "var(--ok-bg)",
                  color: "#007a78",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                ✓ Agent promoted successfully! Redirecting to agent builder...
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowPromoteModal(false)}
                disabled={promoting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handlePromote}
                disabled={promoting || !promoteName.trim()}
              >
                {promoting ? "Promoting Agent..." : "Confirm Promotion"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
