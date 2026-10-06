"use client";

import { useState } from "react";
import type { AgentSpec } from "@/lib/types";
import { maskPII } from "@/lib/guardrails";

interface GuardrailsConfigCardProps {
  spec: AgentSpec;
  onChange: (patch: Partial<AgentSpec["guardrails"]>) => void;
}

export default function GuardrailsConfigCard({ spec, onChange }: GuardrailsConfigCardProps) {
  const guardrails = spec.guardrails || {
    maxSteps: 12,
    requireCitations: true,
    escalateOnAmbiguity: true,
    stayInScope: true,
    extra: "",
    dlpEnabled: false,
    redactCreditCards: true,
    redactEmails: true,
    redactCredentials: true,
    redactPhoneNumbers: true,
    rateLimitRpm: 60,
  };

  // Live DLP Sandbox Test input
  const [testText, setTestText] = useState(
    "Customer Alice (email: alice@acme-corp.com, phone: 555-019-2834) authorized payment with Visa 4532-1188-9922-3411 using Bearer token sk-ant-api03-994827118237482910."
  );

  const testDlpResult = maskPII(testText, {
    enabled: guardrails.dlpEnabled ?? false,
    redactCreditCards: guardrails.redactCreditCards ?? true,
    redactEmails: guardrails.redactEmails ?? true,
    redactCredentials: guardrails.redactCredentials ?? true,
    redactPhoneNumbers: guardrails.redactPhoneNumbers ?? true,
    customPatterns: guardrails.customDlpPatterns,
  });

  return (
    <div className="guardrails-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>
              Mask personal and sensitive data
            </h3>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: "12.5px", color: "#64748b", lineHeight: 1.5 }}>
            Automatically redact payment information, emails, credentials, and API tokens from prompts and tool calls before they reach the model.
          </p>
        </div>

        {/* Master DLP Switch */}
        <label className="dlp-toggle-switch">
          <input
            type="checkbox"
            checked={guardrails.dlpEnabled || false}
            onChange={(e) => onChange({ dlpEnabled: e.target.checked })}
          />
          <span className="dlp-toggle-slider" />
          <span style={{ fontSize: "12px", fontWeight: 600, color: guardrails.dlpEnabled ? "#15803d" : "#64748b" }}>
            {guardrails.dlpEnabled ? "DLP ACTIVE" : "DLP DISABLED"}
          </span>
        </label>
      </div>

      {/* DLP Toggles Matrix */}
      <div className="dlp-options-grid">
        <label className="dlp-checkbox-label">
          <input
            type="checkbox"
            checked={guardrails.redactCreditCards ?? true}
            disabled={!guardrails.dlpEnabled}
            onChange={(e) => onChange({ redactCreditCards: e.target.checked })}
          />
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
              Credit Card Masking
            </div>
            <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
              Redact Visa, Mastercard, Amex, and Discover numbers to <code style={{ color: "#005eb8" }}>[REDACTED_CC:•••• 1234]</code>
            </div>
          </div>
        </label>

        <label className="dlp-checkbox-label">
          <input
            type="checkbox"
            checked={guardrails.redactEmails ?? true}
            disabled={!guardrails.dlpEnabled}
            onChange={(e) => onChange({ redactEmails: e.target.checked })}
          />
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
              Email Redaction
            </div>
            <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
              Redact customer email usernames while retaining domain: <code style={{ color: "#005eb8" }}>[REDACTED_EMAIL:••••@acme.com]</code>
            </div>
          </div>
        </label>

        <label className="dlp-checkbox-label">
          <input
            type="checkbox"
            checked={guardrails.redactCredentials ?? true}
            disabled={!guardrails.dlpEnabled}
            onChange={(e) => onChange({ redactCredentials: e.target.checked })}
          />
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
              API Keys & Credential Shield
            </div>
            <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
              Redact Bearer tokens, Anthropic/OpenAI keys, GitHub tokens, and private key blocks.
            </div>
          </div>
        </label>

        <label className="dlp-checkbox-label">
          <input
            type="checkbox"
            checked={guardrails.redactPhoneNumbers ?? true}
            disabled={!guardrails.dlpEnabled}
            onChange={(e) => onChange({ redactPhoneNumbers: e.target.checked })}
          />
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
              Phone & SSN Redaction
            </div>
            <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
              Redact 10-digit phone numbers and Social Security Numbers.
            </div>
          </div>
        </label>
      </div>

      {/* Per-Agent Rate Limiting Controls */}
      <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: "13.5px", fontWeight: 600, color: "#0f172a", marginBottom: "10px" }}>
          Per-Agent Rate Limits & Quotas
        </div>
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "180px" }}>
            <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px" }}>
              MAX REQUESTS PER MINUTE (RPM)
            </label>
            <input
              type="number"
              min={1}
              max={1000}
              value={guardrails.rateLimitRpm ?? 60}
              onChange={(e) => onChange({ rateLimitRpm: Number(e.target.value) })}
              className="input"
              style={{ width: "100%", fontSize: "13px", background: "#ffffff", color: "#0f172a", border: "1px solid #cbd5e1" }}
            />
            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
              Enforces 429 Too Many Requests response if exceeded.
            </div>
          </div>

          <div style={{ flex: 1, minWidth: "180px" }}>
            <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px" }}>
              MAX TOKENS PER MINUTE (TPM)
            </label>
            <input
              type="number"
              min={1000}
              step={5000}
              placeholder="e.g. 100000 (optional)"
              value={guardrails.rateLimitTpm || ""}
              onChange={(e) => onChange({ rateLimitTpm: e.target.value ? Number(e.target.value) : undefined })}
              className="input"
              style={{ width: "100%", fontSize: "13px", background: "#ffffff", color: "#0f172a", border: "1px solid #cbd5e1" }}
            />
            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
              Leave blank for unlimited token throughput.
            </div>
          </div>
        </div>
      </div>

      {/* Live Interactive DLP Sandbox Tester */}
      <div className="dlp-tester-box">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "6px" }}>
          <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#005eb8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Try it on sample text
          </span>
          <span style={{ fontSize: "11px", color: "#475569", fontWeight: 500 }}>
            {testDlpResult.hasRedactions ? `Redacted ${testDlpResult.detections.length} pattern(s)` : "No active redactions"}
          </span>
        </div>

        <textarea
          rows={2}
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          className="input"
          style={{ width: "100%", fontSize: "12px", fontFamily: "var(--mono)", marginBottom: "8px", boxSizing: "border-box", background: "#ffffff", color: "#0f172a", border: "1px solid #cbd5e1" }}
          placeholder="Type or paste sample text containing cards, emails or tokens..."
        />

        <div style={{ fontSize: "10.5px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px" }}>
          What the model sees
        </div>
        <div className="dlp-preview-output">
          {testDlpResult.text}
        </div>
      </div>
    </div>
  );
}
