"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertIcon, ArrowLeftIcon, ArrowRightIcon, CheckIcon, CrossIcon, SparkIcon, UploadIcon, WrenchIcon } from "@/components/agent-ui";

/* ---- shapes returned by /api/sandbox ------------------------------------------------ */
type Framework = "adk" | "langchain" | "openai" | "foundry";
type ImportedTool = { name: string; description: string; parameters: Record<string, any> };
type ImportedAgent = {
  framework: Framework;
  frameworkLabel: string;
  language: string;
  name: string;
  model: string;
  instruction: string;
  steps: string[];
  tools: ImportedTool[];
  related: { kind: string; names: string[] } | null;
  spec: any;
};
type Suggestion = { id: string | null; match: "same" | "likely" | "none" };
type CatalogTool = { id: string; label: string; description: string; risk: string; needs: string | null };
type Example = { id: string; title: string; blurb: string; language: string; code: string; framework: Framework; frameworkLabel: string; prompts: string[] };
type EngineInfo = { id: "anthropic" | "gemini"; label: string; model: string };
type ToolCall = { id: string; name: string; args: any };
type Turn =
  | { role: "user"; text: string }
  | { role: "agent"; text?: string; calls?: ToolCall[]; engine?: string; raw?: any }
  | { role: "tools"; results: { id: string; name: string; output: any }[] };
type Pending = { call: ToolCall; draft: string; sample: any };
type Source = "sample" | "custom" | "error";

const FW: Record<Framework, { label: string; short: string; colour: string }> = {
  adk: { label: "Google ADK", short: "Google ADK", colour: "#1e49e2" },
  langchain: { label: "LangChain / LangGraph", short: "LangChain", colour: "#007a78" },
  openai: { label: "OpenAI Agents / Swarm", short: "OpenAI", colour: "#0a1b3d" },
  foundry: { label: "Palantir Foundry AIP", short: "Foundry", colour: "#6d2077" },
};
const ARCHETYPES: { id: string; label: string; hint: string }[] = [
  { id: "analyst", label: "Analyst", hint: "Reads and reports" },
  { id: "author", label: "Author", hint: "Writes documents" },
  { id: "operator", label: "Operator", hint: "Takes actions" },
  { id: "sentinel", label: "Sentinel", hint: "Watches and alerts" },
];
const NEEDS_LABEL: Record<string, string> = {
  postgres: "PostgreSQL", http: "REST API", smtp: "Email (SMTP)", slack: "Slack", msteams: "Microsoft Teams", s3: "Amazon S3",
  jira: "Jira", github: "GitHub", redis: "Redis",
};
const MAX_ROUNDS = 10;

/** The same framework check the server makes, for the live hint while typing. */
function detect(code: string): Framework | null {
  if (!code.trim()) return null;
  if (/google\.adk|@google\/adk|google_adk/i.test(code)) return "adk";
  if (/langgraph|langchain|create_react_agent|StateGraph|AgentExecutor/i.test(code)) return "langchain";
  if (/\bfrom\s+swarm\b|import\s+swarm|\bSwarm\s*\(|openai[-_. ]agents|from\s+agents\s+import|transfer_to_|handoffs?\s*[=:]|^\s*import\s+openai\b|^\s*from\s+openai\s+import|\bOpenAI\s*\(|beta\.assistants/im.test(code)) return "openai";
  if (/foundry|palantir|@osdk|ActionType|AipAgent|ontology/i.test(code)) return "foundry";
  return "adk";
}
const langOf = (code: string) => (/^\s*[{[]/.test(code) ? "JSON" : /\bdef\s|\bimport\s+\w+\s*$|from\s+\w+(\.\w+)*\s+import/m.test(code) ? "Python" : "TypeScript");
const LANG: Record<string, string> = { python: "Python", typescript: "TypeScript", json: "JSON" };
const pretty = (v: any) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));
const uid = () => Math.random().toString(36).slice(2, 9);

function FwTag({ fw }: { fw: Framework }) {
  return <span className="al-tag al-proc sb-fw" style={{ ["--pc" as any]: FW[fw].colour }}>{FW[fw].short}</span>;
}

export default function SandboxWorkbench({ initialFramework = "" }: { initialFramework?: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<"import" | "check" | "test">("import");

  // ---- import --------------------------------------------------------------------
  const [code, setCode] = useState("");
  const [examples, setExamples] = useState<Example[]>([]);
  const [exFilter, setExFilter] = useState<string>(initialFramework);
  const [exampleId, setExampleId] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- check ---------------------------------------------------------------------
  const [agent, setAgent] = useState<ImportedAgent | null>(null);
  const [catalog, setCatalog] = useState<CatalogTool[]>([]);
  const [connected, setConnected] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [archetype, setArchetype] = useState("analyst");
  const [instruction, setInstruction] = useState("");
  const [stepsText, setStepsText] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [showCode, setShowCode] = useState(false);

  // ---- test ----------------------------------------------------------------------
  const [engines, setEngines] = useState<EngineInfo[] | null>(null);
  const [engine, setEngine] = useState<"anthropic" | "gemini" | "">("");
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [sources, setSources] = useState<Record<string, Source>>({});
  const [thinking, setThinking] = useState(false);
  const [rounds, setRounds] = useState(0);
  const [testError, setTestError] = useState("");
  const [message, setMessage] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);

  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetch("/api/sandbox/templates", { cache: "no-store" }).then((r) => r.json()).then((j) => setExamples(j.examples ?? [])).catch(() => {});
    fetch("/api/sandbox/bench", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setEngines(j.engines ?? []);
        if (j.engines?.[0]) setEngine(j.engines[0].id);
      })
      .catch(() => setEngines([]));
  }, []);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [transcript.length, pending.length, thinking]);

  const detected = useMemo(() => detect(code), [code]);
  const shownExamples = examples.filter((e) => !exFilter || e.framework === exFilter);
  const example = examples.find((e) => e.id === exampleId) ?? null;
  const steps = stepsText.split("\n").map((s) => s.trim()).filter(Boolean);
  const keptTools = agent ? agent.tools.filter((t) => mapping[t.name] !== "__drop") : [];

  // ---- reading code ------------------------------------------------------------------
  async function read(src: string, exId: string | null = null) {
    if (!src.trim()) return setError("Paste the agent's code, upload a file, or pick an example.");
    setReading(true);
    setError("");
    try {
      const res = await fetch("/api/sandbox/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: src, framework: "auto" }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The code could not be read.");
      const a: ImportedAgent = j.agent;
      setAgent(a);
      setCatalog(j.catalog ?? []);
      setConnected(j.connected ?? []);
      setSuggestions(j.suggestions ?? []);
      setName(a.name || examples.find((e) => e.id === exId)?.title || "");
      setPurpose(a.spec?.purpose || "");
      setArchetype(a.spec?.archetype || "analyst");
      setInstruction(a.instruction || a.spec?.brief || "");
      setStepsText((a.steps || []).join("\n"));
      setMapping(Object.fromEntries(a.tools.map((t, i) => [t.name, j.suggestions?.[i]?.id ?? "__drop"])));
      setExampleId(exId);
      resetTest();
      setStage("check");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setReading(false);
    }
  }

  async function takeFile(file: File) {
    setError("");
    try {
      let src = "";
      if (file.name.toLowerCase().endsWith(".zip")) {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(file);
        const files = Object.values(zip.files).filter((f) => !f.dir);
        const pick =
          files.find((f) => /(^|\/)agent\.json$/i.test(f.name)) ||
          files.find((f) => /(runner|handler|server|agent)\.(mjs|js|ts)$/i.test(f.name)) ||
          files.find((f) => /(agent|main|runner|app)\.py$/i.test(f.name)) ||
          files.find((f) => /\.(py|ts|mjs|js|json)$/i.test(f.name));
        if (!pick) throw new Error("No agent code was found in that package (looked for agent.json, a runner script or a Python file).");
        src = await pick.async("string");
      } else {
        if (file.size > 400_000) throw new Error("That file is too large to read here.");
        src = await file.text();
      }
      setCode(src);
      await read(src);
    } catch (e: any) {
      setError(e.message || "That file could not be read.");
    }
  }

  function loadExample(e: Example) {
    setCode(e.code);
    read(e.code, e.id);
  }

  function startOver() {
    setAgent(null);
    setCode("");
    setExampleId(null);
    resetTest();
    setStage("import");
  }

  // ---- testing -------------------------------------------------------------------------
  function resetTest() {
    setTranscript([]);
    setPending([]);
    setSources({});
    setRounds(0);
    setTestError("");
    setThinking(false);
  }

  async function step(t: Turn[], roundsSoFar: number) {
    if (!agent || !engine) return;
    if (roundsSoFar >= MAX_ROUNDS) {
      setTestError(`Stopped after ${MAX_ROUNDS} rounds of tool calls in one answer. Send another message to carry on, or start a new test.`);
      return;
    }
    setThinking(true);
    setTestError("");
    try {
      const res = await fetch("/api/sandbox/bench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine, agent: { name, purpose, instruction, steps }, tools: keptTools, transcript: t }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The model could not be reached.");
      const turn: Turn = { role: "agent", text: j.text, calls: (j.calls || []).map((c: any) => ({ id: c.id, name: c.name, args: c.args })), engine: j.engine, raw: j.raw };
      const next = [...t, turn];
      setTranscript(next);
      setRounds(roundsSoFar + 1);
      setPending((j.calls || []).map((c: any) => ({ call: { id: c.id, name: c.name, args: c.args }, sample: c.sample, draft: pretty(c.sample) })));
    } catch (e: any) {
      setTestError(e.message);
    } finally {
      setThinking(false);
    }
  }

  function send(text: string) {
    const t = text.trim();
    if (!t || thinking || pending.length) return;
    setMessage("");
    const next: Turn[] = [...transcript, { role: "user", text: t }];
    setTranscript(next);
    step(next, 0);
  }

  function answer(callId: string, kind: "use" | "error") {
    const p = pending.find((x) => x.call.id === callId);
    if (!p) return;
    let output: any;
    let source: Source;
    if (kind === "error") {
      output = { error: p.draft.trim() && p.draft.trim() !== pretty(p.sample) ? p.draft.trim() : `${p.call.name} failed: the service did not respond.` };
      source = "error";
    } else {
      try {
        output = JSON.parse(p.draft);
      } catch {
        output = p.draft;
      }
      source = p.draft === pretty(p.sample) ? "sample" : "custom";
    }
    const remaining = pending.filter((x) => x.call.id !== callId);
    const resolved = { ...sources, [callId]: source };
    setSources(resolved);
    // Results collect on one "tools" turn until every call in the round is answered.
    const last = transcript[transcript.length - 1];
    let next: Turn[];
    if (last?.role === "tools") next = [...transcript.slice(0, -1), { role: "tools", results: [...last.results, { id: callId, name: p.call.name, output }] }];
    else next = [...transcript, { role: "tools", results: [{ id: callId, name: p.call.name, output }] }];
    setTranscript(next);
    setPending(remaining);
    if (!remaining.length) step(next, rounds);
  }

  // Tool results by call id, for showing under each call.
  const resultsById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const t of transcript) if (t.role === "tools") for (const r of t.results) m[r.id] = r.output;
    return m;
  }, [transcript]);
  const callCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of transcript) if (t.role === "agent") for (const c of t.calls || []) m[c.name] = (m[c.name] ?? 0) + 1;
    return m;
  }, [transcript]);

  // ---- adding to Agent Studio -------------------------------------------------------------
  const mapped = agent
    ? agent.tools
        .map((t) => ({ tool: t, target: catalog.find((c) => c.id === mapping[t.name]) ?? null }))
    : [];
  const needMissing = Array.from(new Set(mapped.map((m) => m.target?.needs).filter((n): n is string => !!n && !connected.includes(n))));

  const stageIndex = stage === "import" ? 0 : stage === "check" ? 1 : 2;

  return (
    <div className="page sb">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Sandbox</h1>
          <p className="sub" style={{ maxWidth: 820 }}>
            Bring in an agent built with Google ADK, LangChain, OpenAI Agents or Palantir Foundry. Check what it does, test how it reasons, and add it to Agent Studio as a draft.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {agent && <button className="btn btn-ghost" onClick={startOver}>Start over</button>}
          <button className="btn btn-primary" disabled={!agent || !name.trim()} onClick={() => setAdding(true)} title={agent ? "Create a draft agent from this" : "Import an agent first"}>
            Add to Agent Studio
          </button>
        </div>
      </header>

      {/* ---- steps ---- */}
      <nav className="sb-steps" aria-label="Steps">
        {[
          { id: "import", label: "Import", hint: agent ? `${FW[agent.framework].short} · ${LANG[agent.language] ?? agent.language}` : "Paste, upload or pick an example" },
          { id: "check", label: "Check", hint: agent ? `${keptTools.length} of ${agent.tools.length} tools kept` : "What was understood" },
          { id: "test", label: "Test", hint: (() => { const n = transcript.filter((t) => t.role === "user").length; return n ? `${n} ${n === 1 ? "message" : "messages"} sent` : "Try it with a real model"; })() },
        ].map((s, i) => (
          <button
            key={s.id}
            className={`sb-step ${stageIndex === i ? "on" : ""} ${stageIndex > i ? "done" : ""}`}
            disabled={i > 0 && !agent}
            onClick={() => setStage(s.id as any)}
          >
            <span className="sb-step-n">{stageIndex > i ? <CheckIcon size={12} /> : i + 1}</span>
            <span className="grow"><b>{s.label}</b><span>{s.hint}</span></span>
          </button>
        ))}
      </nav>

      {/* ===================== IMPORT ===================== */}
      {stage === "import" && (
        <div className="sb-import">
          <section
            className={`sb-card sb-paste ${dragging ? "drag" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) takeFile(f);
            }}
          >
            <div className="sb-card-head">
              <div>
                <h2>Paste the agent&apos;s code</h2>
                <span>Python, TypeScript or JSON — or drop a file or an exported <code>.zip</code> package here.</span>
              </div>
              <div className="sb-head-tools">
                {detected && <span className="sb-detect">Looks like <FwTag fw={detected} /> · {langOf(code)}</span>}
                <button className="btn btn-sm" onClick={() => fileRef.current?.click()}><UploadIcon size={13} /> Upload file</button>
                <input ref={fileRef} type="file" hidden accept=".py,.ts,.tsx,.js,.mjs,.json,.zip" onChange={(e) => { const f = e.target.files?.[0]; if (f) takeFile(f); e.target.value = ""; }} />
              </div>
            </div>
            <textarea
              className="sb-code"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={"from google.adk import Agent\n\n@tool\ndef lookup_order(order_id: str) -> dict:\n    \"\"\"Fetch an order and its delivery status.\"\"\"\n\nagent = Agent(name=\"order_support\", instruction=\"…\", tools=[lookup_order])"}
            />
            {dragging && <div className="sb-drop">Drop the file to read it</div>}
            {error && <div className="error" style={{ margin: "0 16px 12px" }}>{error}</div>}
            <div className="sb-card-foot">
              <span className="dim">Nothing is run or saved yet. Reading only works out the agent&apos;s instructions and tools.</span>
              <div style={{ display: "flex", gap: 8 }}>
                {code && <button className="btn" onClick={() => { setCode(""); setError(""); }}>Clear</button>}
                <button className="btn btn-primary" onClick={() => read(code)} disabled={reading || !code.trim()}>
                  {reading ? "Reading…" : <>Read the agent <ArrowRightIcon size={13} /></>}
                </button>
              </div>
            </div>
          </section>

          <section className="sb-card sb-examples">
            <div className="sb-card-head">
              <div>
                <h2>Or start from an example</h2>
                <span>Ready-made agents for each framework, to see how it works.</span>
              </div>
            </div>
            <div className="chips sb-ex-chips">
              <button className={`chip ${!exFilter ? "on" : ""}`} onClick={() => setExFilter("")}>All <span className="al-n">{examples.length}</span></button>
              {(Object.keys(FW) as Framework[]).map((f) => (
                <button key={f} className={`chip ${exFilter === f ? "on" : ""}`} onClick={() => setExFilter(exFilter === f ? "" : f)}>
                  {FW[f].short} <span className="al-n">{examples.filter((e) => e.framework === f).length}</span>
                </button>
              ))}
            </div>
            <ul className="sb-ex-list">
              {shownExamples.map((e) => (
                <li key={e.id}>
                  <button onClick={() => loadExample(e)} disabled={reading}>
                    <span className="grow">
                      <b>{e.title}</b>
                      <span>{e.blurb}</span>
                    </span>
                    <FwTag fw={e.framework} />
                    <ArrowRightIcon size={13} />
                  </button>
                </li>
              ))}
              {!examples.length && <li className="dim" style={{ padding: 12 }}>Loading examples…</li>}
            </ul>
          </section>
        </div>
      )}

      {/* ===================== CHECK ===================== */}
      {stage === "check" && agent && (
        <>
          <div className="sb-summary">
            <FwTag fw={agent.framework} />
            <span>{LANG[agent.language] ?? agent.language}</span>
            {agent.model && <span className="dim">· built for <code>{agent.model}</code></span>}
            <span className="dim">· {steps.length} {steps.length === 1 ? "step" : "steps"} · {agent.tools.length} {agent.tools.length === 1 ? "tool" : "tools"}</span>
            <span className="grow" />
            <button className="btn btn-sm" onClick={() => setShowCode(!showCode)}>{showCode ? "Hide" : "Show"} the original code</button>
            <button className="btn btn-sm btn-primary" onClick={() => setStage("test")}>Test it <ArrowRightIcon size={12} /></button>
          </div>
          {showCode && <pre className="sb-source">{code}</pre>}

          {agent.related && (
            <div className="sb-note">
              <AlertIcon size={13} />
              <span>
                This agent works with {agent.related.names.length} {agent.related.names.length === 1 ? agent.related.kind.replace(/s$/, "") : agent.related.kind} ({agent.related.names.slice(0, 5).join(", ")}{agent.related.names.length > 5 ? "…" : ""}). Only this agent is brought in; build the others separately, or combine them later as a team.
              </span>
            </div>
          )}

          <div className="sb-check">
            <section className="sb-card">
              <div className="sb-card-head"><div><h2>What it is</h2><span>Edit anything that was not read correctly. This becomes the draft&apos;s brief.</span></div></div>
              <div className="sb-form">
                <div className="sb-two">
                  <label className="sb-field">
                    <span className="sb-label">Name</span>
                    <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label className="sb-field">
                    <span className="sb-label">Type</span>
                    <select className="input" value={archetype} onChange={(e) => setArchetype(e.target.value)}>
                      {ARCHETYPES.map((a) => <option key={a.id} value={a.id}>{a.label} — {a.hint}</option>)}
                    </select>
                  </label>
                </div>
                <label className="sb-field">
                  <span className="sb-label">What it&apos;s for</span>
                  <textarea className="textarea" rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="One or two sentences on the job it does." />
                </label>
                <label className="sb-field">
                  <span className="sb-label">Instructions <em>— as written in the original</em></span>
                  <textarea className="textarea sb-instr" rows={7} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
                </label>
                <label className="sb-field">
                  <span className="sb-label">Steps <em>— one per line</em></span>
                  <textarea className="textarea" rows={Math.min(10, Math.max(4, steps.length + 1))} value={stepsText} onChange={(e) => setStepsText(e.target.value)} />
                </label>
              </div>
            </section>

            <section className="sb-card">
              <div className="sb-card-head">
                <div>
                  <h2>Its tools</h2>
                  <span>What each of the agent&apos;s own tools becomes in Agent Studio. Tools left out are also left out of the test.</span>
                </div>
              </div>
              {!agent.tools.length ? (
                <p className="dim" style={{ margin: "0 16px 16px" }}>No tools were found. The agent will answer from its instructions alone.</p>
              ) : (
                <ul className="sb-tools">
                  {agent.tools.map((t, i) => {
                    const sel = mapping[t.name] ?? "__drop";
                    const target = catalog.find((c) => c.id === sel);
                    const sug = suggestions[i];
                    const params = Object.keys(t.parameters?.properties || {});
                    return (
                      <li key={t.name} className={sel === "__drop" ? "dropped" : ""}>
                        <div className="sb-tool-from">
                          <code>{t.name}</code>
                          {t.description && <span>{t.description}</span>}
                          {params.length > 0 && <em>takes {params.join(", ")}</em>}
                        </div>
                        <ArrowRightIcon size={13} />
                        <div className="sb-tool-to">
                          <select className="select-sm" value={sel} onChange={(e) => setMapping({ ...mapping, [t.name]: e.target.value })} aria-label={`What ${t.name} becomes`}>
                            <option value="__drop">Leave it out</option>
                            {catalog.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                          </select>
                          <span className="sb-tool-status">
                            {sel === "__drop" ? (
                              <span className="sb-badge grey">{sug?.match === "none" ? "No matching action" : "Left out"}</span>
                            ) : (
                              <>
                                <span className={`sb-badge ${sug?.id === sel ? (sug.match === "same" ? "ok" : "blue") : "blue"}`}>
                                  {sug?.id === sel ? (sug.match === "same" ? "Same action" : "Suggested") : "Your choice"}
                                </span>
                                {target?.needs && (
                                  connected.includes(target.needs)
                                    ? <span className="sb-conn ok"><CheckIcon size={11} /> {NEEDS_LABEL[target.needs] ?? target.needs} connected</span>
                                    : <span className="sb-conn warn">Needs a {NEEDS_LABEL[target.needs] ?? target.needs} connection</span>
                                )}
                              </>
                            )}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      {/* ===================== TEST ===================== */}
      {stage === "test" && agent && (
        <div className="sb-test">
          <section className="sb-card sb-chat-card">
            <div className="sb-chat-head">
              <div className="grow">
                <b>{name || agent.name}</b>
                <span>{keptTools.length} {keptTools.length === 1 ? "tool" : "tools"} · results are supplied by you, nothing real is called</span>
              </div>
              {engines && engines.length > 0 && (
                <select className="select-sm" value={engine} onChange={(e) => setEngine(e.target.value as any)} aria-label="Model" disabled={thinking || pending.length > 0}>
                  {engines.map((e) => <option key={e.id} value={e.id}>{e.label} · {e.model}</option>)}
                </select>
              )}
              <button className="btn btn-sm" onClick={resetTest} disabled={!transcript.length || thinking}>New test</button>
            </div>

            {engines !== null && engines.length === 0 ? (
              <div className="sb-nokey">
                <AlertIcon size={16} />
                <div>
                  <b>No model to test with</b>
                  <p>Testing needs an Anthropic (Claude) or Google Gemini key. Add one and come back — nothing is simulated.</p>
                  <Link className="btn btn-sm btn-primary" href="/connections?add=anthropic">Add a model key</Link>
                </div>
              </div>
            ) : (
              <>
                <div className="sb-chat">
                  {!transcript.length && (
                    <div className="sb-chat-empty">
                      <SparkIcon size={18} />
                      <p>Send the agent a request as a user would. When it wants to use a tool, the test pauses so you can give it the result — a suggested sample, your own data, or an error — and see how it reasons with it.</p>
                    </div>
                  )}
                  {transcript.map((t, i) => {
                    if (t.role === "user") return <div key={i} className="sb-msg you"><div className="sb-bubble">{t.text}</div></div>;
                    if (t.role === "tools") return null;
                    return (
                      <div key={i} className="sb-msg agent">
                        {t.text && <div className="sb-bubble">{t.text}</div>}
                        {(t.calls || []).map((c) => {
                          const p = pending.find((x) => x.call.id === c.id);
                          const done = c.id in resultsById;
                          const src = sources[c.id];
                          return (
                            <div key={c.id} className={`sb-call ${p ? "pending" : ""} ${src === "error" ? "err" : ""}`}>
                              <div className="sb-call-head">
                                <WrenchIcon size={13} />
                                <span>Wants to use <code>{c.name}</code></span>
                                {done && <span className={`sb-badge ${src === "error" ? "red" : src === "custom" ? "blue" : "grey"}`}>{src === "error" ? "You returned an error" : src === "custom" ? "Your data" : "Sample data"}</span>}
                              </div>
                              {c.args && Object.keys(c.args).length > 0 && (
                                <dl className="sb-args">
                                  {Object.entries(c.args).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd></div>)}
                                </dl>
                              )}
                              {p ? (
                                <div className="sb-call-answer">
                                  <label>
                                    What does <code>{c.name}</code> return? <em>Sample data below — edit it to match the real system.</em>
                                  </label>
                                  <textarea
                                    className="textarea mono"
                                    rows={Math.min(12, Math.max(4, p.draft.split("\n").length))}
                                    value={p.draft}
                                    onChange={(e) => setPending(pending.map((x) => (x.call.id === c.id ? { ...x, draft: e.target.value } : x)))}
                                  />
                                  <div className="sb-call-go">
                                    <button className="btn btn-sm" onClick={() => setPending(pending.map((x) => (x.call.id === c.id ? { ...x, draft: pretty(x.sample) } : x)))} disabled={p.draft === pretty(p.sample)}>Reset to sample</button>
                                    <button className="btn btn-sm btn-danger" onClick={() => answer(c.id, "error")} title="Send the text above as an error, or a generic failure if unchanged">Return an error</button>
                                    <button className="btn btn-sm btn-primary" onClick={() => answer(c.id, "use")}>Send this result</button>
                                  </div>
                                </div>
                              ) : done ? (
                                <details className="sb-result">
                                  <summary>Result sent</summary>
                                  <pre>{pretty(resultsById[c.id])}</pre>
                                </details>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {thinking && <div className="sb-msg agent"><div className="sb-bubble thinking"><span className="sb-spin" /> Thinking…</div></div>}
                  {testError && <div className="error">{testError}</div>}
                  <div ref={chatEnd} />
                </div>
                <form className="sb-compose" onSubmit={(e) => { e.preventDefault(); send(message); }}>
                  <textarea
                    rows={2}
                    value={message}
                    placeholder={pending.length ? "Answer the tool call above first…" : `Message ${name || "the agent"}…`}
                    disabled={thinking || pending.length > 0 || !engine}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send(message);
                      }
                    }}
                  />
                  <button className="btn btn-primary" type="submit" disabled={!message.trim() || thinking || pending.length > 0 || !engine}>Send</button>
                </form>
              </>
            )}
          </section>

          <aside className="sb-side">
            <section className="sb-card">
              <div className="sb-card-head"><div><h2>Try asking</h2></div></div>
              <ul className="sb-prompts">
                {(example?.prompts?.length ? example.prompts : [
                  `What can you help me with?`,
                  `Walk me through how you would handle a typical request, step by step.`,
                  `What would you do if one of your tools failed?`,
                ]).map((p) => (
                  <li key={p}><button onClick={() => send(p)} disabled={thinking || pending.length > 0 || !engine}>{p}</button></li>
                ))}
              </ul>
            </section>
            <section className="sb-card">
              <div className="sb-card-head"><div><h2>Tools in this test</h2></div></div>
              {!keptTools.length ? (
                <p className="dim" style={{ margin: "0 16px 14px", fontSize: 12.5 }}>None — every tool is left out.</p>
              ) : (
                <ul className="sb-used">
                  {keptTools.map((t) => (
                    <li key={t.name}>
                      <code>{t.name}</code>
                      <span className={callCount[t.name] ? "" : "dim"}>{callCount[t.name] ? `used ${callCount[t.name]}×` : "not used yet"}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button className="sb-link" onClick={() => setStage("check")}><ArrowLeftIcon size={11} /> Change tools</button>
            </section>
            {!!engines?.length && <p className="sb-meter">Each message uses your {engine === "gemini" ? "Gemini" : "Anthropic"} key and counts towards <Link href="/usage">Usage &amp; limits</Link>.</p>}
          </aside>
        </div>
      )}

      {adding && agent && (
        <AddDialog
          name={name}
          framework={agent.framework}
          steps={steps.length}
          mapped={mapped}
          needMissing={needMissing}
          onClose={() => setAdding(false)}
          onAdd={async () => {
            const tools = Array.from(new Set(mapped.filter((m) => m.target).map((m) => m.target!.id))).map((id) => {
              const c = catalog.find((x) => x.id === id)!;
              return { id, gate: c.risk === "low" ? "auto" : "approval" };
            });
            const spec = {
              ...(agent.spec || {}),
              name: name.trim(),
              archetype,
              purpose: purpose.trim(),
              brief: instruction.trim() || purpose.trim(),
              steps,
              tools,
            };
            const res = await fetch("/api/sandbox/promote", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: name.trim(), spec, sourceCode: code, framework: agent.framework }),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok || !j.agentId) throw new Error(j.error || "The draft could not be created.");
            router.push(`/agents/${j.agentId}`);
          }}
        />
      )}
    </div>
  );
}

function AddDialog({
  name, framework, steps, mapped, needMissing, onClose, onAdd,
}: {
  name: string;
  framework: Framework;
  steps: number;
  mapped: { tool: ImportedTool; target: CatalogTool | null }[];
  needMissing: string[];
  onClose: () => void;
  onAdd: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [busy, onClose]);
  const kept = mapped.filter((m) => m.target);
  const dropped = mapped.filter((m) => !m.target);
  return (
    <div className="modal-back" onMouseDown={() => !busy && onClose()}>
      <div className="panel modal sb-add" role="dialog" aria-modal="true" aria-labelledby="sb-add-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="eyebrow">Add to Agent Studio</div>
        <h2 id="sb-add-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>Create “{name}” as a draft agent?</h2>
        <p className="help" style={{ marginTop: 0 }}>
          It opens in the builder as a draft, from {FW[framework].label}, with {steps} {steps === 1 ? "step" : "steps"}. Nothing runs until you publish it.
        </p>
        <div className="sb-add-grid">
          <div>
            <span className="sb-label">Actions it gets ({kept.length})</span>
            {kept.length ? (
              <ul>{kept.map((m) => <li key={m.tool.name}><CheckIcon size={11} /> {m.target!.label} <em>from {m.tool.name}</em></li>)}</ul>
            ) : <p className="dim">None — it will work from its instructions only.</p>}
          </div>
          {dropped.length > 0 && (
            <div>
              <span className="sb-label">Left out ({dropped.length})</span>
              <ul className="dim">{dropped.map((m) => <li key={m.tool.name}><CrossIcon size={10} /> {m.tool.name}</li>)}</ul>
            </div>
          )}
        </div>
        {needMissing.length > 0 && (
          <div className="sb-note" style={{ marginTop: 12 }}>
            <AlertIcon size={13} />
            <span>Before it can run, add {needMissing.length === 1 ? "a connection" : "connections"} for {needMissing.map((n) => NEEDS_LABEL[n] ?? n).join(", ")} under <Link href="/connections">Connections</Link>.</span>
          </div>
        )}
        {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
        <div className="panel-foot">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                await onAdd();
              } catch (e: any) {
                setErr(e.message);
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create draft and open it"}
          </button>
        </div>
      </div>
    </div>
  );
}
