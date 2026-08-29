"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ARCHETYPES, INPUT_TYPES, inputKey, normaliseInputs, type AgentSpec, type SpecInput } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/format";
import VersionDiff, { DiffView } from "@/components/VersionDiff";
import { diffSpecs } from "@/lib/spec-diff";

type ToolInfo = { id: string; label: string; description: string; risk: "low" | "medium" | "high"; needs: string | null };
type Conn = { id: string; name: string; kind: string; config: any };

const STEPS = ["Brief", "Data", "Instructions", "Actions", "Trigger", "Review"];

const EXAMPLES = [
  "Every Monday, pull last week's support tickets from our Postgres database, group them by theme, and post the top five recurring issues to Slack with counts.",
  "Research a company I name: search the web for their recent announcements, funding and leadership changes, then write a one-page briefing as a markdown file.",
  "Read the uploaded vendor contract, compare its payment and termination terms against our standard positions, and email me a summary of anything that deviates.",
];

const riskColor = (r: string) => (r === "high" ? "var(--red)" : r === "medium" ? "var(--amber)" : "var(--muted)");

export default function Builder({
  agentId,
  initialSpec,
  status,
  publishedVer,
  tools,
  connections,
  versions,
  runs,
  timezone,
  publishedSpec,
  canPublish,
}: {
  agentId: string;
  initialSpec: AgentSpec;
  status: string;
  publishedVer: number | null;
  tools: ToolInfo[];
  connections: Conn[];
  versions: any[];
  runs: any[];
  timezone: string;
  publishedSpec: AgentSpec | null;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [spec, setSpec] = useState<AgentSpec>(initialSpec);
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<"build" | "runs" | "versions">("build");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [runInput, setRunInput] = useState("");
  const [compare, setCompare] = useState<number | null>(null);

  const set = (patch: Partial<AgentSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const toolOf = (id: string) => tools.find((t) => t.id === id);

  const save = async () => {
    setBusy("save");
    const res = await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec }),
    });
    setBusy(null);
    setMsg(res.ok ? { kind: "ok", text: "Draft saved." } : { kind: "err", text: "The draft could not be saved." });
    router.refresh();
  };

  const publish = async () => {
    setBusy("publish");
    await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec }),
    });
    const res = await fetch(`/api/agents/${agentId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "" }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return setMsg({ kind: "err", text: data.error });
    setMsg({ kind: "ok", text: `Published as version ${data.version}.` });
    router.refresh();
  };

  const run = async (useDraft: boolean, dryRun = false) => {
    setBusy("run");
    await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec }),
    });
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, input: runInput, useDraft, dryRun }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return setMsg({ kind: "err", text: data.error });
    router.push(`/runs/${data.runId}`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <Link href="/agents" className="dim" style={{ fontSize: 13 }}>
            ← Agents
          </Link>
          <h1>{spec.name || "New agent"}</h1>
          <p className="sub">{spec.purpose || "Not described yet"}</p>
          <div className="row mt-s">
            <span className={`pill ${status === "published" ? "green" : "grey"}`}>
              {status === "published" ? `v${publishedVer} published` : "Draft"}
            </span>
            {spec.domain && <span className="tag">{spec.domain}</span>}
            <span className="tag">{ARCHETYPES.find((a) => a.id === spec.archetype)?.label}</span>
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={save} disabled={busy === "save"}>
            Save draft
          </button>
          <button
            className="btn primary"
            onClick={publish}
            disabled={busy === "publish" || !canPublish}
            title={canPublish ? undefined : "Only the workspace owner and admins can publish"}
          >
            {busy === "publish" && <span className="spin" />}Publish
          </button>
        </div>
      </header>

      {msg && <div className={msg.kind === "ok" ? "ok-note" : "error"} style={{ marginBottom: 14 }}>{msg.text}</div>}

      <SpecStrip spec={spec} />

      <div className="tabs">
        {(["build", "runs", "versions"] as const).map((t) => (
          <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {t === "build" ? "Build" : t === "runs" ? `Runs (${runs.length})` : `Versions (${versions.length})`}
          </button>
        ))}
      </div>

      {tab === "build" && (
        <>
          <ol className="stepper">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button className={`step ${i === step ? "on" : ""} ${i < step ? "done" : ""}`} onClick={() => setStep(i)}>
                  <span className="n">{String(i + 1).padStart(2, "0")}</span>
                  {s}
                </button>
              </li>
            ))}
          </ol>

          <div className="panel">
            {step === 0 && <Brief spec={spec} set={set} onCompiled={() => setStep(1)} setMsg={setMsg} />}
            {step === 1 && <Data spec={spec} set={set} connections={connections} tools={tools} />}
            {step === 2 && <Instructions spec={spec} set={set} />}
            {step === 3 && <Actions spec={spec} set={set} tools={tools} connections={connections} />}
            {step === 4 && <Trigger spec={spec} set={set} />}
            {step === 5 && (
              <Review
                spec={spec}
                tools={tools}
                connections={connections}
                publishedSpec={publishedSpec}
                publishedVer={publishedVer}
                canPublish={canPublish}
                onPublish={publish}
                runInput={runInput}
                setRunInput={setRunInput}
                onRun={() => run(true)}
                onRehearse={() => run(true, true)}
                busy={busy}
              />
            )}
            <div className="panel-foot">
              <button className="btn" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
                Back
              </button>
              <button className="btn primary" onClick={() => setStep(Math.min(5, step + 1))} disabled={step === 5}>
                Continue
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>Run it now</h2>
            <p className="help">
              Runs the draft you are editing. Actions marked as needing approval will pause and wait for a person.
            </p>
            {spec.inputs.length > 0 && (
              <p className="eyebrow" style={{ marginBottom: 6 }}>
                This agent expects: {spec.inputs.map((i) => i.label).join(", ")}
              </p>
            )}
            <div className="row">
              <input
                className="input"
                style={{ flex: 1, minWidth: 240 }}
                placeholder={spec.inputs[0]?.hint || "Anything the agent needs for this run — optional"}
                value={runInput}
                onChange={(e) => setRunInput(e.target.value)}
              />
              <button className="btn primary" onClick={() => run(true)} disabled={busy === "run" || !spec.steps.length}>
                {busy === "run" && <span className="spin" />}Run draft
              </button>
              {publishedVer && (
                <button className="btn" onClick={() => run(false)} disabled={busy === "run"}>
                  Run v{publishedVer}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {tab === "runs" && (
        <div className="panel">
          <h2>Recent runs</h2>
          {runs.length === 0 ? (
            <div className="note mt">No runs yet.</div>
          ) : (
            <div className="table mt">
              {runs.map((r) => (
                <Link key={r.id} href={`/runs/${r.id}`} className="tr link" style={{ gridTemplateColumns: "1fr 1fr 2fr" }}>
                  <div className="mono dim">{formatDateTime(r.started_at, timezone)}</div>
                  <div>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="sub-line">{r.input || "No input"}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "versions" && (
        <div className="panel">
          <h2>Version history</h2>
          {versions.length === 0 ? (
            <div className="note mt">Not published yet. Publishing creates version 1.</div>
          ) : (
            <div className="table mt">
              {versions.map((v) => (
                <div key={v.version} className="tr static" style={{ gridTemplateColumns: "110px 1fr 200px" }}>
                  <div className="row">
                    <strong className="mono">v{v.version}</strong>
                    {v.version === publishedVer && <span className="pill green">Live</span>}
                  </div>
                  <div>
                    {v.note}
                    {v.version > 1 && (
                      <button
                        className="link-btn"
                        onClick={() => setCompare(compare === v.version ? null : v.version)}
                      >
                        {compare === v.version ? "hide changes" : `what changed from v${v.version - 1}`}
                      </button>
                    )}
                    {compare === v.version && (
                      <VersionDiff
                        agentId={agentId}
                        from={String(v.version - 1)}
                        to={String(v.version)}
                        title={`v${v.version - 1} → v${v.version}`}
                      />
                    )}
                  </div>
                  <div className="mono dim">
                    {v.by} · {formatDate(v.created_at, timezone)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "green",
    running: "grey",
    awaiting_approval: "amber",
    failed: "red",
    rejected: "red",
  };
  const label: Record<string, string> = {
    completed: "Completed",
    running: "Running",
    awaiting_approval: "Waiting on you",
    failed: "Failed",
    rejected: "Rejected",
  };
  return <span className={`pill ${map[status] || "grey"}`}>{label[status] || status}</span>;
}

function SpecStrip({ spec }: { spec: AgentSpec }) {
  const gated = spec.tools.filter((t) => t.gate === "approval").length;
  const cells = [
    { label: "Sources", value: spec.sources.length ? `${spec.sources.length} connected` : "None", on: spec.sources.length > 0 },
    { label: "Instructions", value: spec.steps.length ? `${spec.steps.length} steps` : "None", on: spec.steps.length > 0 },
    { label: "Actions", value: spec.tools.length ? `${spec.tools.length} granted · ${gated} gated` : "None", on: spec.tools.length > 0 },
    { label: "Guardrails", value: `${spec.guardrails.maxSteps} step budget`, on: true },
  ];
  return (
    <div className="strip">
      {cells.map((c, i) => (
        <div key={c.label} style={{ display: "contents" }}>
          <div className={`strip-cell ${c.on ? "on" : ""}`}>
            <div className="eyebrow">{c.label}</div>
            <div className="strip-val">{c.value}</div>
          </div>
          {i < cells.length - 1 && <div className={`strip-link ${c.on ? "on" : ""}`} />}
        </div>
      ))}
    </div>
  );
}

/* ── step 1 ───────────────────────────────────────────────── */

function Brief({
  spec,
  set,
  onCompiled,
  setMsg,
}: {
  spec: AgentSpec;
  set: (p: Partial<AgentSpec>) => void;
  onCompiled: () => void;
  setMsg: (m: any) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");

  const compile = async () => {
    setBusy(true);
    setMsg(null);
    const phases = ["Reading the brief", "Matching your connections", "Choosing tools and risk levels", "Assembling the specification"];
    let i = 0;
    setPhase(phases[0]);
    const tick = setInterval(() => setPhase(phases[(i = Math.min(i + 1, phases.length - 1))]), 1500);
    try {
      const res = await fetch("/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief: spec.brief }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      set({ ...data.spec, guardrails: spec.guardrails });
      onCompiled();
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message || "The brief could not be compiled." });
    } finally {
      clearInterval(tick);
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>Describe the work</h2>
      <p className="help">
        Write it the way you would explain it to a new colleague. Name the systems, the rule, and what you want at the end.
      </p>
      <textarea
        className="textarea"
        rows={6}
        placeholder="Every Monday morning…"
        value={spec.brief}
        onChange={(e) => set({ brief: e.target.value })}
      />
      <div className="eyebrow mt">Start from one of these</div>
      <div className="stack mt-s">
        {EXAMPLES.map((b, i) => (
          <button key={i} className="example" onClick={() => set({ brief: b })}>
            {b}
          </button>
        ))}
      </div>
      <div className="row mt">
        <button className="btn primary" onClick={compile} disabled={busy || !spec.brief.trim()}>
          {busy && <span className="spin" />}
          {busy ? "Drafting" : "Draft this agent"}
        </button>
        {busy && <span className="mono dim">{phase}</span>}
      </div>
    </div>
  );
}

/* ── step 2 ───────────────────────────────────────────────── */

function Data({
  spec,
  set,
  connections,
  tools,
}: {
  spec: AgentSpec;
  set: (p: Partial<AgentSpec>) => void;
  connections: Conn[];
  tools: ToolInfo[];
}) {
  const inputs = normaliseInputs(spec.inputs as any[]);
  const setInput = (idx: number, patch: Partial<SpecInput>) =>
    set({ inputs: inputs.map((i, n) => (n === idx ? { ...i, ...patch } : i)) });
  const addInput = () =>
    set({ inputs: [...inputs, { key: `input_${inputs.length + 1}`, label: "", hint: "", type: "text", required: false }] });
  const removeInput = (idx: number) => set({ inputs: inputs.filter((_, n) => n !== idx) });

  const toggle = (c: Conn) => {
    const on = spec.sources.some((s) => s.connectionId === c.id);
    set({
      sources: on ? spec.sources.filter((s) => s.connectionId !== c.id) : [...spec.sources, { connectionId: c.id, label: c.name }],
    });
  };
  const needed = new Set(spec.tools.map((t) => tools.find((x) => x.id === t.id)?.needs).filter(Boolean) as string[]);
  const missing = [...needed].filter((k) => !spec.sources.some((s) => connections.find((c) => c.id === s.connectionId)?.kind === k));

  return (
    <div>
      <h2>Grant the data it needs</h2>
      <p className="help">
        Connections are set up once under Connections and shared across agents. Credentials stay on the server — an agent
        receives access, never the secret.
      </p>
      {connections.length === 0 ? (
        <div className="note">
          No connections yet. Web search, fetching a URL and reading uploaded documents work without one — anything else needs
          a connection. <Link href="/connections">Add one</Link>.
        </div>
      ) : (
        <div className="stack">
          {connections.map((c) => {
            const on = spec.sources.some((s) => s.connectionId === c.id);
            return (
              <div key={c.id} className={`tool-row ${on ? "on" : ""}`}>
                <button className="tool-main" onClick={() => toggle(c)}>
                  <span className={`check ${on ? "on" : ""}`} />
                  <span>
                    <span className="tool-label">{c.name}</span>
                    <span className="sub-line">
                      {c.kind}
                      {c.config?.baseUrl ? ` · ${c.config.baseUrl}` : ""}
                      {c.config?.host ? ` · ${c.config.host}` : ""}
                    </span>
                  </span>
                </button>
                <span className="eyebrow">{c.kind}</span>
              </div>
            );
          })}
        </div>
      )}
      {missing.length > 0 && (
        <div className="error mt">
          The tools you granted need a {missing.join(" and ")} connection. Select one above or remove those tools.
        </div>
      )}

      {/* What the person is asked for each time it runs — the other half of "data". */}
      <div className="mt">
        <h3 style={{ fontSize: 15, margin: "18px 0 2px" }}>What to ask for at run time</h3>
        <p className="help">
          Each of these becomes a field on the run form. Use a file for anything the agent reads — a ledger, a
          statement, a contract.
        </p>

        {inputs.length === 0 && <div className="note">Nothing is asked for. This agent runs on what it already has.</div>}

        <div className="stack">
          {inputs.map((i, idx) => (
            <div className="panel input-row" key={idx}>
              <div className="grid2">
                <label className="field">
                  <span className="eyebrow">Label</span>
                  <input
                    className="input"
                    value={i.label}
                    placeholder="Payables listing"
                    onChange={(e) => setInput(idx, { label: e.target.value, key: inputKey(e.target.value, idx) })}
                  />
                </label>
                <label className="field">
                  <span className="eyebrow">Kind</span>
                  <select
                    className="input"
                    value={i.type}
                    onChange={(e) => setInput(idx, { type: e.target.value as SpecInput["type"] })}
                  >
                    {INPUT_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>{t.label} — {t.blurb}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field mt-s">
                <span className="eyebrow">Hint</span>
                <input
                  className="input"
                  value={i.hint}
                  placeholder="What good input looks like"
                  onChange={(e) => setInput(idx, { hint: e.target.value })}
                />
              </label>
              {i.type === "choice" && (
                <label className="field mt-s">
                  <span className="eyebrow">Choices, comma separated</span>
                  <input
                    className="input"
                    value={(i.options ?? []).join(", ")}
                    placeholder="Monthly, Quarterly, Annual"
                    onChange={(e) => setInput(idx, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                  />
                </label>
              )}
              <div className="row mt-s" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <label className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={i.required}
                    onChange={(e) => setInput(idx, { required: e.target.checked })}
                  />
                  <span className="sub-line">Required — the run will not start without it</span>
                </label>
                <button className="btn btn-ghost btn-danger" onClick={() => removeInput(idx)}>Remove</button>
              </div>
            </div>
          ))}
        </div>

        <button className="btn mt" onClick={addInput}>Add something to ask for</button>
      </div>

    </div>
  );
}

/* ── step 3 ───────────────────────────────────────────────── */

function Instructions({ spec, set }: { spec: AgentSpec; set: (p: Partial<AgentSpec>) => void }) {
  const edit = (i: number, v: string) => set({ steps: spec.steps.map((s, x) => (x === i ? v : s)) });
  const move = (i: number, d: number) => {
    const arr = [...spec.steps];
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set({ steps: arr });
  };
  return (
    <div>
      <h2>What it should do, in order</h2>
      <p className="help">Plain sentences. Edit anything that does not match how the work is actually done.</p>
      <ul className="stack" style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
        {spec.steps.map((s, i) => (
          <li key={i} className="instr">
            <span className="n">{String(i + 1).padStart(2, "0")}</span>
            <input className="input" value={s} onChange={(e) => edit(i, e.target.value)} />
            <button className="icon-btn" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
            <button className="icon-btn" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
            <button className="icon-btn" onClick={() => set({ steps: spec.steps.filter((_, x) => x !== i) })} aria-label="Remove">×</button>
          </li>
        ))}
      </ul>
      <button className="btn" onClick={() => set({ steps: [...spec.steps, ""] })}>
        Add a step
      </button>

      <div className="grid2 mt">
        <label className="field">
          <span className="eyebrow">Deliverable format</span>
          <input className="input" value={spec.output.format} onChange={(e) => set({ output: { ...spec.output, format: e.target.value } })} />
        </label>
        <label className="field">
          <span className="eyebrow">Name</span>
          <input className="input" value={spec.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
      </div>
      <label className="field mt">
        <span className="eyebrow">How the deliverable should read</span>
        <textarea
          className="textarea"
          rows={2}
          placeholder="Short, factual, one bullet per finding…"
          value={spec.output.instructions}
          onChange={(e) => set({ output: { ...spec.output, instructions: e.target.value } })}
        />
      </label>
    </div>
  );
}

/* ── step 4 ───────────────────────────────────────────────── */

function Actions({
  spec,
  set,
  tools,
  connections,
}: {
  spec: AgentSpec;
  set: (p: Partial<AgentSpec>) => void;
  tools: ToolInfo[];
  connections: Conn[];
}) {
  const toggle = (t: ToolInfo) => {
    const on = spec.tools.some((x) => x.id === t.id);
    set({
      tools: on ? spec.tools.filter((x) => x.id !== t.id) : [...spec.tools, { id: t.id, gate: t.risk === "low" ? "auto" : "approval" }],
    });
  };
  return (
    <div>
      <h2>What it is allowed to do</h2>
      <p className="help">
        Reading and drafting run on their own. Anything that leaves your systems or changes something stops for a person, and
        that cannot be turned off.
      </p>
      <div className="stack">
        {tools.map((t) => {
          const sel = spec.tools.find((x) => x.id === t.id);
          const hasConn = !t.needs || connections.some((c) => c.kind === t.needs);
          return (
            <div key={t.id} className={`tool-row ${sel ? "on" : ""}`}>
              <button className="tool-main" onClick={() => toggle(t)}>
                <span className={`check ${sel ? "on" : ""}`} />
                <span>
                  <span className="tool-label">{t.label}</span>
                  <span className="sub-line">
                    {t.description}
                    {t.needs && !hasConn ? ` — needs a ${t.needs} connection` : ""}
                  </span>
                </span>
              </button>
              <div className="row" style={{ flex: "0 0 auto" }}>
                <span className="eyebrow" style={{ color: riskColor(t.risk) }}>
                  {t.risk} risk
                </span>
                {sel && (
                  <select
                    className="select-sm"
                    value={sel.gate}
                    disabled={t.risk !== "low"}
                    onChange={(e) => set({ tools: spec.tools.map((x) => (x.id === t.id ? { ...x, gate: e.target.value as any } : x)) })}
                  >
                    <option value="auto">Runs automatically</option>
                    <option value="approval">Needs approval</option>
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── step 5 ───────────────────────────────────────────────── */

function Trigger({ spec, set }: { spec: AgentSpec; set: (p: Partial<AgentSpec>) => void }) {
  return (
    <div>
      <h2>When it runs and how far it can go</h2>
      <div className="radios">
        {[
          { id: "manual", label: "When I ask", note: "Run it on demand from this screen" },
          { id: "schedule", label: "On a schedule", note: "Daily, weekly, or a fixed day" },
          { id: "event", label: "When a condition is met", note: "Watches and fires on the condition" },
        ].map((o) => (
          <button
            key={o.id}
            className={`radio ${spec.trigger.type === o.id ? "on" : ""}`}
            onClick={() => set({ trigger: { ...spec.trigger, type: o.id as any } })}
          >
            <div className="tool-label">{o.label}</div>
            <div className="sub-line">{o.note}</div>
          </button>
        ))}
      </div>

      {spec.trigger.type === "schedule" && (
        <label className="field mt">
          <span className="eyebrow">Schedule</span>
          <input
            className="input"
            placeholder="Every Monday at 08:00"
            value={spec.trigger.schedule || ""}
            onChange={(e) => set({ trigger: { ...spec.trigger, schedule: e.target.value } })}
          />
        </label>
      )}
      {spec.trigger.type === "schedule" && (
        <label className="field mt">
          <span className="eyebrow">Standing input</span>
          <textarea
            className="textarea"
            rows={3}
            placeholder="What the agent should be told each time it runs on its own"
            value={spec.trigger.input || ""}
            onChange={(e) => set({ trigger: { ...spec.trigger, input: e.target.value } })}
          />
          <span className="help" style={{ marginTop: 6 }}>
            {spec.inputs.length
              ? `This agent asks for ${spec.inputs.length} input${spec.inputs.length === 1 ? "" : "s"} (${spec.inputs
                  .map((i) => i.label)
                  .join(", ")}). Nobody is at the keyboard on a schedule, so supply them here or the run will stop and ask.`
              : "Optional. Nobody is at the keyboard on a schedule, so anything the agent needs to be told goes here."}
          </span>
        </label>
      )}

      {spec.trigger.type === "event" && (
        <label className="field mt">
          <span className="eyebrow">Condition</span>
          <input
            className="input"
            placeholder="Open tickets older than 7 days exceed 20"
            value={spec.trigger.condition || ""}
            onChange={(e) => set({ trigger: { ...spec.trigger, condition: e.target.value } })}
          />
        </label>
      )}

      <div className="grid2 mt">
        <label className="field">
          <span className="eyebrow">Tool call budget per run</span>
          <input
            className="input mono"
            type="number"
            min={2}
            max={40}
            value={spec.guardrails.maxSteps}
            onChange={(e) => set({ guardrails: { ...spec.guardrails, maxSteps: Number(e.target.value) } })}
          />
        </label>
        <label className="field">
          <span className="eyebrow">Anything it must never do</span>
          <input
            className="input"
            placeholder="Never contact a customer directly"
            value={spec.guardrails.extra}
            onChange={(e) => set({ guardrails: { ...spec.guardrails, extra: e.target.value } })}
          />
        </label>
      </div>

      <div className="stack mt">
        {[
          ["requireCitations", "Cite the source of every figure or claim"],
          ["stayInScope", "Refuse work outside the instructions above"],
          ["escalateOnAmbiguity", "Say what is missing rather than guessing"],
        ].map(([k, label]) => (
          <label key={k} className="row" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={(spec.guardrails as any)[k]}
              onChange={(e) => set({ guardrails: { ...spec.guardrails, [k]: e.target.checked } })}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/* ── step 6 ───────────────────────────────────────────────── */

function Review({
  spec,
  tools,
  connections,
  publishedSpec,
  publishedVer,
  canPublish,
  onPublish,
  runInput,
  setRunInput,
  onRun,
  onRehearse,
  busy,
}: {
  spec: AgentSpec;
  tools: ToolInfo[];
  connections: Conn[];
  publishedSpec: AgentSpec | null;
  publishedVer: number | null;
  canPublish: boolean;
  onPublish: () => void;
  runInput: string;
  setRunInput: (v: string) => void;
  onRun: () => void;
  onRehearse: () => void;
  busy: string | null;
}) {
  const checks = [
    { ok: !!spec.name.trim(), label: "The agent has a name" },
    { ok: spec.steps.length > 0 && spec.steps.every((s) => s.trim()), label: "Every instruction step is filled in" },
    { ok: spec.tools.length > 0, label: "At least one tool is granted" },
    {
      ok: spec.tools.every((t) => (tools.find((x) => x.id === t.id)?.risk === "low" ? true : t.gate === "approval")),
      label: "Every medium and high risk action is gated",
    },
    {
      ok: spec.tools.every((t) => {
        const needs = tools.find((x) => x.id === t.id)?.needs;
        return !needs || spec.sources.some((s) => connections.find((c) => c.id === s.connectionId)?.kind === needs);
      }),
      label: "Every tool has the connection it needs",
    },
    { ok: spec.trigger.type !== "schedule" || !!spec.trigger.schedule, label: "The schedule is set" },
  ];
  const failing = checks.filter((c) => !c.ok).length;

  // Diffed against the spec in the editor, so unsaved edits are included —
  // publishing saves the draft first, so this is exactly what would go live.
  const diff = publishedSpec
    ? {
        ...diffSpecs(publishedSpec, spec, (id) => tools.find((t) => t.id === id)?.risk ?? "low"),
        from: `v${publishedVer}`,
        to: "this draft",
      }
    : null;

  const rows: [string, string][] = [
    ["Purpose", spec.purpose],
    ["Sources", spec.sources.map((s) => connections.find((c) => c.id === s.connectionId)?.name || s.connectionId).join(" · ") || "None"],
    ["Instructions", spec.steps.map((s, i) => `${i + 1}. ${s}`).join("   ")],
    [
      "Actions",
      spec.tools.map((t) => `${tools.find((x) => x.id === t.id)?.label}${t.gate === "approval" ? " (needs approval)" : ""}`).join(" · ") || "None",
    ],
    [
      "Trigger",
      spec.trigger.type === "schedule" ? spec.trigger.schedule || "—" : spec.trigger.type === "event" ? spec.trigger.condition || "—" : "On demand",
    ],
    ["Deliverable", spec.output.format],
  ];

  return (
    <div>
      <h2>Review and publish</h2>
      {diff && <DiffView diff={diff} title={`What changes from v${publishedVer} to this draft`} />}
      <div className="table" style={{ marginTop: 12 }}>
        {rows.map(([label, value]) => (
          <div key={label} className="sum-row">
            <div className="eyebrow">{label}</div>
            <div>{value || "—"}</div>
          </div>
        ))}
      </div>

      <div className="eyebrow mt">Checks</div>
      <ul className="checks">
        {checks.map((c) => (
          <li key={c.label} className={c.ok ? "pass" : "fail"}>
            <span className="mono">{c.ok ? "PASS" : "FAIL"}</span>
            {c.label}
          </li>
        ))}
      </ul>

      <div className="row mt">
        <input
          className="input"
          style={{ flex: 1, minWidth: 220 }}
          placeholder="Optional input for a test run"
          value={runInput}
          onChange={(e) => setRunInput(e.target.value)}
        />
        <button className="btn" onClick={onRehearse} disabled={busy === "run"} title="Runs it, but describes consequential actions instead of carrying them out">
          {busy === "run" && <span className="spin" />}Rehearse
        </button>
        <button className="btn" onClick={onRun} disabled={busy === "run"}>
          Test for real
        </button>
        <button
          className="btn primary"
          onClick={onPublish}
          disabled={failing > 0 || busy === "publish" || !canPublish}
        >
          Publish
        </button>
        {!canPublish && (
          <span className="dim">
            Only the workspace owner and admins can publish. Everything else here is yours to change — save the
            draft and ask one of them to review it.
          </span>
        )}
        {failing > 0 && <span className="dim">{failing} check{failing > 1 ? "s" : ""} still failing.</span>}
        <span className="dim">
          A rehearsal runs the agent but describes gated actions rather than carrying them out.
        </span>
      </div>
    </div>
  );
}
