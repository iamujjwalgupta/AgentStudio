"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ParsedOpenAIAgent, OpenAITool } from "@/lib/openai-parser";
import type { SandboxRunResult, SandboxStepLog } from "@/lib/adk-sandbox";

type Template = {
  id: string;
  title: string;
  language: "python" | "json";
  blurb: string;
  code: string;
};

export default function OpenAISandboxPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("tiered-support-swarm");
  const [language, setLanguage] = useState<"python" | "json">("python");
  const [sourceCode, setSourceCode] = useState<string>("");
  const [parsing, setParsing] = useState<boolean>(false);
  const [parseError, setParseError] = useState<string>("");
  const [parsedAgent, setParsedAgent] = useState<ParsedOpenAIAgent | null>(null);

  // Execution state
  const [engine, setEngine] = useState<"auto" | "gemini" | "claude" | "simulation">("claude");
  const [model, setModel] = useState<string>("claude-3-5-sonnet-20241022");
  const [inputMessage, setInputMessage] = useState<string>(
    "Order #ORD-8821 arrived with crushed packaging and broken contents. I need a full refund immediately."
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
          const importedLang = sessionStorage.getItem("sandbox_imported_lang") as "python" | "json";
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

        const res = await fetch("/api/sandbox/templates?framework=openai");
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
        console.error("Failed to load OpenAI templates", err);
      }
    }
    loadTemplates();
  }, []);

  async function parseSource(codeToParse: string, lang: "python" | "json") {
    setParsing(true);
    setParseError("");
    try {
      const res = await fetch("/api/sandbox/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeToParse, language: lang, framework: "openai" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to parse OpenAI Swarm/Assistant specification");
      }
      const agent: ParsedOpenAIAgent = data.parsed;
      setParsedAgent(agent);
      setPromoteName(agent.name || "Imported OpenAI Agent");
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

        // 2. Look for runner.py or main.py
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

        // 3. Any json or python
        const anyCode = Object.values(zip.files).find((f) => !f.dir && (f.name.endsWith(".json") || f.name.endsWith(".py")));
        if (anyCode) {
          const content = await anyCode.async("string");
          const lang = anyCode.name.endsWith(".json") ? "json" : "python";
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

    let inferredLang: "python" | "json" = "python";
    if (file.name.endsWith(".json")) {
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

  function handleFormatChange(newFmt: "python" | "json") {
    setLanguage(newFmt);
    const trimmed = sourceCode.trim();

    if (newFmt === "json" && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      if (parsedAgent) {
        const jsonObj = {
          name: parsedAgent.name,
          model: parsedAgent.model,
          instructions: parsedAgent.instruction,
          tools: (parsedAgent.tools || []).map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters || {},
            },
          })),
          handoffs: parsedAgent.handoffs,
        };
        const pretty = JSON.stringify(jsonObj, null, 2);
        setSourceCode(pretty);
        parseSource(pretty, "json");
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
            <span style={{ color: "#10b981" }}>OPENAI ASSISTANTS & SWARM</span>
            <span className="tag green" style={{ fontSize: 10, padding: "1px 7px", background: "rgba(16,185,129,0.15)", color: "#34d399", border: "1px solid rgba(16,185,129,0.3)" }}>MULTI-AGENT</span>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: "4px 0 6px" }}>OpenAI Assistants & Swarm Sandbox</h1>
          <p className="sub" style={{ maxWidth: 840, fontSize: 13, color: "var(--muted-2)", margin: 0 }}>
            Import OpenAI Swarm multi-agent routines, handoff transition chains (`transfer_to_...`), and Assistants API function tools.
            Simulate choreography and promote directly into Agent Studio.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", alignSelf: "flex-start", marginTop: 4 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleCopySource}
            title="Copy OpenAI code"
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
        
        {/* LEFT COLUMN: UNIFIED CODE STUDIO */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            border: "1px solid rgba(16,185,129,.25)",
            borderRadius: "var(--radius)",
            background: "#080e1c",
            overflow: "hidden",
            boxShadow: "0 2px 10px rgba(0,20,60,.12)",
            minHeight: 700,
          }}
        >
          {/* Top Control Bar */}
          <div
            style={{
              padding: "10px 14px",
              background: "#0f1a33",
              borderBottom: "1px solid rgba(255,255,255,.08)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "var(--muted)", textTransform: "uppercase" }}>
                Swarm Preset:
              </span>
              <select
                value={selectedTemplateId}
                onChange={(e) => {
                  const tmpl = templates.find((t) => t.id === e.target.value);
                  if (tmpl) handleSelectTemplate(tmpl);
                }}
                className="input"
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  height: 30,
                  maxWidth: 240,
                  background: "rgba(0,0,0,0.35)",
                  borderColor: "rgba(16,185,129,0.35)",
                }}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {/* Language Pills */}
              <div style={{ display: "inline-flex", background: "rgba(0,0,0,0.4)", borderRadius: 6, padding: 2, border: "1px solid rgba(255,255,255,0.06)" }}>
                {(["python", "json"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => handleFormatChange(fmt)}
                    style={{
                      padding: "3px 9px",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 4,
                      border: "none",
                      cursor: "pointer",
                      background: language === fmt ? "rgba(16,185,129,0.35)" : "transparent",
                      color: language === fmt ? "#a7f3d0" : "var(--muted)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {fmt === "python" ? "Python (Swarm SDK)" : fmt.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Upload button */}
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: "none" }}
                accept=".zip,.py,.json"
                onChange={handleFileUpload}
              />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => fileInputRef.current?.click()}
                title="Upload OpenAI specification file"
                style={{ fontSize: 11.5, padding: "4px 10px", height: 28 }}
              >
                Upload File
              </button>
            </div>
          </div>

          {/* Subheader info bar */}
          <div
            style={{
              padding: "6px 14px",
              background: "rgba(0,0,0,0.25)",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 11,
              color: "var(--muted-2)",
            }}
          >
            <span>
              {parsing ? (
                <span style={{ color: "var(--sky-4)" }}>Parsing OpenAI Swarm/Assistant...</span>
              ) : parsedAgent ? (
                <span>
                  Agent: <strong style={{ color: "#fff" }}>{parsedAgent.name}</strong> • Handoffs: <strong style={{ color: "#34d399" }}>{parsedAgent.handoffs.length}</strong> • Tools: <strong style={{ color: "var(--sky-4)" }}>{parsedAgent.tools.length}</strong>
                </span>
              ) : (
                <span>No valid specification parsed</span>
              )}
            </span>
            <span style={{ fontFamily: "monospace", opacity: 0.7 }}>
              {sourceCode.split("\n").length} lines
            </span>
          </div>

          {/* Code Textarea with monospaced editor styling */}
          <div style={{ position: "relative", flex: 1, minHeight: 620, display: "flex" }}>
            <textarea
              value={sourceCode}
              onChange={(e) => {
                const updated = e.target.value;
                setSourceCode(updated);
                parseSource(updated, language);
              }}
              spellCheck={false}
              style={{
                width: "100%",
                height: "100%",
                minHeight: 620,
                resize: "none",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 12.5,
                lineHeight: 1.6,
                padding: "16px 18px",
                background: "transparent",
                color: "#e2e8f0",
                border: "none",
                outline: "none",
                tabSize: 2,
              }}
            />
          </div>

          {parseError && (
            <div
              style={{
                padding: "10px 14px",
                background: "rgba(239,68,68,0.12)",
                borderTop: "1px solid rgba(239,68,68,0.3)",
                color: "#fca5a5",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>⚠️ Parse Notice: {parseError}</span>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: DECOMPILED SPEC & LIVE EXECUTION */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Card 1: OpenAI Swarm & Assistants Architecture Inspector */}
          <div
            className="card"
            style={{
              padding: 18,
              background: "#0d1527",
              borderColor: "rgba(16,185,129,0.25)",
              borderRadius: "var(--radius)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="tag green" style={{ background: "rgba(16,185,129,0.2)", color: "#34d399", border: "1px solid rgba(16,185,129,0.4)", fontSize: 11 }}>
                  OPENAI SWARM
                </span>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "#fff" }}>
                  Swarm Choreography & Function Calling
                </h3>
              </div>
              {parsedAgent && (
                <span className="tag teal" style={{ fontSize: 11 }}>
                  {parsedAgent.archetype.toUpperCase()} ARCHETYPE
                </span>
              )}
            </div>

            {parsedAgent ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Agent Metadata row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.25)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--muted)", fontWeight: 700 }}>Agent Name</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginTop: 2 }}>{parsedAgent.name}</div>
                  </div>
                  <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.25)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--muted)", fontWeight: 700 }}>Model</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--sky-4)", marginTop: 2 }}>{parsedAgent.model || "gpt-4o"}</div>
                  </div>
                </div>

                {/* Swarm Handoff Routines */}
                {parsedAgent.handoffs.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-2)", textTransform: "uppercase", marginBottom: 6 }}>
                      Swarm Agent Handoff Routines ({parsedAgent.handoffs.length})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {parsedAgent.handoffs.map((handoff, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 12px",
                            background: "rgba(16,185,129,0.1)",
                            border: "1px solid rgba(16,185,129,0.3)",
                            borderRadius: 6,
                            fontSize: 12,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ color: "#34d399", fontWeight: 700 }}>⇄</span>
                            <span style={{ fontWeight: 600, color: "#e2e8f0", fontFamily: "monospace" }}>
                              {handoff}
                            </span>
                          </div>
                          <span className="tag green" style={{ fontSize: 10, padding: "1px 6px" }}>
                            SWARM TRANSFER
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Function Tools */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-2)", textTransform: "uppercase", marginBottom: 6 }}>
                    Function Tools & Capabilities ({parsedAgent.tools.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {parsedAgent.tools.map((tool, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: "8px 12px",
                          background: "rgba(0,0,0,0.22)",
                          border: tool.isHandoff ? "1px solid rgba(16,185,129,0.35)" : "1px solid rgba(255,255,255,0.06)",
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 600, color: "#fff", fontFamily: "monospace" }}>
                            {tool.name}
                          </span>
                          {tool.isHandoff ? (
                            <span className="tag green" style={{ fontSize: 10, padding: "1px 6px" }}>
                              AGENT HANDOFF
                            </span>
                          ) : (
                            <span className="tag blue" style={{ fontSize: 10, padding: "1px 6px" }}>
                              FUNCTION TOOL
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--muted-2)", marginTop: 3 }}>
                          {tool.description || "OpenAI tool definition"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* System Prompt / Instructions */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-2)", textTransform: "uppercase", marginBottom: 4 }}>
                    Instructions / System Prompt
                  </div>
                  <div
                    style={{
                      maxHeight: 120,
                      overflowY: "auto",
                      padding: "8px 12px",
                      background: "rgba(0,0,0,0.35)",
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.06)",
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: "var(--muted-2)",
                      whiteSpace: "pre-wrap",
                      fontFamily: "monospace",
                    }}
                  >
                    {parsedAgent.instruction || "No instruction found"}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                Paste OpenAI code or select a preset on the left to decompile swarm routines & tools.
              </div>
            )}
          </div>

          {/* Card 2: Interactive Swarm Runner */}
          <div
            className="card"
            style={{
              padding: 18,
              background: "#0d1527",
              borderColor: "rgba(16,185,129,0.25)",
              borderRadius: "var(--radius)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="tag green" style={{ fontSize: 11, background: "rgba(16,185,129,0.2)", color: "#34d399", border: "1px solid rgba(16,185,129,0.3)" }}>SWARM ENGINE</span>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "#fff" }}>
                  Swarm Execution & Handoff Simulator
                </h3>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <select
                  value={engine}
                  onChange={(e: any) => setEngine(e.target.value)}
                  className="input"
                  style={{ padding: "2px 8px", fontSize: 11.5, height: 26 }}
                >
                  <option value="gemini">Gemini 2.5 Flash</option>
                  <option value="claude">Claude 3.5 Sonnet</option>
                  <option value="simulation">Mock Swarm Loop</option>
                </select>
              </div>
            </div>

            {/* Test Input */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>
                User Request to Swarm:
              </label>
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                rows={2}
                className="input"
                style={{
                  width: "100%",
                  fontSize: 12,
                  lineHeight: 1.4,
                  padding: "8px 10px",
                  background: "rgba(0,0,0,0.3)",
                }}
              />
            </div>

            {/* Run Button */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleRunTest}
                disabled={running || !parsedAgent}
                style={{ fontSize: 12, padding: "6px 14px", fontWeight: 600, background: "#059669", borderColor: "#10b981" }}
              >
                {running ? "Simulating Swarm..." : "Run Swarm Routine"}
              </button>
            </div>

            {runError && (
              <div
                style={{
                  padding: "8px 12px",
                  background: "rgba(239,68,68,0.15)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 6,
                  color: "#fca5a5",
                  fontSize: 12,
                  marginBottom: 12,
                }}
              >
                {runError}
              </div>
            )}

            {/* Execution Trace */}
            {runResult && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                    Swarm Event Trace ({runResult.steps?.length || 0} Events)
                  </span>
                  <span className="tag green" style={{ fontSize: 10 }}>
                    COMPLETED • {runResult.durationMs}ms
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
                  {(runResult.steps || []).map((tr: SandboxStepLog, i: number) => (
                    <div
                      key={i}
                      style={{
                        padding: "8px 10px",
                        background: "rgba(0,0,0,0.25)",
                        borderRadius: 6,
                        border: "1px solid rgba(255,255,255,0.05)",
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                        <span style={{ fontWeight: 600, color: tr.tool ? "#34d399" : "var(--sky-4)" }}>
                          Step {tr.step}: {tr.tool ? `Function (${tr.tool})` : "Reasoning"}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>
                          {tr.durationMs}ms
                        </span>
                      </div>
                      {tr.thought && (
                        <div style={{ color: "var(--muted-2)", lineHeight: 1.4, fontStyle: "italic", marginBottom: 4 }}>
                          💭 {tr.thought}
                        </div>
                      )}
                      {tr.output && (
                        <div
                          style={{
                            marginTop: 4,
                            padding: "4px 8px",
                            background: "rgba(0,0,0,0.3)",
                            borderRadius: 4,
                            fontFamily: "monospace",
                            fontSize: 11,
                            color: "#94a3b8",
                          }}
                        >
                          Payload: {typeof tr.output === "object" ? JSON.stringify(tr.output) : String(tr.output)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Final Swarm Output */}
                <div style={{ padding: "10px 12px", background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#34d399", textTransform: "uppercase", marginBottom: 4 }}>
                    Swarm Final Response
                  </div>
                  <div style={{ fontSize: 12.5, color: "#ecfdf5", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {runResult.output}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Promotion Modal */}
      {showPromoteModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: 520,
              padding: 24,
              background: "#0d1527",
              borderColor: "rgba(16,185,129,0.4)",
              borderRadius: "var(--radius)",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.5)",
            }}
          >
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px", color: "#fff" }}>
              Promote OpenAI Swarm Agent to Agent Studio
            </h3>
            <p style={{ fontSize: 13, color: "var(--muted-2)", margin: "0 0 16px" }}>
              Save this OpenAI Swarm or Assistant agent into your Agent Studio catalog. Function tools and handoff routines will be mapped directly to executable tools and specialist transitions.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>
                  Agent Name
                </label>
                <input
                  type="text"
                  value={promoteName}
                  onChange={(e) => setPromoteName(e.target.value)}
                  className="input"
                  style={{ width: "100%" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>
                  Purpose & Description
                </label>
                <textarea
                  value={promoteDescription}
                  onChange={(e) => setPromoteDescription(e.target.value)}
                  rows={3}
                  className="input"
                  style={{ width: "100%", fontSize: 12 }}
                />
              </div>
            </div>

            {promoteError && (
              <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.15)", color: "#fca5a5", fontSize: 12, borderRadius: 6, marginBottom: 16 }}>
                {promoteError}
              </div>
            )}

            {promoteSuccess && (
              <div style={{ padding: "8px 12px", background: "rgba(34,197,94,0.15)", color: "#86efac", fontSize: 12, borderRadius: 6, marginBottom: 16 }}>
                ✓ Agent promoted successfully! Redirecting to agent profile...
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
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
                style={{ background: "#059669", borderColor: "#10b981" }}
              >
                {promoting ? "Promoting..." : "Confirm & Promote"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
