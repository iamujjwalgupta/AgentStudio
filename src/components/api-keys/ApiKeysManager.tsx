"use client";

import { useEffect, useState } from "react";
import { AlertIcon, CheckIcon, CopyIcon, CrossIcon } from "@/components/agent-ui";

type Key = {
  id: string;
  name: string;
  prefix: string;
  agent_ids: string[] | null;
  created_by_name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  runs: number;
};
type Agent = { id: string; name: string; status: string; published_ver: number | null };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
function ago(iso: string | null) {
  if (!iso) return "Never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return "Just now";
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "An hour ago" : `${h} hours ago`;
  return day(iso);
}

/** Ready-to-run calls, in the three places people most often try one. */
function snippets(origin: string, key: string, agentId: string) {
  const url = `${origin}/api/v1/agents/${agentId}/invoke?wait=true`;
  const input = "Reconcile the September bank statement";
  return {
    PowerShell:
      `Invoke-RestMethod -Method Post -Uri "${url}" \`\n` +
      `  -Headers @{ Authorization = "Bearer ${key}" } \`\n` +
      `  -ContentType "application/json" \`\n` +
      `  -Body '{ "input": "${input}" }'`,
    curl:
      `curl -X POST "${url}" \\\n` +
      `  -H "Authorization: Bearer ${key}" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -d '{ "input": "${input}" }'`,
    "Node.js":
      `const res = await fetch("${url}", {\n` +
      `  method: "POST",\n` +
      `  headers: {\n` +
      `    Authorization: "Bearer " + process.env.AGENT_STUDIO_KEY,\n` +
      `    "Content-Type": "application/json",\n` +
      `  },\n` +
      `  body: JSON.stringify({ input: "${input}" }),\n` +
      `});\n` +
      `const run = await res.json();\n` +
      `console.log(run.status, run.output);`,
  };
}

export default function ApiKeysManager() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Key | null>(null);
  const [origin, setOrigin] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/api-keys", { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "API keys could not be loaded.");
      setKeys(j.keys ?? []);
      setAgents(j.agents ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setOrigin(window.location.origin);
    load();
  }, []);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "A removed agent";
  const active = keys.filter((k) => !k.revoked_at);
  const examples = snippets(origin, "as_live_…your key…", agents.find((a) => a.published_ver)?.id ?? "AGENT_ID");

  return (
    <div className="page mb ak">
      <header className="page-head">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>API keys</h1>
          <p className="sub" style={{ maxWidth: 780 }}>
            A key lets another application start your agents with nobody signed in. Calls run the agent&apos;s published version,
            meet the same usage limits and approvals as any run, and show in Runs and the audit trail.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Create key</button>
      </header>

      {notice && (
        <div className="mb-notice">
          <CheckIcon size={13} /> <span className="grow">{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Dismiss"><CrossIcon size={11} /></button>
        </div>
      )}
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="mb-layout">
        <div className="mb-main">
          {loading ? (
            <div className="mb-skel"><span /><span /></div>
          ) : !keys.length ? (
            <div className="ak-empty">
              <b>No keys yet</b>
              <p>Create one for each application that should call your agents, so you can revoke one without affecting the others.</p>
              <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Create key</button>
            </div>
          ) : (
            <div className="al-table ak-table" role="table">
              <div className="al-row al-head" role="row">
                <div>Key</div>
                <div>Can run</div>
                <div>Last used</div>
                <div>Created</div>
                <div />
              </div>
              {keys.map((k) => (
                <div key={k.id} className={`al-row${k.revoked_at ? " ak-revoked" : ""}`} role="row" style={{ cursor: "default" }}>
                  <div className="al-main">
                    <span className="al-name" style={{ cursor: "default" }}>
                      {k.name}
                      {k.revoked_at && <span className="ak-tag">Revoked</span>}
                    </span>
                    <div className="al-desc"><code className="ak-prefix">{k.prefix}…</code></div>
                  </div>
                  <div className="al-small" title={k.agent_ids?.map(agentName).join(", ")}>
                    {!k.agent_ids
                      ? "All agents"
                      : k.agent_ids.length === 1
                        ? agentName(k.agent_ids[0])
                        : `${k.agent_ids.length} agents`}
                  </div>
                  <div className="al-small">
                    {ago(k.last_used_at)}
                    {k.runs > 0 && <div className="dim">{k.runs} {k.runs === 1 ? "run" : "runs"}</div>}
                  </div>
                  <div className="al-small">
                    {day(k.created_at)}
                    <div className="dim">{k.created_by_name}</div>
                  </div>
                  <div className="al-actions">
                    {k.revoked_at ? (
                      <span className="al-small dim">{day(k.revoked_at)}</span>
                    ) : (
                      <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setRevoking(k)}>Revoke</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {active.length > 0 && (
            <p className="mb-foot">Lost a key? Keys can&apos;t be shown again. Create a new one, update the application, then revoke the old one.</p>
          )}
        </div>

        <aside className="mb-side">
          <section className="mb-card">
            <h2>How an application calls an agent</h2>
            <ol className="ak-steps">
              <li><b>Publish the agent.</b> Keys run published versions only.</li>
              <li><b>Create a key</b> here and give it to the application&apos;s team. They keep it on their server, never in a web page.</li>
              <li>
                <b>Send a request</b> to the agent&apos;s address with the key. Add <code>?wait=true</code> to get the answer back in the
                same response (up to 4 minutes).
              </li>
              <li>
                <b>Longer runs</b> answer at once with a <code>statusUrl</code>. Ask it again until <code>status</code> is{" "}
                <code>completed</code>. If an action needs approval, it says <code>awaiting_approval</code> until someone decides in
                Approvals.
              </li>
            </ol>
            <Examples sets={examples} />
            <p className="mb-small">
              Each agent&apos;s address is on its Build → Schedule step, under &ldquo;Call it from another system&rdquo;.
            </p>
          </section>
        </aside>
      </div>

      {creating && (
        <CreateDialog
          agents={agents}
          origin={origin}
          onClose={() => setCreating(false)}
          onCreated={() => load()}
        />
      )}

      {revoking && (
        <RevokeDialog
          k={revoking}
          onClose={() => setRevoking(null)}
          onDone={async () => {
            setNotice(`Revoked “${revoking.name}”. Calls with it now fail.`);
            setRevoking(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function Examples({ sets }: { sets: Record<string, string> }) {
  const names = Object.keys(sets);
  const [tab, setTab] = useState(names[0]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="ak-ex">
      <div className="ak-ex-tabs" role="tablist">
        {names.map((n) => (
          <button key={n} type="button" role="tab" aria-selected={tab === n} className={tab === n ? "on" : ""} onClick={() => setTab(n)}>{n}</button>
        ))}
        <button
          type="button"
          className="ak-ex-copy"
          onClick={() => navigator.clipboard?.writeText(sets[tab]).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); })}
        >
          {copied ? <><CheckIcon size={12} /> Copied</> : <><CopyIcon size={12} /> Copy</>}
        </button>
      </div>
      <pre>{sets[tab]}</pre>
    </div>
  );
}

function useEscape(onClose: () => void, busy: boolean) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose, busy]);
}

function CreateDialog({ agents, origin, onClose, onCreated }: { agents: Agent[]; origin: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"all" | "some">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [made, setMade] = useState<{ key: string; name: string; agentIds: string[] | null } | null>(null);
  const [copied, setCopied] = useState(false);
  useEscape(onClose, busy);

  async function create() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, agentIds: scope === "all" ? null : picked }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The key could not be created.");
      setMade({ key: j.key, name: j.name, agentIds: j.agentIds });
      onCreated();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  // Said beside the button, so it is never disabled without a reason.
  const missing = !name.trim()
    ? "Give the key a name to continue."
    : scope === "some" && !picked.length
      ? "Tick at least one agent to continue."
      : "";
  // The example points at an agent this key can actually run, published if there is one.
  const usable = made ? agents.filter((a) => !made.agentIds || made.agentIds.includes(a.id)) : [];
  const sample = usable.find((a) => a.published_ver) ?? usable[0];

  return (
    <div className="modal-back" onMouseDown={() => !busy && !made && onClose()}>
      <div className="panel modal ak-dialog" role="dialog" aria-modal="true" aria-labelledby="ak-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="eyebrow">API key</div>
        {!made ? (
          <>
            <h2 id="ak-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>Create a key</h2>
            <p className="help" style={{ marginTop: 0 }}>One key per application, so each can be revoked on its own.</p>
            <label className="field" style={{ marginTop: 10 }}>
              <span className="eyebrow">Name</span>
              <input
                className="input"
                autoFocus
                value={name}
                maxLength={80}
                placeholder="e.g. ERP integration"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !missing && !busy && create()}
              />
            </label>
            <div className="field" style={{ marginTop: 12 }}>
              <span className="eyebrow">Which agents can it run?</span>
              <div className="mb-role-pick" role="radiogroup">
                <button type="button" role="radio" aria-checked={scope === "all"} className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>
                  <span className="mb-radio" />
                  <span className="grow"><b>All agents</b><span>Every published agent in this workspace, including ones published later.</span></span>
                </button>
                <button type="button" role="radio" aria-checked={scope === "some"} className={scope === "some" ? "on" : ""} onClick={() => setScope("some")}>
                  <span className="mb-radio" />
                  <span className="grow"><b>Only the agents I choose</b><span>Safer when the application needs just one or two.</span></span>
                </button>
              </div>
              {scope === "some" && (
                <div className="ak-pick">
                  {!agents.length && <p className="dim" style={{ margin: 0, fontSize: 12.5 }}>This workspace has no agents yet.</p>}
                  {agents.map((a) => (
                    <label key={a.id} className="ak-pick-row">
                      <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a.id)} />
                      <span className="grow">{a.name}</span>
                      {!a.published_ver && <span className="ak-draft" title="It can be called once it is published.">Not published</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
            {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
            <div className="panel-foot">
              <span className="ak-missing" aria-live="polite">{missing}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                <button className="btn btn-primary" onClick={create} disabled={busy || !!missing}>
                  {busy ? "Creating…" : "Create key"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <h2 id="ak-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>“{made.name}” is ready</h2>
            <div className="ak-once">
              <AlertIcon size={14} />
              <span>Copy the key now. It won&apos;t be shown again. Anyone who has it can run {made.agentIds ? "these agents" : "your agents"}, so keep it on a server, not in a web page or in code you commit.</span>
            </div>
            <div className="mb-link">
              <code>{made.key}</code>
              <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(made.key).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); })}>
                {copied ? <><CheckIcon size={12} /> Copied</> : <><CopyIcon size={12} /> Copy key</>}
              </button>
            </div>
            {sample && (
              <>
                <p className="help" style={{ margin: "14px 0 6px" }}>
                  Try it: this runs <b>{sample.name}</b>
                  {!sample.published_ver ? " (publish it first, or the call is refused)" : ""} and waits for the answer.
                </p>
                <Examples sets={snippets(origin, made.key, sample.id)} />
              </>
            )}
            <div className="panel-foot">
              <span />
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RevokeDialog({ k, onClose, onDone }: { k: Key; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEscape(onClose, busy);
  async function revoke() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/api-keys/${k.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The key could not be revoked.");
      await onDone();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="modal-back" onMouseDown={() => !busy && onClose()}>
      <div className="panel modal" role="dialog" aria-modal="true" aria-labelledby="ak-rev-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="eyebrow">API key</div>
        <h2 id="ak-rev-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>Revoke “{k.name}”?</h2>
        <p className="help" style={{ marginTop: 0 }}>
          Any application using <code>{k.prefix}…</code> stops working straight away. This can&apos;t be undone. Runs it already
          started stay in Runs and the audit trail.
        </p>
        {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
        <div className="panel-foot">
          <span />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn btn-danger-solid" onClick={revoke} disabled={busy}>{busy ? "Revoking…" : "Revoke key"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
