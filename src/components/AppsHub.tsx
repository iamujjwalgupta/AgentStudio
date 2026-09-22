"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EmbeddedApp } from "@/lib/apps";
import AddAppModal from "./AddAppModal";

interface AppsHubProps {
  initialApps: EmbeddedApp[];
}

const CATEGORY_FILTERS = [
  { id: "all", label: "All Applications" },
  { id: "agent-ui", label: "Agent UIs & Playgrounds" },
  { id: "dashboard", label: "Observability & Dashboards" },
  { id: "dev-tools", label: "Developer Tools & APIs" },
  { id: "analytics", label: "Analytics & BI" },
  { id: "custom", label: "Custom" },
];

const DEFAULT_BUILTIN_IDS = [
  "builtin-langgraph-studio",
  "builtin-gradio-playground",
  "builtin-grafana-metrics",
  "builtin-swagger-console",
  "builtin-streamlit-hub",
];

function getIconSymbol(icon: string) {
  switch (icon) {
    case "bot":
      return "🤖";
    case "sparkles":
      return "✨";
    case "chart":
      return "📊";
    case "terminal":
      return "⚡";
    case "database":
      return "🗄️";
    case "layout":
      return "🖥️";
    case "shield":
      return "🛡️";
    case "globe":
    default:
      return "🌐";
  }
}

export default function AppsHub({ initialApps }: AppsHubProps) {
  const router = useRouter();
  const [apps, setApps] = useState<EmbeddedApp[]>(initialApps);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<EmbeddedApp | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Drag and drop & position reordering states
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [isRestoringDefaults, setIsRestoringDefaults] = useState(false);

  // Sync initialApps when server-side props change
  useEffect(() => {
    setApps(initialApps);
  }, [initialApps]);

  // Check if any default apps have been hidden/deleted
  const hasHiddenDefaults = useMemo(() => {
    const currentIds = new Set(apps.map((a) => a.id));
    return DEFAULT_BUILTIN_IDS.some((id) => !currentIds.has(id));
  }, [apps]);

  const filteredApps = useMemo(() => {
    return apps.filter((app) => {
      const matchesCategory =
        selectedCategory === "all" || app.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        app.name.toLowerCase().includes(q) ||
        app.description.toLowerCase().includes(q) ||
        app.url.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [apps, selectedCategory, searchQuery]);

  // Persist updated app order to backend & local storage
  const persistOrder = async (newApps: EmbeddedApp[]) => {
    const appIds = newApps.map((a) => a.id);
    try {
      localStorage.setItem("agent-studio.apps.order", JSON.stringify(appIds));
    } catch {}

    setIsSavingOrder(true);
    try {
      await fetch("/api/apps/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appIds }),
      });
    } catch (err) {
      console.warn("Failed to persist app positions to server:", err);
    } finally {
      setIsSavingOrder(false);
    }
  };

  // Move application position by offset (-1 for left/earlier, +1 for right/later)
  const handleMove = (appId: string, direction: -1 | 1, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const currentIndex = apps.findIndex((a) => a.id === appId);
    if (currentIndex === -1) return;

    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= apps.length) return;

    const updated = [...apps];
    const [movedApp] = updated.splice(currentIndex, 1);
    updated.splice(targetIndex, 0, movedApp);

    const reordered = updated.map((app, idx) => ({ ...app, position: idx }));
    setApps(reordered);
    persistOrder(reordered);
  };

  // Drag & drop handlers
  const handleDragStart = (id: string, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    setDraggedId(id);
  };

  const handleDragOver = (id: string, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverId !== id) {
      setDragOverId(id);
    }
  };

  const handleDragLeave = (id: string) => {
    if (dragOverId === id) {
      setDragOverId(null);
    }
  };

  const handleDrop = (targetId: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const sourceId = draggedId || e.dataTransfer.getData("text/plain");
    setDraggedId(null);
    setDragOverId(null);

    if (!sourceId || sourceId === targetId) return;

    const sourceIndex = apps.findIndex((a) => a.id === sourceId);
    const targetIndex = apps.findIndex((a) => a.id === targetId);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const updated = [...apps];
    const [movedApp] = updated.splice(sourceIndex, 1);
    updated.splice(targetIndex, 0, movedApp);

    const reordered = updated.map((app, idx) => ({ ...app, position: idx }));
    setApps(reordered);
    persistOrder(reordered);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleCreated = (savedApp: EmbeddedApp) => {
    setApps((prev) => {
      const idx = prev.findIndex((a) => a.id === savedApp.id);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = savedApp;
        return next;
      }
      return [savedApp, ...prev];
    });
  };

  const handleDelete = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!confirm(`Are you sure you want to remove "${name}" from Agent Studio?`)) {
      return;
    }

    setDeletingId(id);
    try {
      const res = await fetch(`/api/apps/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete application");
      }
      const updated = apps.filter((a) => a.id !== id);
      setApps(updated);
      persistOrder(updated);
    } catch (err: any) {
      alert(err.message || "Failed to delete application");
    } finally {
      setDeletingId(null);
    }
  };

  const handleEdit = (app: EmbeddedApp, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingApp(app);
    setIsModalOpen(true);
  };

  const handleRestoreDefaults = async () => {
    if (!confirm("Restore all default built-in applications (LangGraph, Gradio, Grafana, Swagger, Streamlit) to this workspace?")) {
      return;
    }
    setIsRestoringDefaults(true);
    try {
      const res = await fetch("/api/apps/restore", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to restore defaults");
      if (Array.isArray(data.apps)) {
        setApps(data.apps);
      }
    } catch (err: any) {
      alert(err.message || "Failed to restore default applications");
    } finally {
      setIsRestoringDefaults(false);
    }
  };

  return (
    <div className="apps-container">
      {/* Header */}
      <header className="apps-header">
        <div className="apps-title-group">
          <h1>
            Embedded Applications
            <span className="apps-badge">CANVAS MODULE</span>
          </h1>
          <p className="apps-subtitle">
            Embed, organize, and interact with external web applications, custom agent user interfaces,
            and operational dashboards directly inside the Agent Studio canvas.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {hasHiddenDefaults && (
            <button
              type="button"
              className="apps-restore-btn"
              onClick={handleRestoreDefaults}
              disabled={isRestoringDefaults}
              title="Restore removed default applications"
            >
              <span>↺</span>
              <span>{isRestoringDefaults ? "Restoring..." : "Restore Default Apps"}</span>
            </button>
          )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditingApp(null);
              setIsModalOpen(true);
            }}
            style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "10px 18px", fontWeight: 600 }}
          >
            <span>+</span>
            <span>Embed Application</span>
          </button>
        </div>
      </header>

      {/* Controls Bar: Category Filter, Search & Reorder Hint */}
      <div className="apps-controls-bar">
        <div className="apps-categories">
          {CATEGORY_FILTERS.map((cat) => {
            const count =
              cat.id === "all"
                ? apps.length
                : apps.filter((a) => a.category === cat.id).length;
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                className={`apps-cat-btn ${isActive ? "active" : ""}`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                {cat.label} ({count})
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div className="apps-reorder-hint" title="Drag the ⠿ handle or click ← → to change app position">
            <span style={{ fontSize: "14px" }}>⠿</span>
            <span>Drag or use ← → to rearrange</span>
            {isSavingOrder && <span style={{ opacity: 0.7, fontSize: "11px" }}>(Saving...)</span>}
          </div>

          <div className="apps-search-wrap">
            <span className="apps-search-icon">🔍</span>
            <input
              type="text"
              className="apps-search-input"
              placeholder="Search embedded applications..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Tiles Grid */}
      {filteredApps.length === 0 ? (
        <div
          style={{
            padding: "48px 24px",
            textAlign: "center",
            background: "#091a38",
            border: "1px dashed rgba(148, 188, 227, 0.25)",
            borderRadius: "var(--radius)",
            color: "var(--sky-2)",
          }}
        >
          <div style={{ fontSize: "36px", marginBottom: "12px" }}>🌐</div>
          <div style={{ fontSize: "16px", fontWeight: 600, color: "#fff", marginBottom: "6px" }}>
            No applications found matching your criteria
          </div>
          <div style={{ fontSize: "13px", color: "var(--sky-3)", marginBottom: "20px" }}>
            {searchQuery
              ? "Try adjusting your search terms or filter."
              : "Register your first web application to view and operate it in the canvas."}
          </div>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
            {hasHiddenDefaults && (
              <button
                type="button"
                className="apps-restore-btn"
                onClick={handleRestoreDefaults}
                disabled={isRestoringDefaults}
              >
                ↺ Restore Default Apps
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditingApp(null);
                setIsModalOpen(true);
              }}
            >
              + Embed Application Now
            </button>
          </div>
        </div>
      ) : (
        <div className="apps-grid">
          {filteredApps.map((app) => {
            const globalIndex = apps.findIndex((a) => a.id === app.id);
            const isFirst = globalIndex === 0;
            const isLast = globalIndex === apps.length - 1;
            const isDragging = draggedId === app.id;
            const isDragOver = dragOverId === app.id;

            return (
              <div
                key={app.id}
                className={`app-tile ${isDragging ? "is-dragging" : ""} ${isDragOver ? "drag-over" : ""}`}
                draggable={true}
                onDragStart={(e) => handleDragStart(app.id, e)}
                onDragOver={(e) => handleDragOver(app.id, e)}
                onDragLeave={() => handleDragLeave(app.id)}
                onDrop={(e) => handleDrop(app.id, e)}
                onDragEnd={handleDragEnd}
                style={{ cursor: "pointer" }}
                onClick={() => router.push(`/apps/${app.id}`)}
              >
                {/* Top Row: Icon, Badges & Drag Handle */}
                <div className="app-tile-top">
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div className="app-tile-icon-box">
                      {getIconSymbol(app.icon)}
                    </div>
                    <div className="app-tile-badges">
                      <span className="app-cat-badge">{app.category}</span>
                      <span className="app-status-live">
                        <span className="app-status-dot" />
                        Live
                      </span>
                    </div>
                  </div>

                  {/* Drag Handle */}
                  <div
                    className="app-tile-drag-handle"
                    title="Drag to change position on screen"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span style={{ fontSize: "16px", lineHeight: 1 }}>⠿</span>
                  </div>
                </div>

                {/* Title & Description */}
                <h3 className="app-tile-title">{app.name}</h3>
                <p className="app-tile-desc">{app.description || "Web application embedded in Agent Studio."}</p>

                {/* URL Snippet */}
                <div className="app-tile-url" title={app.url}>
                  <span style={{ opacity: 0.7 }}>🔒</span>
                  <span>{app.url}</span>
                </div>

                {/* Actions Footer: Open, Reorder Arrows, External, Edit & Delete for ALL Apps */}
                <div className="app-tile-actions" onClick={(e) => e.stopPropagation()}>
                  <Link
                    href={`/apps/${app.id}`}
                    className="app-tile-btn-primary"
                    title="Open in Agent Studio Canvas"
                  >
                    <span>Open in Canvas</span>
                    <span style={{ fontSize: "13px" }}>↗</span>
                  </Link>

                  {/* Move Earlier / Left */}
                  <button
                    type="button"
                    className="app-tile-btn-icon"
                    title="Move position earlier (left)"
                    disabled={isFirst}
                    onClick={(e) => handleMove(app.id, -1, e)}
                    style={{
                      opacity: isFirst ? 0.35 : 1,
                      cursor: isFirst ? "not-allowed" : "pointer",
                      fontSize: "14px",
                    }}
                  >
                    ←
                  </button>

                  {/* Move Later / Right */}
                  <button
                    type="button"
                    className="app-tile-btn-icon"
                    title="Move position later (right)"
                    disabled={isLast}
                    onClick={(e) => handleMove(app.id, 1, e)}
                    style={{
                      opacity: isLast ? 0.35 : 1,
                      cursor: isLast ? "not-allowed" : "pointer",
                      fontSize: "14px",
                    }}
                  >
                    →
                  </button>

                  {/* External Tab */}
                  <a
                    href={app.url}
                    target="_blank"
                    rel="noreferrer"
                    className="app-tile-btn-icon"
                    title="Open in External Tab"
                  >
                    ↗
                  </a>

                  {/* Edit - Universal for all apps */}
                  <button
                    type="button"
                    className="app-tile-btn-icon"
                    title="Edit Application"
                    onClick={(e) => handleEdit(app, e)}
                  >
                    ✎
                  </button>

                  {/* Delete - Universal for all apps */}
                  <button
                    type="button"
                    className="app-tile-btn-icon app-tile-btn-delete"
                    title="Delete Application"
                    disabled={deletingId === app.id}
                    onClick={(e) => handleDelete(app.id, app.name, e)}
                    style={{ color: "#f87171" }}
                  >
                    {deletingId === app.id ? "…" : "🗑"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal for Embed / Edit */}
      <AddAppModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingApp(null);
        }}
        onCreated={handleCreated}
        editingApp={editingApp}
      />
    </div>
  );
}
