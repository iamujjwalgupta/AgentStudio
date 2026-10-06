"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { acceptedExtensions, fileAccepted, normaliseInputs, type AgentSpec, type SpecInput } from "@/lib/types";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  agentName: string;
  spec: AgentSpec;
  publishedVer: number | null;
  initialUseDraft?: boolean;
  initialDryRun?: boolean;
};

export default function RunAgentModal({
  isOpen,
  onClose,
  agentId,
  agentName,
  spec,
  publishedVer,
  initialUseDraft = true,
  initialDryRun = false,
}: Props) {
  const router = useRouter();
  const inputs = normaliseInputs(spec.inputs as any[]);

  const [useDraft, setUseDraft] = useState(initialUseDraft);
  const [dryRun, setDryRun] = useState(initialDryRun);
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"run" | "rehearse" | "">("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setUseDraft(initialUseDraft);
    setDryRun(initialDryRun);
    setError("");
    setProgress("");
    setBusy("");
  }, [isOpen, initialUseDraft, initialDryRun]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const setVal = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }));

  async function handleStart(isDryRun: boolean) {
    setError("");
    setBusy(isDryRun ? "rehearse" : "run");

    // Client-side required field validation
    const missing: string[] = [];
    for (const inp of inputs) {
      if (inp.required) {
        if (inp.type === "file" && !files[inp.key]) {
          missing.push(inp.label);
        } else if (inp.type !== "file" && (!values[inp.key] || !values[inp.key].trim())) {
          missing.push(inp.label);
        }
      }
    }

    if (missing.length > 0) {
      setBusy("");
      setError(`Please provide required inputs: ${missing.join(", ")}`);
      return;
    }

    try {
      // 1. Upload files first if any
      const resolved: Record<string, string> = { ...values };
      for (const inp of inputs.filter((i) => i.type === "file")) {
        const file = files[inp.key];
        if (!file) continue;
        setProgress(`Uploading ${file.name}…`);
        const fd = new FormData();
        fd.append("file", file);
        const upRes = await fetch("/api/documents", { method: "POST", body: fd });
        const upData = await upRes.json();
        if (!upRes.ok) throw new Error(upData.error || `Failed to upload ${file.name}`);
        resolved[inp.key] = upData.document.name;
      }

      // 2. Launch run
      setProgress(isDryRun ? "Simulating rehearsal…" : "Launching agent run…");
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          values: resolved,
          input: note,
          dryRun: isDryRun,
          useDraft,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The run could not be started.");

      onClose();
      router.push(`/runs/${data.runId}`);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setBusy("");
      setProgress("");
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(6, 20, 48, 0.68)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 620,
          maxHeight: "90vh",
          backgroundColor: "#ffffff",
          borderRadius: 14,
          border: "1px solid rgba(0, 51, 141, 0.2)",
          boxShadow: "0 24px 56px -12px rgba(0, 31, 92, 0.45), 0 4px 12px rgba(0, 31, 92, 0.12)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: "1px solid #f1f5f9",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            background: "#fcfdff",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 9,
                backgroundColor: "rgba(0, 94, 184, 0.1)",
                color: "var(--link)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 2,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <div>
              <div className="eyebrow" style={{ color: "var(--link)", marginBottom: 3 }}>
                Run Screen · Execution Setup
              </div>
              <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>
                Run &ldquo;{agentName}&rdquo;
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.4 }}>
                {spec.purpose || "Provide inputs required for this run, then launch."}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={!!busy}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: 6,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div
          style={{
            padding: "20px 24px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {/* Target Version Selector */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              background: "#f8fafc",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>Target Version:</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className={`chip ${useDraft ? "on" : ""}`}
                onClick={() => setUseDraft(true)}
                style={{ fontSize: 12, padding: "4px 12px" }}
              >
                Draft Spec
              </button>
              {publishedVer && (
                <button
                  type="button"
                  className={`chip ${!useDraft ? "on" : ""}`}
                  onClick={() => setUseDraft(false)}
                  style={{ fontSize: 12, padding: "4px 12px" }}
                >
                  Live (v{publishedVer})
                </button>
              )}
            </div>
          </div>

          {/* Feedback Messages */}
          {error && (
            <div className="error" style={{ margin: 0 }}>
              {error}
            </div>
          )}

          {progress && (
            <div className="ok-note" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <span className="spin" style={{ width: 14, height: 14 }} />
              <span>{progress}</span>
            </div>
          )}

          {/* Declared Inputs Section */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Required & Expected Inputs ({inputs.length})
              </label>
              <span className="dim" style={{ fontSize: 12 }}>
                {inputs.length === 0 ? "No declared inputs" : "Supplied to agent during run"}
              </span>
            </div>

            {inputs.length === 0 ? (
              <div
                style={{
                  padding: "14px 16px",
                  background: "#f8fafc",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  fontSize: 13,
                  color: "var(--muted)",
                  lineHeight: 1.45,
                }}
              >
                This agent does not declare specific input parameters. You can add extra context or instructions below, or run it directly.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {inputs.map((inp) => (
                  <div
                    key={inp.key}
                    style={{
                      padding: "12px 14px",
                      background: "#fafbfc",
                      border: "1px solid #e5e9f0",
                      borderRadius: 8,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
                        {inp.label}
                        {inp.required && (
                          <span style={{ color: "var(--red)", marginLeft: 4, fontWeight: 700 }} title="Required field">
                            *
                          </span>
                        )}
                      </span>
                      <span className="eyebrow mono" style={{ fontSize: 10 }}>
                        {inp.type}
                      </span>
                    </div>

                    {inp.type === "file" ? (
                      <div>
                        <input
                          type="file"
                          id={`file-${inp.key}`}
                          style={{ display: "none" }}
                          accept={acceptedExtensions(inp).join(",") || undefined}
                          onChange={(e) => {
                            const f = e.target.files?.[0] || null;
                            if (f && !fileAccepted(inp, f.name)) {
                              setError(`${inp.label} takes ${acceptedExtensions(inp).join(", ")} files; ${f.name} is not one of them.`);
                              e.target.value = "";
                              setFiles((prev) => ({ ...prev, [inp.key]: null }));
                              return;
                            }
                            setError("");
                            setFiles((prev) => ({ ...prev, [inp.key]: f }));
                          }}
                        />
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <label
                            htmlFor={`file-${inp.key}`}
                            className="btn"
                            style={{ cursor: "pointer", fontSize: 12.5, padding: "6px 12px" }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            {files[inp.key] ? "Change file…" : "Upload document…"}
                          </label>
                          {files[inp.key] ? (
                            <span style={{ fontSize: 12.5, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <strong className="mono">{files[inp.key]!.name}</strong>
                              <span className="dim">({Math.round(files[inp.key]!.size / 1024)} KB)</span>
                              <button
                                type="button"
                                onClick={() => setFiles((prev) => ({ ...prev, [inp.key]: null }))}
                                style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", padding: "0 4px", fontSize: 14 }}
                                title="Remove file"
                              >
                                ✕
                              </button>
                            </span>
                          ) : (
                            <span className="dim" style={{ fontSize: 12.5 }}>No file selected</span>
                          )}
                        </div>
                      </div>
                    ) : inp.type === "longtext" ? (
                      <textarea
                        className="textarea"
                        rows={3}
                        placeholder={inp.hint || `Enter ${inp.label.toLowerCase()}…`}
                        value={values[inp.key] || ""}
                        onChange={(e) => setVal(inp.key, e.target.value)}
                        style={{ fontSize: 13 }}
                      />
                    ) : inp.type === "choice" ? (
                      <select
                        className="input"
                        value={values[inp.key] || ""}
                        onChange={(e) => setVal(inp.key, e.target.value)}
                        style={{ fontSize: 13 }}
                      >
                        <option value="">Choose option…</option>
                        {(inp.options || []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={inp.type === "number" ? "number" : inp.type === "date" ? "date" : "text"}
                        className="input"
                        placeholder={inp.hint || `Enter ${inp.label.toLowerCase()}…`}
                        value={values[inp.key] || ""}
                        onChange={(e) => setVal(inp.key, e.target.value)}
                        style={{ fontSize: 13 }}
                      />
                    )}

                    {inp.hint && inp.type !== "text" && inp.type !== "longtext" && (
                      <span className="sub-line" style={{ fontSize: 11.5 }}>{inp.hint}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Extra Context field */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Additional Context / Instructions (Optional)
            </label>
            <textarea
              className="textarea"
              rows={2}
              placeholder="Any run-specific overrides, testing details, or extra guidance for this execution…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ fontSize: 13 }}
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid #f1f5f9",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#fafbfc",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span className="dim" style={{ fontSize: 12 }}>
            Actions marked as requiring approval will pause for human review.
          </span>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" className="btn" onClick={onClose} disabled={!!busy}>
              Cancel
            </button>

            <button
              type="button"
              className="btn"
              onClick={() => handleStart(true)}
              disabled={!!busy || !spec.steps?.length}
              title="Runs safely in rehearsal mode without carrying out consequential actions"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {busy === "rehearse" && <span className="spin" />}
              Rehearse Safe
            </button>

            <button
              type="button"
              className="btn primary"
              onClick={() => handleStart(false)}
              disabled={!!busy || !spec.steps?.length}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {busy === "run" ? (
                <>
                  <span className="spin" />
                  Running…
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Run for Real
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
