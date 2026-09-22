"use client";

import { useState, useEffect } from "react";
import type { CanvasBookmark, CanvasPreset } from "@/lib/agent-bridge";

interface CanvasBookmarksBarProps {
  appId: string;
  appName: string;
  currentUrl: string;
  onNavigateUrl: (url: string) => void;
  onApplyPreset: (preset: CanvasPreset) => void;
}

const DEFAULT_PRESETS: CanvasPreset[] = [
  {
    id: "preset-dark-mode",
    name: "🌙 Dark Mode",
    description: "Send dark mode preference to embedded canvas app",
    parameters: { theme: "dark", highContrast: false },
  },
  {
    id: "preset-test-data",
    name: "🧪 Test Sandbox",
    description: "Inject mock test fixtures & sample customer records",
    parameters: { mode: "sandbox", mockData: true, tenant: "qa-team" },
  },
  {
    id: "preset-live-stream",
    name: "⚡ 5s Telemetry",
    description: "Enable real-time 5-second polling/streaming telemetry",
    parameters: { pollIntervalMs: 5000, streamingEnabled: true },
  },
];

export default function CanvasBookmarksBar({
  appId,
  appName,
  currentUrl,
  onNavigateUrl,
  onApplyPreset,
}: CanvasBookmarksBarProps) {
  const [bookmarks, setBookmarks] = useState<CanvasBookmark[]>([]);
  const [isAddBookmarkOpen, setIsAddBookmarkOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newUrl, setNewUrl] = useState(currentUrl);

  // Load bookmarks from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(`agent_studio_bookmarks_${appId}`);
      if (saved) {
        setBookmarks(JSON.parse(saved));
      } else {
        // Initial sample bookmarks for convenience
        const defaults: CanvasBookmark[] = [
          {
            id: "b1",
            appId,
            title: "Default Home View",
            url: currentUrl,
            createdAt: new Date().toISOString(),
          },
        ];
        setBookmarks(defaults);
        localStorage.setItem(`agent_studio_bookmarks_${appId}`, JSON.stringify(defaults));
      }
    } catch {
      // Fallback
    }
  }, [appId, currentUrl]);

  const handleSaveBookmark = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const newBookmark: CanvasBookmark = {
      id: "bm_" + Date.now(),
      appId,
      title: newTitle.trim(),
      url: newUrl.trim() || currentUrl,
      createdAt: new Date().toISOString(),
    };

    const updated = [newBookmark, ...bookmarks];
    setBookmarks(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem(`agent_studio_bookmarks_${appId}`, JSON.stringify(updated));
    }

    setNewTitle("");
    setIsAddBookmarkOpen(false);
  };

  const handleDeleteBookmark = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = bookmarks.filter((b) => b.id !== id);
    setBookmarks(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem(`agent_studio_bookmarks_${appId}`, JSON.stringify(updated));
    }
  };

  return (
    <div className="app-bookmarks-bar">
      {/* Bookmarks Section */}
      <div className="app-bookmarks-group">
        <span className="app-bookmarks-label">Bookmarks:</span>
        <div className="app-bookmarks-chips">
          {bookmarks.map((b) => (
            <button
              key={b.id}
              type="button"
              className="app-bookmark-chip"
              onClick={() => onNavigateUrl(b.url)}
              title={`Load deep link: ${b.url}`}
            >
              <span>★</span>
              <span className="app-bookmark-title">{b.title}</span>
              <span
                className="app-bookmark-del"
                onClick={(e) => handleDeleteBookmark(b.id, e)}
                title="Remove bookmark"
              >
                ×
              </span>
            </button>
          ))}

          <button
            type="button"
            className="app-bookmark-add-btn"
            onClick={() => {
              setNewUrl(currentUrl);
              setIsAddBookmarkOpen(true);
            }}
            title="Bookmark this view"
          >
            + Save View
          </button>
        </div>
      </div>

      <div className="app-bookmarks-divider" />

      {/* Quick Presets Section */}
      <div className="app-bookmarks-group">
        <span className="app-bookmarks-label">Quick Presets:</span>
        <div className="app-bookmarks-chips">
          {DEFAULT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="app-preset-chip"
              onClick={() => onApplyPreset(p)}
              title={p.description}
            >
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Add Bookmark Modal */}
      {isAddBookmarkOpen && (
        <div
          className="app-auth-modal-overlay"
          onClick={() => setIsAddBookmarkOpen(false)}
        >
          <div
            className="app-auth-modal"
            style={{ maxWidth: "440px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h3 style={{ margin: 0, fontSize: "15px", color: "#fff" }}>Save Canvas Bookmark</h3>
              <button
                type="button"
                onClick={() => setIsAddBookmarkOpen(false)}
                style={{ background: "transparent", border: "none", color: "var(--sky-3)", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveBookmark}>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "11px", color: "var(--sky-3)", marginBottom: "4px" }}>
                  Bookmark Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Q3 Pipeline Filters, Admin Debug Mode"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="input"
                  style={{ width: "100%", fontSize: "12.5px" }}
                />
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "11px", color: "var(--sky-3)", marginBottom: "4px" }}>
                  Target Deep Link URL
                </label>
                <input
                  type="url"
                  required
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  className="input"
                  style={{ width: "100%", fontSize: "12px", fontFamily: "var(--mono)" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button
                  type="button"
                  className="btn btn-subtle"
                  onClick={() => setIsAddBookmarkOpen(false)}
                  style={{ padding: "5px 12px", fontSize: "12px" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ padding: "5px 14px", fontSize: "12px" }}
                >
                  Save Bookmark
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
