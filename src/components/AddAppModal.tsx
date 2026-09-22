"use client";

import { useState, useEffect } from "react";
import type { EmbeddedApp } from "@/lib/apps";

interface AddAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (app: EmbeddedApp) => void;
  editingApp?: EmbeddedApp | null;
}

const CATEGORIES = [
  { id: "agent-ui", label: "Agent UI & Playground" },
  { id: "dashboard", label: "Dashboard & Observability" },
  { id: "dev-tools", label: "Developer Tools & APIs" },
  { id: "analytics", label: "Data & Analytics" },
  { id: "docs", label: "Docs & Knowledge" },
  { id: "custom", label: "Custom Application" },
];

const ICONS = [
  { id: "globe", label: "Globe", symbol: "🌐" },
  { id: "bot", label: "Agent / Bot", symbol: "🤖" },
  { id: "sparkles", label: "AI / Sparkles", symbol: "✨" },
  { id: "chart", label: "Metrics / Chart", symbol: "📊" },
  { id: "terminal", label: "Terminal / API", symbol: "⚡" },
  { id: "database", label: "Data Store", symbol: "🗄️" },
  { id: "layout", label: "Portal / UI", symbol: "🖥️" },
  { id: "shield", label: "Security", symbol: "🛡️" },
];

export default function AddAppModal({
  isOpen,
  onClose,
  onCreated,
  editingApp,
}: AddAppModalProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("agent-ui");
  const [icon, setIcon] = useState("globe");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [permissions, setPermissions] = useState("proxy");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (editingApp) {
      setName(editingApp.name);
      setUrl(editingApp.url);
      setDescription(editingApp.description || "");
      setCategory(editingApp.category || "custom");
      setIcon(editingApp.icon || "globe");
      setPermissions(
        editingApp.permissions !== undefined && editingApp.permissions !== ""
          ? editingApp.permissions
          : "proxy"
      );
    } else {
      setName("");
      setUrl("");
      setDescription("");
      setCategory("agent-ui");
      setIcon("globe");
      setPermissions("proxy");
    }
    setError("");
  }, [editingApp, isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please give the application a name.");
      return;
    }
    if (!url.trim()) {
      setError("Please specify a URL to embed.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      if (editingApp) {
        const res = await fetch(`/api/apps/${editingApp.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            url,
            description,
            category,
            icon,
            permissions,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update application");
        onCreated(data.app);
      } else {
        const res = await fetch("/api/apps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            url,
            description,
            category,
            icon,
            permissions,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create application");
        onCreated(data.app);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(3, 10, 24, 0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "20px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#091a38",
          border: "1px solid rgba(148, 188, 227, 0.25)",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "540px",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.5)",
          overflow: "hidden",
          animation: "modalFadeIn 0.15s ease-out",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid rgba(148, 188, 227, 0.15)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#071329",
          }}
        >
          <div>
            <div style={{ fontSize: "17px", fontWeight: 700, color: "#fff" }}>
              {editingApp ? "Edit Web Application" : "Embed Web Application"}
            </div>
            <div style={{ fontSize: "12px", color: "var(--sky-2)", marginTop: "2px" }}>
              Display external tools, agent dashboards, or custom web apps inside Agent Studio canvas.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--sky-3)",
              cursor: "pointer",
              fontSize: "18px",
              padding: "4px 8px",
              borderRadius: "4px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} style={{ padding: "22px 24px" }}>
          {error && (
            <div
              style={{
                marginBottom: "16px",
                padding: "10px 14px",
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "6px",
                color: "#fca5a5",
                fontSize: "12.5px",
              }}
            >
              {error}
            </div>
          )}

          {/* App Name */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#fff", marginBottom: "6px" }}>
              Application Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. LangGraph Inspector, Customer Portal, Retool Hub"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "9px 12px",
                fontSize: "13.5px",
                background: "rgba(4, 14, 34, 0.7)",
                border: "1px solid rgba(148, 188, 227, 0.25)",
                borderRadius: "6px",
                color: "#fff",
                outline: "none",
              }}
            />
          </div>

          {/* Web App URL */}
          <div style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#fff" }}>
                Web Application URL *
              </label>
              {url && (
                <a
                  href={url.startsWith("http") ? url : `https://${url}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: "11px", color: "#38bdf8", textDecoration: "none" }}
                >
                  Test in New Tab ↗
                </a>
              )}
            </div>
            <input
              type="text"
              required
              placeholder="https://... or http://localhost:8080"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "9px 12px",
                fontSize: "13px",
                fontFamily: "var(--mono)",
                background: "rgba(4, 14, 34, 0.7)",
                border: "1px solid rgba(148, 188, 227, 0.25)",
                borderRadius: "6px",
                color: "#fff",
                outline: "none",
              }}
            />
          </div>

          {/* Category & Icon Row */}
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "14px", marginBottom: "16px" }}>
            <div>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#fff", marginBottom: "6px" }}>
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "9px 12px",
                  fontSize: "13px",
                  background: "rgba(4, 14, 34, 0.7)",
                  border: "1px solid rgba(148, 188, 227, 0.25)",
                  borderRadius: "6px",
                  color: "#fff",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id} style={{ background: "#091a38", color: "#fff" }}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#fff", marginBottom: "6px" }}>
                Tile Icon
              </label>
              <select
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "9px 12px",
                  fontSize: "13px",
                  background: "rgba(4, 14, 34, 0.7)",
                  border: "1px solid rgba(148, 188, 227, 0.25)",
                  borderRadius: "6px",
                  color: "#fff",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                {ICONS.map((ic) => (
                  <option key={ic.id} value={ic.id} style={{ background: "#091a38", color: "#fff" }}>
                    {ic.symbol} {ic.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#fff", marginBottom: "6px" }}>
              Description
            </label>
            <textarea
              rows={2}
              placeholder="What does this application do? (e.g. Visual state graph inspector for enterprise workflows)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 12px",
                fontSize: "13px",
                background: "rgba(4, 14, 34, 0.7)",
                border: "1px solid rgba(148, 188, 227, 0.25)",
                borderRadius: "6px",
                color: "#fff",
                outline: "none",
                resize: "vertical",
              }}
            />
          </div>

          {/* Embedding & Auth Mode */}
          <div style={{ marginBottom: "18px" }}>
            <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#fff", marginBottom: "6px" }}>
              Embedding &amp; Authentication Mode
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
              {/* Proxy Mode */}
              <button
                type="button"
                onClick={() => setPermissions("proxy")}
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: permissions === "proxy" ? "1px solid #38bdf8" : "1px solid rgba(148, 188, 227, 0.2)",
                  background: permissions === "proxy" ? "rgba(56, 189, 248, 0.12)" : "rgba(4, 14, 34, 0.6)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 700, color: permissions === "proxy" ? "#38bdf8" : "#fff" }}>
                  <span>🌐 Proxy Mode</span>
                  {permissions === "proxy" && <span style={{ fontSize: "10px", color: "#38bdf8" }}>✓ Active</span>}
                </div>
                <div style={{ fontSize: "11px", color: "var(--sky-3)", marginTop: "4px", lineHeight: "1.4" }}>
                  Recommended for apps with login screens &amp; cookies. Bypasses cross-origin restrictions.
                </div>
              </button>

              {/* Direct Mode */}
              <button
                type="button"
                onClick={() => setPermissions("unrestricted")}
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: permissions === "unrestricted" ? "1px solid #22c55e" : "1px solid rgba(148, 188, 227, 0.2)",
                  background: permissions === "unrestricted" ? "rgba(34, 197, 94, 0.12)" : "rgba(4, 14, 34, 0.6)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 700, color: permissions === "unrestricted" ? "#4ade80" : "#fff" }}>
                  <span>🔓 Direct Mode</span>
                  {permissions === "unrestricted" && <span style={{ fontSize: "10px", color: "#4ade80" }}>✓ Active</span>}
                </div>
                <div style={{ fontSize: "11px", color: "var(--sky-3)", marginTop: "4px", lineHeight: "1.4" }}>
                  Direct URL loading with unrestricted permissions.
                </div>
              </button>

              {/* Sandboxed Mode */}
              <button
                type="button"
                onClick={() =>
                  setPermissions(
                    "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
                  )
                }
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border:
                    permissions !== "proxy" && permissions !== "unrestricted"
                      ? "1px solid #fbbf24"
                      : "1px solid rgba(148, 188, 227, 0.2)",
                  background:
                    permissions !== "proxy" && permissions !== "unrestricted"
                      ? "rgba(245, 158, 11, 0.12)"
                      : "rgba(4, 14, 34, 0.6)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 700, color: permissions !== "proxy" && permissions !== "unrestricted" ? "#fbbf24" : "#fff" }}>
                  <span>🔒 Sandboxed</span>
                  {permissions !== "proxy" && permissions !== "unrestricted" && <span style={{ fontSize: "10px", color: "#fbbf24" }}>✓ Active</span>}
                </div>
                <div style={{ fontSize: "11px", color: "var(--sky-3)", marginTop: "4px", lineHeight: "1.4" }}>
                  Strict isolated execution with explicit permission flags.
                </div>
              </button>
            </div>

            {/* Optional custom flags toggle */}
            <div style={{ marginTop: "8px" }}>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--sky)",
                  fontSize: "11.5px",
                  cursor: "pointer",
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span>{showAdvanced ? "▾ Hide Custom Sandbox Flags" : "▸ Custom Sandbox String"}</span>
              </button>
              {showAdvanced && (
                <div style={{ marginTop: "6px" }}>
                  <input
                    type="text"
                    value={permissions}
                    onChange={(e) => setPermissions(e.target.value)}
                    placeholder="e.g. unrestricted or allow-scripts allow-same-origin ..."
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "6px 10px",
                      fontSize: "11px",
                      fontFamily: "var(--mono)",
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid rgba(148,188,227,0.2)",
                      borderRadius: "4px",
                      color: "var(--sky-3)",
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Modal Actions */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "24px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 16px",
                fontSize: "13px",
                borderRadius: "6px",
                border: "1px solid rgba(148, 188, 227, 0.2)",
                background: "transparent",
                color: "var(--sky-2)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "8px 20px",
                fontSize: "13px",
                fontWeight: 600,
                borderRadius: "6px",
                border: "none",
                background: "var(--sky)",
                color: "#fff",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading
                ? "Saving..."
                : editingApp
                ? "Save Changes"
                : "Embed Application"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
