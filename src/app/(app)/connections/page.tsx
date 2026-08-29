"use client";

import { useEffect, useState } from "react";

type Conn = { id: string; name: string; kind: string; config: any; created_at: string };

const KINDS: {
  id: string;
  label: string;
  blurb: string;
  secretLabel: string;
  secretHint: string;
  fields: { key: string; label: string; hint?: string; type?: string }[];
}[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    blurb:
      "The API key your agents think with. Needed to compile a brief and to run an agent; without one the rest of the app still works. Overrides the server's key for this workspace.",
    secretLabel: "API key",
    secretHint: "sk-ant-…",
    fields: [{ key: "model", label: "Model", hint: "Leave blank for the workspace default" }],
  },
  {
    id: "postgres",
    label: "Database",
    blurb: "Lets an agent run read-only SQL.",
    secretLabel: "Connection string",
    secretHint: "postgresql://user:password@host:5432/database",
    fields: [],
  },
  {
    id: "http",
    label: "REST API",
    blurb: "Lets an agent call an API you already use.",
    secretLabel: "Auth header value",
    secretHint: "Bearer abc123 — leave blank if the API is open",
    fields: [
      { key: "baseUrl", label: "Base URL", hint: "https://api.example.com/v1" },
      { key: "authHeader", label: "Auth header name", hint: "Authorization" },
    ],
  },
  {
    id: "smtp",
    label: "Email",
    blurb: "Lets an agent send email. Always gated behind approval.",
    secretLabel: "Password",
    secretHint: "The SMTP password or app password",
    fields: [
      { key: "host", label: "Host", hint: "smtp.example.com" },
      { key: "port", label: "Port", hint: "587" },
      { key: "user", label: "Username", hint: "notifications@example.com" },
      { key: "from", label: "Send as", hint: "Agent Studio <notifications@example.com>" },
    ],
  },
  {
    id: "slack",
    label: "Slack",
    blurb: "Lets an agent post to a channel. Always gated behind approval.",
    secretLabel: "Incoming webhook URL",
    secretHint: "https://hooks.slack.com/services/…",
    fields: [{ key: "channel", label: "Channel", hint: "#ops-alerts" }],
  },
];

export default function ConnectionsPage() {
  const [conns, setConns] = useState<Conn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("anthropic");
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState("");
  const [results, setResults] = useState<Record<string, string>>({});

  const active = KINDS.find((k) => k.id === kind)!;

  async function load() {
    try {
      const res = await fetch("/api/connections");
      if (!res.ok) throw new Error("Connections could not be loaded.");
      const j = await res.json();
      setConns(j.connections ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!name.trim()) {
      setError("Give the connection a name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind, config, secret }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The connection could not be saved.");
      setOpen(false);
      setName("");
      setSecret("");
      setConfig({});
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function test(id: string) {
    setTesting(id);
    setResults({ ...results, [id]: "" });
    try {
      const res = await fetch(`/api/connections/${id}`, { method: "POST" });
      const j = await res.json();
      setResults({ ...results, [id]: `${j.ok ? "✓" : "✗"} ${j.detail}` });
    } catch (e: any) {
      setResults({ ...results, [id]: `✗ ${e.message}` });
    } finally {
      setTesting("");
    }
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Remove "${label}"? Agents using it will lose that capability.`)) return;
    await fetch(`/api/connections/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Connections</h1>
          <p className="sub">
            Systems your agents are allowed to reach. Credentials are encrypted before they are stored and are
            never sent back to the browser.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setOpen(!open)}>
          {open ? "Cancel" : "Add connection"}
        </button>
      </header>

      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

      {open && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>New connection</h2>
          <p className="help">Pick what it connects to, then fill in the details your administrator gave you.</p>

          <div className="seg" style={{ marginBottom: 16 }}>
            {KINDS.map((k) => (
              <button
                key={k.id}
                className={`seg-opt ${kind === k.id ? "on" : ""}`}
                onClick={() => {
                  setKind(k.id);
                  setConfig({});
                }}
              >
                {k.label}
              </button>
            ))}
          </div>

          <p className="sub-line" style={{ marginBottom: 14 }}>{active.blurb}</p>

          <div className="stack">
            <label className="field">
              <span className="eyebrow">Name</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="What your team calls this system"
              />
            </label>

            {active.fields.map((f) => (
              <label className="field" key={f.key}>
                <span className="eyebrow">{f.label}</span>
                <input
                  className="input"
                  value={config[f.key] ?? ""}
                  placeholder={f.hint}
                  onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                />
              </label>
            ))}

            <label className="field">
              <span className="eyebrow">{active.secretLabel}</span>
              <input
                className="input mono"
                type="password"
                value={secret}
                placeholder={active.secretHint}
                onChange={(e) => setSecret(e.target.value)}
              />
            </label>

            {kind === "postgres" && (
              <label className="field" style={{ display: "flex", gap: 9, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.allowWrites === "yes"}
                  onChange={(e) => setConfig({ ...config, allowWrites: e.target.checked ? "yes" : "" })}
                />
                <span>Allow write statements. Leave off and agents can only read.</span>
              </label>
            )}
          </div>

          <div className="panel-foot">
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save connection"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="note">Loading connections…</div>
      ) : conns.length === 0 ? (
        <div className="empty">
          <h3>No connections yet</h3>
          <p>Agents can still search the web, read uploads and write files. Add a connection to give them more.</p>
        </div>
      ) : (
        <div className="table">
          <div className="tr th" style={{ gridTemplateColumns: "2fr 1fr 2fr .6fr" }}>
            <div>Name</div>
            <div>Type</div>
            <div>Details</div>
            <div />
          </div>
          {conns.map((c) => (
            <div className="tr" key={c.id} style={{ gridTemplateColumns: "2fr 1fr 2fr .6fr" }}>
              <div className="name">{c.name}</div>
              <div>
                <span className="tag tag-neutral">{KINDS.find((k) => k.id === c.kind)?.label ?? c.kind}</span>
              </div>
              <div className="sub-line mono">
                {results[c.id] ||
                  c.config?.baseUrl ||
                  c.config?.host ||
                  c.config?.channel ||
                  c.config?.model ||
                  "Credential stored, encrypted"}
              </div>
              <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button className="btn btn-ghost" onClick={() => test(c.id)} disabled={testing === c.id}>
                  {testing === c.id ? "Testing…" : "Test"}
                </button>
                <button className="btn btn-ghost" onClick={() => remove(c.id, c.name)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
