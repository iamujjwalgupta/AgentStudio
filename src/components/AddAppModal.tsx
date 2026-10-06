"use client";

import { useEffect, useRef, useState } from "react";
import type { EmbeddedApp } from "@/lib/apps";
import { APP_ICONS, AppGlyph, AppTile, CATEGORIES, ICON_LABEL, MODES, SANDBOX_DEFAULT, categoryOf, hostOf, modeOf, type EmbedMode } from "./apps/AppVisuals";
import { CrossIcon } from "./agent-ui";

interface AddAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (app: EmbeddedApp) => void;
  editingApp?: EmbeddedApp | null;
}

/** A readable name from an address: "cashflow-intelligence-1333.run.app" → "Cashflow Intelligence". */
function nameFromUrl(url: string) {
  const host = hostOf(url).replace(/^www\./, "");
  const first = host.split(".")[0] || "";
  return first
    .split(/[-_]/)
    // Drop numbers and generated suffixes ("133379243863", "lwpgyh3rxa").
    .filter((w) => w && !/\d/.test(w))
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export default function AddAppModal({ isOpen, onClose, onCreated, editingApp }: AddAppModalProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("agent-ui");
  const [icon, setIcon] = useState("globe");
  const [mode, setMode] = useState<EmbedMode>("proxy");
  const [flags, setFlags] = useState(SANDBOX_DEFAULT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const nameTouched = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    if (editingApp) {
      setName(editingApp.name);
      setUrl(editingApp.url);
      setDescription(editingApp.description || "");
      setCategory(categoryOf(editingApp.category || "custom").id);
      setIcon(editingApp.icon || "globe");
      const m = modeOf(editingApp.permissions);
      setMode(m);
      setFlags(m === "sandboxed" ? editingApp.permissions : SANDBOX_DEFAULT);
      nameTouched.current = true;
    } else {
      setName("");
      setUrl("");
      setDescription("");
      setCategory("agent-ui");
      setIcon("globe");
      setMode("proxy");
      setFlags(SANDBOX_DEFAULT);
      nameTouched.current = false;
    }
    setError("");
  }, [editingApp, isOpen]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && isOpen && !loading && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const normalised = url.trim() && !/^https?:\/\//i.test(url.trim()) ? `https://${url.trim()}` : url.trim();
  const validUrl = (() => {
    try {
      const u = new URL(normalised);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  })();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validUrl) return setError("Enter the app's web address, for example https://reports.example.com.");
    if (!name.trim()) return setError("Give the app a name.");
    setLoading(true);
    setError("");
    const body = {
      name: name.trim(),
      url: normalised,
      description: description.trim(),
      category,
      icon,
      permissions: mode === "proxy" ? "proxy" : mode === "direct" ? "unrestricted" : flags.trim() || SANDBOX_DEFAULT,
    };
    try {
      const res = await fetch(editingApp ? `/api/apps/${editingApp.id}` : "/api/apps", {
        method: editingApp ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The app could not be saved.");
      onCreated(data.app);
      onClose();
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const cat = categoryOf(category);

  return (
    <div className="modal-back" onMouseDown={() => !loading && onClose()}>
      <form className="ap-modal" role="dialog" aria-modal="true" aria-labelledby="ap-modal-title" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="ap-modal-head">
          <div>
            <div className="eyebrow">{editingApp ? "Edit app" : "Add app"}</div>
            <h2 id="ap-modal-title">{editingApp ? editingApp.name : "Open a web app inside Agent Studio"}</h2>
          </div>
          <button type="button" className="ap-close" onClick={onClose} aria-label="Close"><CrossIcon size={13} /></button>
        </div>

        <div className="ap-modal-body">
          <label className="ap-field">
            <span className="ap-label-row">
              <span className="ap-label">Web address</span>
              {validUrl && <a href={normalised} target="_blank" rel="noreferrer" className="ap-test">Open it in a new tab ↗</a>}
            </span>
            <input
              className="input mono"
              value={url}
              autoFocus={!editingApp}
              placeholder="https://reports.example.com  or  http://localhost:8080"
              onChange={(e) => {
                setUrl(e.target.value);
                if (!nameTouched.current) setName(nameFromUrl(e.target.value));
              }}
              onBlur={() => url.trim() && setUrl(normalised)}
            />
          </label>

          <div className="ap-two">
            <label className="ap-field">
              <span className="ap-label">Name</span>
              <input className="input" value={name} maxLength={80} placeholder="e.g. Cashflow Intelligence" onChange={(e) => { nameTouched.current = true; setName(e.target.value); }} />
            </label>
            <label className="ap-field">
              <span className="ap-label">Category</span>
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
          </div>

          <label className="ap-field">
            <span className="ap-label">What it&apos;s for <em>— optional, shown on its tile</em></span>
            <textarea className="textarea" rows={2} maxLength={300} value={description} placeholder="e.g. Forecasts 13-week cash position from bank and AP/AR data." onChange={(e) => setDescription(e.target.value)} />
          </label>

          <div className="ap-field">
            <span className="ap-label">Icon</span>
            <div className="ap-icons" role="radiogroup" aria-label="Icon">
              {APP_ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  role="radio"
                  aria-checked={icon === ic}
                  className={`ap-icon-opt ${icon === ic ? "on" : ""}`}
                  style={icon === ic ? { color: cat.colour, background: cat.bg, borderColor: cat.colour } : undefined}
                  onClick={() => setIcon(ic)}
                  title={ICON_LABEL[ic]}
                >
                  <AppGlyph icon={ic} size={18} />
                </button>
              ))}
            </div>
          </div>

          <div className="ap-field">
            <span className="ap-label">How it loads</span>
            <div className="ap-modes" role="radiogroup" aria-label="How it loads">
              {(Object.keys(MODES) as EmbedMode[]).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} className={`ap-mode-opt ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>
                  <span className="ap-radio" />
                  <span className="grow">
                    <b>{MODES[m].label}{m === "proxy" && <em> · recommended</em>}</b>
                    <span>{MODES[m].body} {MODES[m].when}</span>
                  </span>
                </button>
              ))}
            </div>
            {mode === "sandboxed" && (
              <label className="ap-field" style={{ marginTop: 8 }}>
                <span className="ap-label small">Sandbox permissions</span>
                <input className="input mono ap-flags" value={flags} onChange={(e) => setFlags(e.target.value)} />
              </label>
            )}
          </div>

          <div className="ap-preview">
            <span className="ap-preview-label">On the Apps page</span>
            <div className="ap-preview-card">
              <AppTile icon={icon} category={category} size={40} />
              <div className="grow">
                <b>{name.trim() || "App name"}</b>
                <code>{validUrl ? hostOf(normalised) : "address"}</code>
              </div>
              <span className="ap-cat" style={{ color: cat.colour }}>{cat.short}</span>
            </div>
          </div>
        </div>

        {error && <div className="error" style={{ margin: "0 22px 12px" }}>{error}</div>}
        <div className="ap-modal-foot">
          <button type="button" className="btn" onClick={onClose} disabled={loading}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={loading || !url.trim() || !name.trim()}>
            {loading ? "Saving…" : editingApp ? "Save changes" : "Add app"}
          </button>
        </div>
      </form>
    </div>
  );
}
