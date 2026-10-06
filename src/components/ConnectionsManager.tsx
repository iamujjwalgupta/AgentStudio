"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { KindIcon } from "@/components/ConnectorIcons";
import { AlertIcon, CheckIcon, ClockIcon, CrossIcon, GridIcon, ListIcon, PencilIcon, SearchIcon, TrashIcon } from "@/components/agent-ui";
import {
  CONNECTION_GROUPS, CONNECTION_TYPES, SINGLE_KINDS, missingFor, typeOf, type ConnectionType,
} from "@/lib/connection-types";

type Conn = {
  id: string;
  name: string;
  kind: string;
  config: Record<string, any>;
  created_at: string;
  created_by_name: string | null;
  has_secret: boolean;
  used_by: { id: string; name: string; status: string }[];
};
type LastTest = { ok: boolean; detail: string; at: string; by?: string };
type Activity = { action: string; actor_name: string; detail: any; at: string };

/** Where a connection points, in a few words, from what it stores. */
function whereOf(c: Conn): string {
  const k = c.config || {};
  return k.baseUrl || k.host || (k.bucket ? `${k.bucket}${k.region ? ` · ${k.region}` : ""}` : "") || k.channel || k.repo || k.email || k.model || "";
}

/** Why a connection will not work as it stands, or "". */
function problemOf(c: Conn): string {
  if (!typeOf(c.kind)) return "No agent action can use this kind of connection.";
  // Made with the old one-click sign-in, which only ever stored a stand-in token.
  if (c.config?.authMode === "oauth" || c.config?.oauth) return `Set up with a sign-in that stored no real credential. Paste the ${typeOf(c.kind)!.secret.label.toLowerCase()}.`;
  return missingFor(c.kind, c.config || {}, c.has_secret);
}

function ago(iso?: string): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

type Health = "ready" | "attention" | "failing";
function healthOf(c: Conn): Health {
  if (problemOf(c)) return "attention";
  const t = c.config?.lastTest as LastTest | undefined;
  return t && !t.ok ? "failing" : "ready";
}
const HEALTH_LABEL: Record<Health, string> = { ready: "Ready", attention: "Needs attention", failing: "Last test failed" };

export default function ConnectionsManager({ powers }: { powers: Record<string, string[]> }) {
  const router = useRouter();
  const params = useSearchParams();
  const [conns, setConns] = useState<Conn[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | Health | "unused">("all");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [selected, setSelected] = useState<string | null>(null);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [form, setForm] = useState<{ type: ConnectionType; conn: Conn | null } | null>(null);
  const [removing, setRemoving] = useState<Conn | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/connections", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Connections could not be loaded.");
      setConns(j.connections ?? []);
    } catch (e: any) {
      setError(e.message);
      setConns([]);
    }
  }, []);
  useEffect(() => {
    load();
    try {
      const v = localStorage.getItem("agent-studio.connections.view");
      if (v === "cards" || v === "table") setView(v);
    } catch {
      /* the default stands */
    }
  }, [load]);
  const chooseView = (v: "cards" | "table") => {
    setView(v);
    try {
      localStorage.setItem("agent-studio.connections.view", v);
    } catch {
      /* fine for this visit */
    }
  };

  // /connections?add=jira, from the agent builder's "Add a Jira connection". Opened once.
  const addHandled = useRef(false);
  useEffect(() => {
    const kind = params.get("add");
    const t = kind ? typeOf(kind) : undefined;
    if (t && conns && !addHandled.current) {
      addHandled.current = true;
      const existing = SINGLE_KINDS.has(t.kind) ? conns.find((c) => c.kind === t.kind) ?? null : null;
      setForm({ type: t, conn: existing });
      router.replace("/connections");
    }
  }, [params, conns, router]);

  async function test(c: Conn) {
    setTesting((t) => ({ ...t, [c.id]: true }));
    try {
      await fetch(`/api/connections/${c.id}`, { method: "POST" });
    } finally {
      setTesting((t) => ({ ...t, [c.id]: false }));
      await load();
    }
  }

  const list = conns ?? [];
  const stats = useMemo(() => {
    const agents = new Set(list.flatMap((c) => c.used_by.map((a) => a.id)));
    const weekAgo = Date.now() - 7 * 864e5;
    return {
      total: list.length,
      ready: list.filter((c) => healthOf(c) === "ready").length,
      attention: list.filter((c) => healthOf(c) !== "ready").length,
      agents: agents.size,
      tested: list.filter((c) => c.config?.lastTest?.at && new Date(c.config.lastTest.at).getTime() > weekAgo).length,
    };
  }, [list]);

  const q = query.trim().toLowerCase();
  const shown = list.filter((c) => {
    if (status === "unused" && (c.used_by.length || typeOf(c.kind)?.group === "model")) return false;
    if (status !== "all" && status !== "unused" && healthOf(c) !== status && !(status === "attention" && healthOf(c) === "failing")) return false;
    if (q && ![c.name, typeOf(c.kind)?.label ?? c.kind, whereOf(c)].some((s) => s.toLowerCase().includes(q))) return false;
    return true;
  });
  const groups = CONNECTION_GROUPS.map((g) => ({ ...g, conns: shown.filter((c) => typeOf(c.kind)?.group === g.id) })).filter((g) => g.conns.length);
  const stray = shown.filter((c) => !typeOf(c.kind));
  const hasModelKey = list.some((c) => c.kind === "anthropic");
  const current = list.find((c) => c.id === selected) ?? null;

  const card = (c: Conn) => {
    const t = typeOf(c.kind);
    const h = healthOf(c);
    const lt = c.config?.lastTest as LastTest | undefined;
    return (
      <button key={c.id} type="button" className={`cx-card ${h}`} onClick={() => setSelected(c.id)}>
        <div className="cx-card-top">
          <span className="cx-ic"><KindIcon kind={c.kind} size={24} /></span>
          <span className="cx-name">
            <b>{c.name}</b>
            <span>{t?.label ?? c.kind}</span>
          </span>
          <span className={`cx-status ${h}`}>{HEALTH_LABEL[h]}</span>
        </div>
        {whereOf(c) && <div className="cx-where mono">{whereOf(c)}</div>}
        {h === "attention" && <div className="cx-problem"><AlertIcon size={12} /> {problemOf(c)}</div>}
        <div className="cx-card-foot">
          <span>{t?.group === "model" ? "Workspace model key" : c.used_by.length ? `${c.used_by.length} ${c.used_by.length === 1 ? "agent" : "agents"}` : "No agents yet"}</span>
          <span className={lt ? (lt.ok ? "ok" : "bad") : ""}>
            {testing[c.id] ? "Testing…" : lt ? <><ClockIcon size={11} /> {lt.ok ? "Worked" : "Failed"} {ago(lt.at)}</> : "Never tested"}
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="page cx">
      <header className="page-head">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Connections</h1>
          <p className="sub" style={{ maxWidth: "none" }}>
            The systems agents reach through their actions, and the model keys that run them. Credentials are encrypted and never shown to agents.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCatalogOpen(true)}>+ Add connection</button>
      </header>

      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}
      {conns && !hasModelKey && (
        <div className="cx-alert">
          <AlertIcon />
          <span className="grow">No Anthropic key yet: agents cannot run until one is added.</span>
          <button className="btn btn-primary" onClick={() => setForm({ type: typeOf("anthropic")!, conn: null })}>Add the key</button>
        </div>
      )}

      <div className="cx-stats">
        <button type="button" className={`cx-stat ${status === "all" ? "on" : ""}`} onClick={() => setStatus("all")}>
          <span className="v">{stats.total}</span><span className="l">Connections</span>
        </button>
        <button type="button" className={`cx-stat ok ${status === "ready" ? "on" : ""}`} onClick={() => setStatus(status === "ready" ? "all" : "ready")}>
          <span className="v">{stats.ready}</span><span className="l">Ready</span>
        </button>
        <button type="button" className={`cx-stat warn ${status === "attention" ? "on" : ""}`} onClick={() => setStatus(status === "attention" ? "all" : "attention")}>
          <span className="v">{stats.attention}</span><span className="l">Need attention</span>
        </button>
        <div className="cx-stat static">
          <span className="v">{stats.agents}</span><span className="l">Agents relying on them</span>
        </div>
        <div className="cx-stat static">
          <span className="v">{stats.tested}<small>/{stats.total}</small></span><span className="l">Tested in the last 7 days</span>
        </div>
      </div>

      <div className="cx-toolbar">
        <label className="cx-search">
          <SearchIcon size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, type or address" />
        </label>
        <div className="cx-chips">
          {(["all", "ready", "attention", "unused"] as const).map((s) => (
            <button key={s} type="button" className={`chip ${status === s ? "on" : ""}`} onClick={() => setStatus(s)}>
              {s === "all" ? "All" : s === "ready" ? "Ready" : s === "attention" ? "Needs attention" : "Unused"}
            </button>
          ))}
        </div>
        <div className="seg cx-view" role="group" aria-label="Layout">
          <button className={`seg-opt ${view === "cards" ? "on" : ""}`} onClick={() => chooseView("cards")} aria-label="Cards" title="Cards"><GridIcon size={15} /></button>
          <button className={`seg-opt ${view === "table" ? "on" : ""}`} onClick={() => chooseView("table")} aria-label="Table" title="Table"><ListIcon size={15} /></button>
        </div>
      </div>

      {conns == null ? (
        <div className="note">Loading connections…</div>
      ) : list.length === 0 ? (
        <div className="cx-empty">
          <b>No connections yet</b>
          <span>Add the Anthropic key first, then the systems your agents need.</span>
          <button className="btn btn-primary" onClick={() => setCatalogOpen(true)}>+ Add connection</button>
        </div>
      ) : shown.length === 0 ? (
        <div className="note">No connections match. <button className="link-btn" onClick={() => { setQuery(""); setStatus("all"); }}>Clear filters</button></div>
      ) : view === "table" ? (
        <div className="cx-table">
          <div className="cx-tr head">
            <span>Connection</span>
            <span>Address</span>
            <span>Status</span>
            <span>Agents</span>
            <span>Last tested</span>
            <span>Added</span>
          </div>
          {shown.map((c) => {
            const h = healthOf(c);
            const lt = c.config?.lastTest as LastTest | undefined;
            return (
              <button key={c.id} type="button" className="cx-tr" onClick={() => setSelected(c.id)}>
                <span className="cx-tname">
                  <span className="cx-ic sm"><KindIcon kind={c.kind} size={18} /></span>
                  <span><b>{c.name}</b><span>{typeOf(c.kind)?.label ?? c.kind}</span></span>
                </span>
                <span className="mono dim cx-trunc">{whereOf(c) || "—"}</span>
                <span><span className={`cx-status ${h}`}>{HEALTH_LABEL[h]}</span></span>
                <span>{typeOf(c.kind)?.group === "model" ? "—" : c.used_by.length}</span>
                <span className={lt ? (lt.ok ? "cx-ok" : "cx-bad") : "dim"}>{lt ? `${lt.ok ? "Worked" : "Failed"} ${ago(lt.at)}` : "Never"}</span>
                <span className="dim">{c.created_by_name ? `${c.created_by_name} · ` : ""}{ago(c.created_at)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.id} className="cx-group">
              <div className="cx-group-head"><b>{g.title}</b><span>{g.note}</span><em>{g.conns.length}</em></div>
              <div className="cx-cards">{g.conns.map(card)}</div>
            </section>
          ))}
          {stray.length > 0 && (
            <section className="cx-group">
              <div className="cx-group-head"><b>Not usable by agents</b><span>No action can use these; remove them</span></div>
              <div className="cx-cards">{stray.map(card)}</div>
            </section>
          )}
        </>
      )}

      {current && (
        <ConnectionDrawer
          conn={current}
          powers={powers[current.kind] ?? []}
          testing={!!testing[current.id]}
          onClose={() => setSelected(null)}
          onTest={() => test(current)}
          onEdit={() => {
            const t = typeOf(current.kind);
            if (t) setForm({ type: t, conn: current });
          }}
          onRemove={() => setRemoving(current)}
        />
      )}

      {catalogOpen && (
        <CatalogDialog
          conns={list}
          powers={powers}
          onClose={() => setCatalogOpen(false)}
          onPick={(t, existing) => {
            setCatalogOpen(false);
            setForm({ type: t, conn: existing });
          }}
        />
      )}

      {form && (
        <ConnectionForm
          type={form.type}
          conn={form.conn}
          onClose={() => setForm(null)}
          onSaved={async (saved, andTest) => {
            setForm(null);
            await load();
            if (saved) setSelected(saved.id);
            if (andTest && saved) test(saved as Conn);
          }}
        />
      )}

      {removing && (
        <RemoveDialog
          conn={removing}
          onClose={() => setRemoving(null)}
          onRemoved={async () => {
            setRemoving(null);
            setSelected(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

/** Everything about one connection: settings, health, the agents on it, and its history. */
function ConnectionDrawer({
  conn,
  powers,
  testing,
  onClose,
  onTest,
  onEdit,
  onRemove,
}: {
  conn: Conn;
  powers: string[];
  testing: boolean;
  onClose: () => void;
  onTest: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = typeOf(conn.kind);
  const h = healthOf(conn);
  const lt = conn.config?.lastTest as LastTest | undefined;
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [agentQuery, setAgentQuery] = useState("");

  useEffect(() => {
    let live = true;
    setActivity(null);
    fetch(`/api/connections/${conn.id}`)
      .then((r) => r.json())
      .then((j) => live && setActivity(j.activity ?? []))
      .catch(() => live && setActivity([]));
    return () => {
      live = false;
    };
    // Refetched after a test, which is recorded in the history.
  }, [conn.id, lt?.at]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const settings = (t?.fields ?? [])
    .map((f) => ({ label: f.label, value: f.kind === "checkbox" ? (conn.config?.[f.key] ? "Yes" : "No") : String(conn.config?.[f.key] ?? "") }))
    .filter((s) => s.value);
  const aq = agentQuery.trim().toLowerCase();
  const agents = conn.used_by.filter((a) => !aq || a.name.toLowerCase().includes(aq));

  return (
    <div className="cx-drawer-back" onMouseDown={onClose}>
      <aside className="cx-drawer" role="dialog" aria-modal="true" aria-labelledby="cx-drawer-title" onMouseDown={(e) => e.stopPropagation()}>
        <header className="cx-drawer-head">
          <span className="cx-ic"><KindIcon kind={conn.kind} size={26} /></span>
          <div className="grow">
            <h2 id="cx-drawer-title">{conn.name}</h2>
            <span>{t?.label ?? conn.kind}</span>
          </div>
          <button type="button" className="cx-x" onClick={onClose} aria-label="Close"><CrossIcon size={14} /></button>
        </header>

        <div className="cx-drawer-body">
          <div className={`cx-health ${h}`}>
            <span className="cx-health-ic">{h === "ready" ? <CheckIcon size={16} /> : <AlertIcon size={16} />}</span>
            <div className="grow">
              <b>{HEALTH_LABEL[h]}</b>
              <span>
                {h === "attention"
                  ? problemOf(conn)
                  : lt
                    ? `${lt.ok ? "Worked" : "Failed"} ${ago(lt.at)}${lt.by ? ` · tested by ${lt.by}` : ""}${lt.detail ? ` · ${lt.detail}` : ""}`
                    : "Not tested yet."}
              </span>
            </div>
            {t?.test && (
              <button type="button" className="btn btn-sm" onClick={onTest} disabled={testing || h === "attention"}>
                {testing ? "Testing…" : t.test}
              </button>
            )}
          </div>

          <section className="cx-dsec">
            <h3>Settings</h3>
            <dl className="cx-kv">
              {settings.map((s) => (
                <div key={s.label}><dt>{s.label}</dt><dd className="mono">{s.value}</dd></div>
              ))}
              {t && (
                <div>
                  <dt>{t.secret.label}</dt>
                  <dd>{conn.has_secret ? <span className="cx-ok">Stored, encrypted</span> : <span className={t.secret.optional ? "dim" : "cx-bad"}>{t.secret.optional ? "None" : "Missing"}</span>}</dd>
                </div>
              )}
              <div><dt>Added</dt><dd>{conn.created_by_name ? `${conn.created_by_name}, ` : ""}{new Date(conn.created_at).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</dd></div>
            </dl>
            {powers.length > 0 && <p className="sub-line" style={{ margin: "10px 0 0" }}>Powers: {powers.join(" · ")}</p>}
          </section>

          {t?.group !== "model" && (
            <section className="cx-dsec">
              <h3>Used by {conn.used_by.length} {conn.used_by.length === 1 ? "agent" : "agents"}</h3>
              {conn.used_by.length === 0 ? (
                <p className="sub-line" style={{ margin: 0 }}>No agent has it attached yet. Agents get it in the Data &amp; inputs step.</p>
              ) : (
                <>
                  {conn.used_by.length > 8 && (
                    <input className="input cx-agent-search" value={agentQuery} onChange={(e) => setAgentQuery(e.target.value)} placeholder={`Search ${conn.used_by.length} agents`} />
                  )}
                  <ul className="cx-agents">
                    {agents.slice(0, 100).map((a) => (
                      <li key={a.id}>
                        <Link href={`/agents/${a.id}`}>{a.name}</Link>
                        <span className={`cx-agent-st ${a.status}`}>{a.status === "published" ? "Live" : a.status === "retired" ? "Retired" : "Draft"}</span>
                      </li>
                    ))}
                    {agents.length > 100 && <li className="dim">and {agents.length - 100} more</li>}
                  </ul>
                </>
              )}
            </section>
          )}

          <section className="cx-dsec">
            <h3>Activity</h3>
            {activity == null ? (
              <p className="sub-line" style={{ margin: 0 }}>Loading…</p>
            ) : activity.length === 0 ? (
              <p className="sub-line" style={{ margin: 0 }}>Nothing recorded yet.</p>
            ) : (
              <ol className="cx-activity">
                {activity.map((a, i) => (
                  <li key={i} className={a.action.includes("failed") ? "bad" : a.action.includes("working") ? "ok" : ""}>
                    <b>{a.action.replace(/ connection:? ?/, " ").replace(/^Tested working$/, "Tested · worked").replace(/^Tested failed$/, "Tested · failed")}</b>
                    <span>{a.actor_name} · {ago(a.at)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <footer className="cx-drawer-foot">
          <button type="button" className="btn btn-danger" onClick={onRemove}><TrashIcon size={13} /> Remove</button>
          {t && <button type="button" className="btn btn-primary" onClick={onEdit}><PencilIcon size={13} /> Edit settings</button>}
        </footer>
      </aside>
    </div>
  );
}

/** Choosing what to add: only the kinds agents can use, grouped, with what each powers. */
function CatalogDialog({
  conns,
  powers,
  onClose,
  onPick,
}: {
  conns: Conn[];
  powers: Record<string, string[]>;
  onClose: () => void;
  onPick: (t: ConnectionType, existing: Conn | null) => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="panel modal cx-catalog" role="dialog" aria-modal="true" aria-labelledby="cx-cat-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cx-catalog-head">
          <div>
            <div className="eyebrow">Add connection</div>
            <h2 id="cx-cat-title">What should agents connect to?</h2>
            <p className="help" style={{ margin: 0 }}>Only the kinds an agent action can use are offered.</p>
          </div>
          <button type="button" className="cx-x" onClick={onClose} aria-label="Close"><CrossIcon size={14} /></button>
        </div>
        {CONNECTION_GROUPS.map((g) => (
          <div key={g.id} className="cx-group">
            <div className="cx-group-head"><b>{g.title}</b><span>{g.note}</span></div>
            <div className="cx-types">
              {CONNECTION_TYPES.filter((t) => t.group === g.id).map((t) => {
                const existing = SINGLE_KINDS.has(t.kind) ? conns.find((c) => c.kind === t.kind) ?? null : null;
                const count = conns.filter((c) => c.kind === t.kind).length;
                return (
                  <button key={t.kind} type="button" className="cx-type" onClick={() => onPick(t, existing)}>
                    <span className="cx-ic"><KindIcon kind={t.kind} size={24} /></span>
                    <span className="cx-type-body">
                      <b>{t.label}{count > 0 && <em>{count} added</em>}</b>
                      <span>{t.description}</span>
                      {(powers[t.kind] ?? []).length > 0 && <span className="cx-powers">Powers: {(powers[t.kind] ?? []).join(" · ")}</span>}
                    </span>
                    <span className="cx-type-cta">{existing ? "Edit" : "+ Add"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConnectionForm({
  type,
  conn,
  onClose,
  onSaved,
}: {
  type: ConnectionType;
  conn: Conn | null;
  onClose: () => void;
  onSaved: (c: { id: string } | null, andTest: boolean) => void;
}) {
  const [name, setName] = useState(conn?.name ?? type.label);
  const [config, setConfig] = useState<Record<string, any>>(() => {
    const c: Record<string, any> = {};
    for (const f of type.fields) c[f.key] = conn?.config?.[f.key] ?? (f.kind === "checkbox" ? false : "");
    return c;
  });
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [busy, onClose]);

  async function save(andTest: boolean) {
    setBusy(true);
    setErr("");
    try {
      const cleaned: Record<string, any> = {};
      for (const f of type.fields) {
        const v = config[f.key];
        if (f.kind === "checkbox") cleaned[f.key] = !!v;
        else if (String(v ?? "").trim()) cleaned[f.key] = f.kind === "number" ? Number(v) : String(v).trim();
      }
      const res = await fetch(conn ? `/api/connections/${conn.id}` : "/api/connections", {
        method: conn ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind: type.kind, config: cleaned, secret }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The connection could not be saved.");
      onSaved(j.connection ?? null, andTest);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onMouseDown={() => !busy && onClose()}>
      <div className="panel modal cx-modal" role="dialog" aria-modal="true" aria-labelledby="cx-form-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cx-modal-head">
          <span className="cx-ic"><KindIcon kind={type.kind} size={26} /></span>
          <div>
            <div className="eyebrow">{conn ? "Edit connection" : "New connection"}</div>
            <h2 id="cx-form-title">{type.label}</h2>
          </div>
        </div>
        <p className="help" style={{ marginTop: 0 }}>{type.description}</p>
        <div className="stack-sm">
          <label className="field">
            <span className="cx-label">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="How it is listed, e.g. SAP ERP ledger" />
          </label>
          {type.fields.map((f) =>
            f.kind === "checkbox" ? (
              <label key={f.key} className="cx-check">
                <input type="checkbox" checked={!!config[f.key]} onChange={(e) => setConfig({ ...config, [f.key]: e.target.checked })} />
                <span>
                  {f.label}
                  {f.hint && <small className="cx-check-hint">{f.hint}</small>}
                </span>
              </label>
            ) : (
              <label key={f.key} className="field">
                <span className="cx-label">{f.label}{f.optional && <em> — optional</em>}</span>
                <input
                  className="input"
                  type={f.kind === "number" ? "number" : "text"}
                  value={config[f.key] ?? ""}
                  placeholder={f.hint}
                  onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                />
              </label>
            ),
          )}
          <label className="field">
            <span className="cx-label">{type.secret.label}{type.secret.optional && <em> — optional</em>}</span>
            <input
              className="input mono"
              type="password"
              autoComplete="new-password"
              value={secret}
              placeholder={conn?.has_secret ? "Stored. Leave empty to keep it." : type.secret.hint}
              onChange={(e) => setSecret(e.target.value)}
            />
            <span className="sub-line" style={{ marginTop: 4, display: "block" }}>Stored encrypted. Nobody, including agents, can read it back.</span>
          </label>
        </div>
        {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
        <div className="panel-foot">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <div style={{ display: "flex", gap: 8 }}>
            {type.test && (
              <button className="btn" onClick={() => save(true)} disabled={busy}>
                Save and {type.test.toLowerCase()}
              </button>
            )}
            <button className="btn btn-primary" onClick={() => save(false)} disabled={busy}>
              {busy && <span className="spin" />} {conn ? "Save changes" : "Add connection"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RemoveDialog({ conn, onClose, onRemoved }: { conn: Conn; onClose: () => void; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const n = conn.used_by?.length ?? 0;
  async function remove() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/connections/${conn.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "It could not be removed.");
      onRemoved();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="modal-back" onMouseDown={() => !busy && onClose()}>
      <div className="panel modal" role="dialog" aria-modal="true" aria-labelledby="cx-rm-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="eyebrow">Remove connection</div>
        <h2 id="cx-rm-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>Remove “{conn.name}”?</h2>
        <p className="help" style={{ marginTop: 0 }}>
          {n
            ? <><strong>{n} {n === 1 ? "agent uses" : "agents use"} it.</strong> Their actions that need it will fail until they are given another connection. This cannot be undone.</>
            : "No agent uses it. This cannot be undone."}
        </p>
        {err && <div className="error">{err}</div>}
        <div className="panel-foot">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-danger-solid" onClick={remove} disabled={busy}>{busy ? "Removing…" : "Remove"}</button>
        </div>
      </div>
    </div>
  );
}
