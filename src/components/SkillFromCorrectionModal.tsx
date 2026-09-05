"use client";

import { useEffect, useState } from "react";

export type CorrectionModalContext = {
  approvalId?: string;
  agentId?: string;
  agentName?: string;
  agentPurpose?: string;
  tool?: string;
  payload?: any;
  comment: string;
  runInput?: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (skill: any, attached: boolean) => void;
  context: CorrectionModalContext | null;
};

export default function SkillFromCorrectionModal({ isOpen, onClose, onSaved, context }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [attachImmediately, setAttachImmediately] = useState(true);
  const [previewTab, setPreviewTab] = useState<"edit" | "preview">("edit");

  useEffect(() => {
    if (!isOpen || !context) return;
    setError(null);
    setLabel("");
    setDescription("");
    setInstructions("");
    setTargetAgentId(context.agentId || null);

    async function synthesize() {
      if (!context) return;
      setLoading(true);
      try {
        const res = await fetch("/api/skills/synthesize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(context),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "Could not synthesize skill from correction.");
        setLabel(j.draft.label || "");
        setDescription(j.draft.description || "");
        setInstructions(j.draft.instructions || "");
        if (j.agentId) setTargetAgentId(j.agentId);
      } catch (err: any) {
        setError(err?.message || "Synthesis failed.");
      } finally {
        setLoading(false);
      }
    }

    synthesize();
  }, [isOpen, context]);

  if (!isOpen) return null;

  async function handleSave() {
    if (!label.trim()) return setError("Please provide a name for the skill.");
    if (!instructions.trim()) return setError("Instructions cannot be blank.");

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/skills/save-and-attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          description: description.trim(),
          instructions: instructions.trim(),
          agentId: targetAgentId,
          attachImmediately,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed to save and attach skill.");

      if (onSaved) {
        onSaved(j.skill, j.attached);
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to save skill.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.65)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        className="panel"
        style={{
          width: "100%",
          maxWidth: "760px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          backgroundColor: "var(--paper, #fff)",
          boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ paddingBottom: 12, borderBottom: "1px solid var(--line, #e2e8f0)" }}>
          <div className="spread">
            <div>
              <div className="eyebrow" style={{ color: "var(--kpmg-magenta, #c6007e)" }}>
                Feedback-to-Skill Compiler
              </div>
              <h2 style={{ margin: "4px 0 0", fontSize: 18 }}>Turn Correction into Reusable Skill</h2>
            </div>
            <button className="btn sm" onClick={onClose} disabled={saving}>
              ✕ Close
            </button>
          </div>
          {context?.comment && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                background: "rgba(198, 0, 126, 0.06)",
                borderLeft: "3px solid var(--kpmg-magenta, #c6007e)",
                fontSize: 13,
              }}
            >
              <span className="mono" style={{ fontWeight: 600, color: "var(--kpmg-magenta, #c6007e)" }}>
                Reviewer Note:{" "}
              </span>
              <span>&ldquo;{context.comment}&rdquo;</span>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 0" }}>
          {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

          {loading ? (
            <div style={{ padding: "40px 20px", textAlign: "center" }}>
              <div className="spin" style={{ margin: "0 auto 12px" }} />
              <div className="mono" style={{ fontSize: 14, color: "var(--ink-sub)" }}>
                Synthesizing Standard Operating Procedure from feedback…
              </div>
              <p className="sub-line" style={{ marginTop: 6 }}>
                Extracting core constraint, operational steps, and edge cases
              </p>
            </div>
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              <div>
                <label className="label" style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
                  Skill Name
                </label>
                <input
                  className="input"
                  placeholder="e.g., Tier-1 Account Escalation Protocol"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={80}
                />
              </div>

              <div>
                <label className="label" style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
                  Trigger Description (When an agent should reach for this skill)
                </label>
                <input
                  className="input"
                  placeholder="One sentence trigger description for progressive disclosure"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={400}
                />
                <span className="sub-line" style={{ fontSize: 11, marginTop: 3, display: "block" }}>
                  This line sits in the agent&apos;s system prompt. The agent decides whether to call <code>load_skill</code> based on this sentence alone.
                </span>
              </div>

              <div>
                <div className="spread" style={{ marginBottom: 6 }}>
                  <label className="label" style={{ fontSize: 13, fontWeight: 600 }}>
                    Standard Operating Procedure (Instructions)
                  </label>
                  <div className="row" style={{ gap: 4 }}>
                    <button
                      type="button"
                      className={`btn sm ${previewTab === "edit" ? "btn-warn" : ""}`}
                      style={{ padding: "2px 8px", fontSize: 11 }}
                      onClick={() => setPreviewTab("edit")}
                    >
                      Edit Markdown
                    </button>
                    <button
                      type="button"
                      className={`btn sm ${previewTab === "preview" ? "btn-warn" : ""}`}
                      style={{ padding: "2px 8px", fontSize: 11 }}
                      onClick={() => setPreviewTab("preview")}
                    >
                      Preview
                    </button>
                  </div>
                </div>

                {previewTab === "edit" ? (
                  <textarea
                    className="input"
                    rows={12}
                    style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, lineHeight: 1.5 }}
                    placeholder="Markdown instructions, rules, and procedures..."
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                  />
                ) : (
                  <div
                    style={{
                      border: "1px solid var(--line, #e2e8f0)",
                      borderRadius: 4,
                      padding: 12,
                      minHeight: 240,
                      maxHeight: 320,
                      overflowY: "auto",
                      backgroundColor: "rgba(0,0,0,0.02)",
                      fontSize: 13,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {instructions}
                  </div>
                )}
              </div>

              {targetAgentId && (
                <div
                  style={{
                    padding: "10px 14px",
                    background: "var(--surface, rgba(0,0,0,0.03))",
                    borderRadius: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <input
                    type="checkbox"
                    id="attachImmediately"
                    checked={attachImmediately}
                    onChange={(e) => setAttachImmediately(e.target.checked)}
                    style={{ width: 16, height: 16, cursor: "pointer" }}
                  />
                  <label htmlFor="attachImmediately" style={{ fontSize: 13, cursor: "pointer", userSelect: "none" }}>
                    Attach this skill to <strong>{context?.agentName || "agent"}</strong> immediately (loaded via <code>load_skill</code> on next run)
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        <div
          className="panel-foot"
          style={{
            paddingTop: 12,
            borderTop: "1px solid var(--line, #e2e8f0)",
            justifyContent: "space-between",
          }}
        >
          <div className="sub-line" style={{ fontSize: 12 }}>
            Saves to workspace library. Any agent can reuse this skill.
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              className="btn btn-warn"
              onClick={handleSave}
              disabled={loading || saving || !label.trim() || !instructions.trim()}
            >
              {saving ? "Saving…" : attachImmediately && targetAgentId ? "Save & Attach to Agent" : "Save to Library"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
