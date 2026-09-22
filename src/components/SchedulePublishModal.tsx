"use client";

import { useState, useEffect } from "react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  agentName: string;
  nextVer: number;
  publishedVer: number | null;
  onConfirmSchedule: (datetime: string, note: string) => Promise<void>;
};

export default function SchedulePublishModal({
  isOpen,
  onClose,
  agentName,
  nextVer,
  publishedVer,
  onConfirmSchedule,
}: Props) {
  const [scheduledTime, setScheduledTime] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [minDatetime, setMinDatetime] = useState("");

  useEffect(() => {
    if (!isOpen) return;

    // Set default to tomorrow at 09:00 AM
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    const pad = (n: number) => n.toString().padStart(2, "0");
    const toDatetimeLocal = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    setScheduledTime(toDatetimeLocal(tomorrow));

    // Min datetime is now + 5 mins
    const minD = new Date(Date.now() + 5 * 60 * 1000);
    setMinDatetime(toDatetimeLocal(minD));
    setNote("");
    setLoading(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const setPreset = (offsetHours: number, targetHour?: number) => {
    const d = new Date();
    if (targetHour !== undefined) {
      d.setDate(d.getDate() + offsetHours);
      d.setHours(targetHour, 0, 0, 0);
    } else {
      d.setHours(d.getHours() + offsetHours);
    }
    const pad = (n: number) => n.toString().padStart(2, "0");
    setScheduledTime(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  };

  const handleConfirm = async () => {
    if (!scheduledTime) return;
    setLoading(true);
    try {
      await onConfirmSchedule(scheduledTime, note);
      onClose();
    } catch {
      // handled by caller
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(6, 20, 48, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          backgroundColor: "#ffffff",
          borderRadius: 14,
          border: "1px solid rgba(0, 51, 141, 0.2)",
          boxShadow: "0 24px 56px -12px rgba(0, 31, 92, 0.4), 0 4px 12px rgba(0, 31, 92, 0.12)",
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
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                backgroundColor: "rgba(0, 94, 184, 0.08)",
                color: "var(--link)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 2,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2v4" />
                <path d="M16 2v4" />
                <rect width="18" height="18" x="3" y="4" rx="2" />
                <path d="M3 10h18" />
                <circle cx="16" cy="16" r="3" />
                <path d="M16 15v1.5l1 1" />
              </svg>
            </div>
            <div>
              <h3 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 600, color: "var(--ink)" }}>
                Schedule Publish
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.4 }}>
                Automate version release for <strong>{agentName}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: 4,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Target Version Banner */}
          <div
            style={{
              padding: "12px 14px",
              background: "#f8fafc",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <span style={{ color: "var(--muted)" }}>Target Version: </span>
              <strong style={{ color: "var(--ink)", fontWeight: 600 }}>v{nextVer}</strong>
            </div>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              {publishedVer ? `Replaces live v${publishedVer}` : "Initial live release"}
            </div>
          </div>

          {/* Quick Presets */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Quick Presets
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="chip"
                onClick={() => setPreset(1)}
                style={{ fontSize: 12, padding: "5px 10px" }}
              >
                In 1 hour
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => setPreset(1, 9)}
                style={{ fontSize: 12, padding: "5px 10px" }}
              >
                Tomorrow at 09:00 AM
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  const now = new Date();
                  const daysUntilMon = ((1 + 7 - now.getDay()) % 7) || 7;
                  setPreset(daysUntilMon, 9);
                }}
                style={{ fontSize: 12, padding: "5px 10px" }}
              >
                Next Monday 09:00 AM
              </button>
            </div>
          </div>

          {/* Date Picker */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Go-live Date & Time
            </label>
            <input
              type="datetime-local"
              className="input"
              style={{ width: "100%", fontSize: 13, padding: "8px 12px" }}
              value={scheduledTime}
              min={minDatetime}
              onChange={(e) => setScheduledTime(e.target.value)}
            />
          </div>

          {/* Release Note */}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Release Note (optional)
            </label>
            <input
              type="text"
              className="input"
              style={{ width: "100%", fontSize: 13, padding: "8px 12px" }}
              placeholder="e.g. Scheduled Q3 compliance review release"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 24px 18px",
            borderTop: "1px solid #f1f5f9",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
            background: "#fafbfc",
          }}
        >
          <button type="button" className="btn" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={handleConfirm}
            disabled={loading || !scheduledTime}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {loading && <span className="spin" />}
            Confirm Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
