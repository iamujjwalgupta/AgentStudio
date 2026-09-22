"use client";

import { useState, useEffect } from "react";
import type { ExportTarget, ExportRuntime, ExportBundle, ExportFile } from "@/lib/agent-exporter";

type Props = {
  agentId: string;
  agentName: string;
  isOpen: boolean;
  onClose: () => void;
};

const CLOUD_OPTIONS: { id: ExportTarget; label: string; tag: string; blurb: string }[] = [
  { id: "gcp", label: "Google Cloud (GCP)", tag: "Cloud Run / Functions", blurb: "Containerized Cloud Run microservice or event-driven Cloud Function" },
  { id: "aws", label: "Amazon Web Services (AWS)", tag: "Lambda / App Runner", blurb: "Serverless Lambda function with SAM or App Runner container" },
  { id: "azure", label: "Microsoft Azure", tag: "Container Apps / Functions", blurb: "Azure Container Apps with KEDA scaling or Azure Functions v4" },
  { id: "docker", label: "Docker / Standalone", tag: "Generic Container", blurb: "Portable multi-stage container runnable anywhere (K8s, VPS, local)" },
  { id: "python", label: "Python (FastAPI)", tag: "Anthropic Python SDK", blurb: "FastAPI microservice + official Anthropic SDK runner with requirements.txt and Dockerfile" },
];

export default function ExportAgentModal({ agentId, agentName, isOpen, onClose }: Props) {
  const [modalTab, setModalTab] = useState<"package" | "rest_api">("package");
  const [target, setTarget] = useState<ExportTarget>("gcp");
  const [runtime, setRuntime] = useState<ExportRuntime>("container");
  const [bundle, setBundle] = useState<ExportBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeFile, setActiveFile] = useState<ExportFile | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // REST API state
  const [apiSnippetLang, setApiSnippetLang] = useState<"curl" | "python" | "node">("curl");
  const [testInput, setTestInput] = useState("Hello! Analyze our spend data and check for anomalies.");
  const [testResponse, setTestResponse] = useState<any | null>(null);
  const [testStatus, setTestStatus] = useState<number | null>(null);
  const [testingApi, setTestingApi] = useState(false);
  const [origin, setOrigin] = useState("http://localhost:3000");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (modalTab === "package") {
      loadPreview();
    }
  }, [isOpen, target, runtime, modalTab]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  async function loadPreview() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/agents/${agentId}/export?target=${target}&runtime=${runtime}&format=json`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate export bundle preview.");
      }
      const data = await res.json();
      setBundle(data.bundle);
      if (data.bundle?.files?.length) {
        // Default to runner.mjs or first file
        const preferred = data.bundle.files.find((f: ExportFile) => f.path === "runner.mjs") || data.bundle.files[0];
        setActiveFile(preferred);
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  function downloadZip() {
    const url = `/api/agents/${agentId}/export?target=${target}&runtime=${runtime}&format=zip`;
    window.location.href = url;
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      /* ignore */
    }
  }

  async function runTestInvoke() {
    setTestingApi(true);
    setTestResponse(null);
    setTestStatus(null);
    const start = performance.now();
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: testInput }),
      });
      const data = await res.json();
      const elapsed = Math.round(performance.now() - start);
      setTestStatus(res.status);
      setTestResponse({ ...data, _durationMs: elapsed });
    } catch (err: any) {
      setTestStatus(500);
      setTestResponse({ error: err.message || String(err) });
    } finally {
      setTestingApi(false);
    }
  }

  const endpointUrl = `${origin}/api/v1/agents/${agentId}/invoke`;

  const curlSnippet = `curl -X POST "${endpointUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "input": "${testInput.replace(/"/g, '\\"')}",
    "version": "published"
  }'`;

  const pythonSnippet = `import requests

url = "${endpointUrl}"
headers = {"Content-Type": "application/json"}
payload = {
    "input": """${testInput}""",
    "version": "published"
}

response = requests.post(url, json=payload, headers=headers)
print("HTTP Status:", response.status_code)
data = response.json()
print("Run ID:", data.get("runId"))
print("Output:", data.get("output"))`;

  const nodeSnippet = `const response = await fetch("${endpointUrl}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    input: "${testInput.replace(/"/g, '\\"')}",
    version: "published",
  }),
});

const data = await response.json();
console.log("Run ID:", data.runId);
console.log("Output:", data.output);`;

  const activeSnippet =
    apiSnippetLang === "curl" ? curlSnippet : apiSnippetLang === "python" ? pythonSnippet : nodeSnippet;

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(10, 17, 30, 0.8)",
        backdropFilter: "blur(6px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="panel"
        style={{
          width: "100%",
          maxWidth: 1120,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0d1527",
          border: "1px solid #1e293b",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          overflow: "hidden",
          borderRadius: 12,
          padding: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid #1e293b",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(180deg, #111e38 0%, #0d1527 100%)",
          }}
        >
          <div>
            <div className="eyebrow" style={{ color: "#38bdf8", marginBottom: 2 }}>
              Enterprise Deployment & API Gateway
            </div>
            <h2 style={{ margin: 0, fontSize: 18, color: "#f8fafc", fontWeight: 600 }}>
              Deploy & Export &ldquo;{agentName}&rdquo;
            </h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {modalTab === "package" ? (
              <button className="btn btn-primary" onClick={downloadZip} disabled={loading || !bundle}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginRight: 6 }}>
                  <path d="M8 2v8M4.5 7l3.5 3.5L11.5 7M2.5 12.5h11" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Download Package (.zip)
              </button>
            ) : (
              <a
                href={`/api/v1/agents/${agentId}/invoke`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary"
                style={{ textDecoration: "none", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <span>📜</span> View OpenAPI 3.0 Spec
              </a>
            )}
            <button className="btn btn-ghost" onClick={onClose} style={{ color: "#94a3b8" }}>
              ✕
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: "flex", borderBottom: "1px solid #1e293b", backgroundColor: "#090f1d", padding: "0 24px" }}>
          <button
            onClick={() => setModalTab("package")}
            style={{
              padding: "12px 16px",
              background: "none",
              border: "none",
              borderBottom: modalTab === "package" ? "2px solid #38bdf8" : "2px solid transparent",
              color: modalTab === "package" ? "#38bdf8" : "#94a3b8",
              fontWeight: modalTab === "package" ? 600 : 500,
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              transition: "all 0.15s",
            }}
          >
            <span>📦</span> Cloud & Container Packages
          </button>
          <button
            onClick={() => setModalTab("rest_api")}
            style={{
              padding: "12px 16px",
              background: "none",
              border: "none",
              borderBottom: modalTab === "rest_api" ? "2px solid #38bdf8" : "2px solid transparent",
              color: modalTab === "rest_api" ? "#38bdf8" : "#94a3b8",
              fontWeight: modalTab === "rest_api" ? 600 : 500,
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              transition: "all 0.15s",
            }}
          >
            <span>⚡</span> Standalone REST API & cURL
            <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, backgroundColor: "rgba(56, 189, 248, 0.15)", color: "#38bdf8", fontWeight: 600 }}>
              POST /invoke
            </span>
          </button>
        </div>

        {modalTab === "package" ? (
          <>
            {/* Cloud & Architecture Selection */}
            <div style={{ padding: "16px 24px", borderBottom: "1px solid #1e293b", backgroundColor: "#0b1220" }}>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
                {/* Target Cloud */}
                <div style={{ flex: 1, minWidth: 320 }}>
                  <span className="eyebrow" style={{ display: "block", marginBottom: 6, fontSize: 11 }}>
                    Target Cloud / Language
                  </span>
                  <div className="seg" style={{ display: "flex", gap: 4 }}>
                    {CLOUD_OPTIONS.map((c) => (
                      <button
                        key={c.id}
                        className={`seg-opt ${target === c.id ? "on" : ""}`}
                        onClick={() => setTarget(c.id)}
                        style={{ flex: 1, fontSize: 12, padding: "7px 10px", textAlign: "center" }}
                      >
                        {c.label.split(" ")[0]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Runtime Architecture */}
                <div style={{ minWidth: 260 }}>
                  <span className="eyebrow" style={{ display: "block", marginBottom: 6, fontSize: 11 }}>
                    Runtime Architecture
                  </span>
                  <div className="seg" style={{ display: "flex", gap: 4 }}>
                    <button
                      className={`seg-opt ${runtime === "container" ? "on" : ""}`}
                      onClick={() => setRuntime("container")}
                      style={{ fontSize: 12, padding: "7px 12px" }}
                    >
                      Container Service (HTTP)
                    </button>
                    <button
                      className={`seg-opt ${runtime === "serverless" ? "on" : ""}`}
                      onClick={() => setRuntime("serverless")}
                      style={{ fontSize: 12, padding: "7px 12px" }}
                      disabled={target === "docker" || target === "python"}
                    >
                      Serverless Function
                    </button>
                  </div>
                </div>
              </div>

              <p className="sub-line" style={{ margin: "10px 0 0", color: "#64748b", fontSize: 12 }}>
                {CLOUD_OPTIONS.find((c) => c.id === target)?.blurb}
              </p>
            </div>

            {/* Content Body: Explorer + Preview */}
            <div style={{ display: "flex", flex: 1, minHeight: 420, maxHeight: "56vh", overflow: "hidden" }}>
              {/* File Explorer Sidebar */}
              <div
                style={{
                  width: 240,
                  borderRight: "1px solid #1e293b",
                  backgroundColor: "#090f1d",
                  display: "flex",
                  flexDirection: "column",
                  overflowY: "auto",
                }}
              >
                <div style={{ padding: "10px 14px", borderBottom: "1px solid #162032", fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
                  Package Files ({bundle?.files?.length || 0})
                </div>
                <div style={{ padding: 6, flex: 1 }}>
                  {loading ? (
                    <div style={{ padding: 14, color: "#64748b", fontSize: 12 }}>Compiling export...</div>
                  ) : (
                    bundle?.files?.map((f) => {
                      const isSelected = activeFile?.path === f.path;
                      return (
                        <button
                          key={f.path}
                          onClick={() => setActiveFile(f)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            borderRadius: 6,
                            border: "none",
                            backgroundColor: isSelected ? "#1e293b" : "transparent",
                            color: isSelected ? "#38bdf8" : "#94a3b8",
                            cursor: "pointer",
                            fontSize: 12,
                            fontFamily: "monospace",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 2,
                            transition: "background 0.15s",
                          }}
                        >
                          <span style={{ opacity: 0.6, fontSize: 11 }}>
                            {f.path.endsWith(".sh") ? "⚡" : f.path.endsWith(".json") ? "{}" : f.path.endsWith(".md") ? "📝" : f.path.endsWith(".py") ? "🐍" : "📄"}
                          </span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {f.path}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Code Viewer Panel */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#060a12", overflow: "hidden" }}>
                {activeFile ? (
                  <>
                    <div
                      style={{
                        padding: "8px 16px",
                        borderBottom: "1px solid #1e293b",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        backgroundColor: "#0a101d",
                      }}
                    >
                      <div>
                        <span style={{ fontFamily: "monospace", fontSize: 13, color: "#38bdf8", fontWeight: 500 }}>
                          {activeFile.path}
                        </span>
                        <span style={{ marginLeft: 12, color: "#64748b", fontSize: 11 }}>
                          {activeFile.description}
                        </span>
                      </div>
                      <button
                        className="btn btn-ghost"
                        onClick={() => copyText(activeFile.content, "file")}
                        style={{ fontSize: 11, padding: "3px 8px", color: copied === "file" ? "#34d399" : "#94a3b8" }}
                      >
                        {copied === "file" ? "✓ Copied" : "Copy File"}
                      </button>
                    </div>

                    <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
                      <pre
                        style={{
                          margin: 0,
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                          fontSize: 12,
                          lineHeight: 1.6,
                          color: "#e2e8f0",
                          whiteSpace: "pre",
                        }}
                      >
                        <code>{activeFile.content}</code>
                      </pre>
                    </div>
                  </>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#64748b" }}>
                    {loading ? "Generating bundle..." : "Select a file to inspect"}
                  </div>
                )}
              </div>
            </div>

            {/* Footer: Secrets & Deploy Command */}
            <div
              style={{
                padding: "14px 24px",
                borderTop: "1px solid #1e293b",
                backgroundColor: "#0b1220",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {error && <div className="error" style={{ fontSize: 12 }}>{error}</div>}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, overflowX: "auto" }}>
                  <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap", textTransform: "uppercase", fontWeight: 600 }}>
                    Required Cloud Secrets:
                  </span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "nowrap" }}>
                    {bundle?.requiredEnvVars?.map((v) => (
                      <span
                        key={v.key}
                        className="tag tag-neutral mono"
                        title={`${v.description} (e.g. ${v.hint})`}
                        style={{ fontSize: 11, padding: "2px 6px", border: "1px solid #28374d", color: "#cbd5e1" }}
                      >
                        {v.key}
                      </span>
                    ))}
                  </div>
                </div>

                {bundle?.deployCommand && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>Deploy Command:</span>
                    <code
                      style={{
                        backgroundColor: "#060a12",
                        border: "1px solid #1e293b",
                        padding: "3px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        color: "#38bdf8",
                        maxWidth: 320,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {bundle.deployCommand}
                    </code>
                    <button
                      className="btn btn-ghost"
                      onClick={() => copyText(bundle.deployCommand, "cmd")}
                      style={{ fontSize: 11, padding: "3px 8px", color: copied === "cmd" ? "#34d399" : "#94a3b8" }}
                    >
                      {copied === "cmd" ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          /* Live REST API & OpenAPI View */
          <div style={{ display: "flex", flex: 1, minHeight: 480, maxHeight: "68vh", overflow: "hidden" }}>
            {/* Left side: Endpoint & Snippets */}
            <div style={{ flex: 1.1, borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column", backgroundColor: "#0a101d" }}>
              {/* Endpoint Header Bar */}
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #1e293b", backgroundColor: "#0c1424" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span style={{ backgroundColor: "#10b981", color: "#062817", fontWeight: 700, fontSize: 11, padding: "2px 8px", borderRadius: 4 }}>
                    POST
                  </span>
                  <code style={{ fontSize: 13, color: "#f8fafc", fontFamily: "monospace", wordBreak: "break-all" }}>
                    {endpointUrl}
                  </code>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="tag tag-neutral" style={{ fontSize: 11, color: "#94a3b8" }}>🌐 CORS Enabled</span>
                  <span className="tag tag-neutral" style={{ fontSize: 11, color: "#38bdf8" }}>🛡️ DLP Masking Protected</span>
                  <span className="tag tag-neutral" style={{ fontSize: 11, color: "#a78bfa" }}>⏱️ Rate Limited</span>
                </div>
              </div>

              {/* Code Snippet Language Bar */}
              <div style={{ padding: "10px 20px", borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="seg" style={{ display: "flex", gap: 4 }}>
                  <button
                    className={`seg-opt ${apiSnippetLang === "curl" ? "on" : ""}`}
                    onClick={() => setApiSnippetLang("curl")}
                    style={{ fontSize: 11, padding: "4px 10px" }}
                  >
                    cURL
                  </button>
                  <button
                    className={`seg-opt ${apiSnippetLang === "python" ? "on" : ""}`}
                    onClick={() => setApiSnippetLang("python")}
                    style={{ fontSize: 11, padding: "4px 10px" }}
                  >
                    Python (requests)
                  </button>
                  <button
                    className={`seg-opt ${apiSnippetLang === "node" ? "on" : ""}`}
                    onClick={() => setApiSnippetLang("node")}
                    style={{ fontSize: 11, padding: "4px 10px" }}
                  >
                    Node.js (fetch)
                  </button>
                </div>
                <button
                  className="btn btn-ghost"
                  onClick={() => copyText(activeSnippet, "snippet")}
                  style={{ fontSize: 11, padding: "4px 10px", color: copied === "snippet" ? "#34d399" : "#94a3b8" }}
                >
                  {copied === "snippet" ? "✓ Copied" : "Copy Snippet"}
                </button>
              </div>

              {/* Code Snippet Box */}
              <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", backgroundColor: "#060a12" }}>
                <pre
                  style={{
                    margin: 0,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    fontSize: 12,
                    lineHeight: 1.6,
                    color: "#e2e8f0",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  <code>{activeSnippet}</code>
                </pre>
              </div>
            </div>

            {/* Right side: Interactive Invoke Tester */}
            <div style={{ flex: 0.9, display: "flex", flexDirection: "column", backgroundColor: "#090f1d" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #1e293b", backgroundColor: "#0c1424" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#f8fafc" }}>⚡ Interactive Endpoint Tester</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>Test direct invocation with active DLP protection and rate limiting</div>
              </div>

              <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12, borderBottom: "1px solid #1e293b" }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 6, fontWeight: 500 }}>
                    Payload Input (Prompt / Instructions)
                  </label>
                  <textarea
                    value={testInput}
                    onChange={(e) => setTestInput(e.target.value)}
                    rows={3}
                    style={{
                      width: "100%",
                      backgroundColor: "#060a12",
                      border: "1px solid #1e293b",
                      borderRadius: 6,
                      padding: "8px 10px",
                      color: "#f8fafc",
                      fontSize: 12,
                      fontFamily: "monospace",
                      resize: "vertical",
                    }}
                  />
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Version: published</span>
                  <button
                    className="btn btn-primary"
                    onClick={runTestInvoke}
                    disabled={testingApi || !testInput.trim()}
                    style={{ fontSize: 12, padding: "6px 14px", display: "flex", alignItems: "center", gap: 6 }}
                  >
                    {testingApi ? "Executing..." : "Send Request 🚀"}
                  </button>
                </div>
              </div>

              {/* Response Inspector */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ padding: "8px 20px", borderBottom: "1px solid #162032", display: "flex", alignItems: "center", justifyContent: "space-between", backgroundColor: "#070c18" }}>
                  <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>
                    Live Response Payload
                  </span>
                  {testStatus && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span
                        style={{
                          fontSize: 10,
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontWeight: 600,
                          backgroundColor: testStatus === 200 ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)",
                          color: testStatus === 200 ? "#34d399" : "#f87171",
                        }}
                      >
                        HTTP {testStatus}
                      </span>
                      {testResponse?._durationMs && (
                        <span style={{ fontSize: 10, color: "#64748b" }}>{testResponse._durationMs}ms</span>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ flex: 1, overflow: "auto", padding: "14px 20px", backgroundColor: "#060a12" }}>
                  {testingApi ? (
                    <div style={{ color: "#64748b", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
                      <span>⏳</span> Running agent orchestrator through REST API...
                    </div>
                  ) : testResponse ? (
                    <pre
                      style={{
                        margin: 0,
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        fontSize: 11,
                        lineHeight: 1.5,
                        color: "#a5f3fc",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}
                    >
                      <code>{JSON.stringify(testResponse, null, 2)}</code>
                    </pre>
                  ) : (
                    <div style={{ color: "#64748b", fontSize: 12, textAlign: "center", marginTop: 40 }}>
                      Click &ldquo;Send Request&rdquo; to test endpoint invocation live.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
