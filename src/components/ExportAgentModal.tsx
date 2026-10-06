"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ExportBundle, ExportFile, ExportRuntime, ExportTarget } from "@/lib/agent-exporter";
import { AlertIcon, CheckIcon, CopyIcon, CrossIcon, ExportIcon, ShieldIcon } from "@/components/agent-ui";

type Props = {
  agentId: string;
  agentName: string;
  isOpen: boolean;
  onClose: () => void;
};

const TARGETS: { id: ExportTarget; label: string; blurb: string }[] = [
  { id: "gcp", label: "Google Cloud", blurb: "Cloud Run service or Cloud Function" },
  { id: "aws", label: "AWS", blurb: "App Runner container or Lambda function" },
  { id: "azure", label: "Microsoft Azure", blurb: "Container Apps" },
  { id: "docker", label: "Docker", blurb: "Any server, or your own machine" },
  { id: "python", label: "Python", blurb: "A FastAPI service, for Python teams" },
];

/** Where a platform offers both, the two ways to run it, in its own words. */
const RUNTIMES: Partial<Record<ExportTarget, { id: ExportRuntime; label: string }[]>> = {
  gcp: [
    { id: "container", label: "Service (Cloud Run)" },
    { id: "serverless", label: "Function (Cloud Functions)" },
  ],
  aws: [
    { id: "container", label: "Container (App Runner)" },
    { id: "serverless", label: "Function (Lambda)" },
  ],
};

type Tab = "package" | "call";

export default function ExportAgentModal({ agentId, agentName, isOpen, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("package");
  const [target, setTarget] = useState<ExportTarget>("gcp");
  const [runtime, setRuntime] = useState<ExportRuntime>("container");
  const [bundle, setBundle] = useState<ExportBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    setLoading(true);
    setError("");
    fetch(`/api/agents/${agentId}/export?target=${target}&runtime=${runtime}&format=json`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not prepare the package.");
        if (live) setBundle(data.bundle);
      })
      .catch((e) => live && setError(e.message || String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [isOpen, agentId, target, runtime]);

  if (!isOpen) return null;

  const version = bundle
    ? bundle.version
      ? `Version ${bundle.version}, the published one. Changes in the draft that aren't published are not included.`
      : "Never published, so this is the current draft."
    : loading
      ? "Preparing…"
      : "";

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="panel modal ex" role="dialog" aria-modal="true" aria-labelledby="ex-title" onMouseDown={(e) => e.stopPropagation()}>
        <header className="ex-head">
          <span className="ex-mark"><ExportIcon size={18} /></span>
          <div className="ex-title">
            <div className="eyebrow">Export</div>
            <h2 id="ex-title">{agentName}</h2>
            <p>{version}</p>
          </div>
          <button className="ex-x" onClick={onClose} aria-label="Close"><CrossIcon size={14} /></button>
        </header>

        <nav className="ex-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "package"} className={tab === "package" ? "on" : ""} onClick={() => setTab("package")}>
            Download a package
          </button>
          <button role="tab" aria-selected={tab === "call"} className={tab === "call" ? "on" : ""} onClick={() => setTab("call")}>
            Call it through Agent Studio
          </button>
        </nav>

        {error && <div className="error ex-error">{error}</div>}

        {tab === "package" ? (
          <PackageTab
            agentId={agentId}
            target={target}
            runtime={runtime}
            setTarget={(t) => {
              setTarget(t);
              if (!RUNTIMES[t]) setRuntime("container");
            }}
            setRuntime={setRuntime}
            bundle={bundle}
            loading={loading}
          />
        ) : (
          <CallTab agentId={agentId} bundle={bundle} />
        )}
      </div>
    </div>
  );
}

// ---- download a package ------------------------------------------------------------------

function PackageTab({
  agentId,
  target,
  runtime,
  setTarget,
  setRuntime,
  bundle,
  loading,
}: {
  agentId: string;
  target: ExportTarget;
  runtime: ExportRuntime;
  setTarget: (t: ExportTarget) => void;
  setRuntime: (r: ExportRuntime) => void;
  bundle: ExportBundle | null;
  loading: boolean;
}) {
  const [file, setFile] = useState<string | null>(null);
  const runtimes = RUNTIMES[target];
  const actions = bundle?.actions ?? [];
  const held = actions.filter((a) => a.works && a.gate === "approval");
  const needed = (bundle?.requiredEnvVars ?? []).filter((v) => v.required);
  const optional = (bundle?.requiredEnvVars ?? []).length - needed.length;
  const withheld = (bundle?.skills ?? []).some((s) => !s.included);
  const shown: ExportFile | undefined = bundle?.files.find((f) => f.path === file) ?? bundle?.files.find((f) => /^runner\./.test(f.path));

  return (
    <div className="ex-body ex-pkg">
      <aside className="ex-side">
        <div className="ex-label">Where will it run?</div>
        <div className="ex-targets" role="radiogroup" aria-label="Where will it run?">
          {TARGETS.map((t) => (
            <button key={t.id} role="radio" aria-checked={target === t.id} className={`ex-target${target === t.id ? " on" : ""}`} onClick={() => setTarget(t.id)}>
              <span className="ex-radio" />
              <span>
                <b>{t.label}</b>
                <small>{t.blurb}</small>
              </span>
            </button>
          ))}
        </div>

        {runtimes && (
          <>
            <div className="ex-label">Run it as</div>
            <div className="ex-seg">
              {runtimes.map((r) => (
                <button key={r.id} className={runtime === r.id ? "on" : ""} onClick={() => setRuntime(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="ex-download">
          <a
            className={`btn btn-primary${!bundle || loading ? " disabled" : ""}`}
            href={bundle && !loading ? `/api/agents/${agentId}/export?target=${target}&runtime=${runtime}&format=zip` : undefined}
            aria-disabled={!bundle || loading}
          >
            <ExportIcon size={14} /> Download .zip
          </a>
          <p>{bundle ? `${bundle.files.length} files. Downloads are recorded in the audit trail.` : " "}</p>
        </div>
      </aside>

      <section className={`ex-main${loading ? " busy" : ""}`}>
        {!bundle ? (
          <div className="ex-skel"><span /><span /><span /></div>
        ) : (
          <>
            <p className="ex-lead">
              The agent on its own: its instructions, skills and actions, with a small service that runs it on your Anthropic
              key. Callers need the access token that comes filled in with the package.
            </p>

            <h3 className="ex-h">What it can do</h3>
            {actions.length === 0 ? (
              <p className="ex-none">No actions. It reads its instructions and answers.</p>
            ) : (
              <ul className="ex-actions">
                {actions.map((a) => (
                  <li key={a.id} className={a.works ? "" : "off"}>
                    <span className="ex-act-name">{a.label}</span>
                    <span className={`ex-pill ${!a.works ? "off" : a.gate === "approval" ? "ask" : "auto"}`}>
                      {!a.works ? "Not included" : a.gate === "approval" ? "Waits for approval" : "Runs by itself"}
                    </span>
                    {a.note && <small>{a.note}</small>}
                  </li>
                ))}
              </ul>
            )}

            {held.length > 0 && (
              <div className="ex-callout">
                <ShieldIcon size={15} />
                <div>
                  <b>Approval still applies.</b> Actions that wait for approval are not carried out by the package. They come back in
                  the response as <code>heldActions</code>; once someone has checked one, send it to <code>POST /approve</code>.
                  Setting <code>APPROVE_ALL_ACTIONS=true</code> removes the check.
                </div>
              </div>
            )}

            {bundle.skills.length > 0 && (
              <>
                <h3 className="ex-h">Skills</h3>
                <div className="ex-chips">
                  {bundle.skills.map((s) => (
                    <span key={s.label} className={`ex-chip${s.included ? "" : " off"}`}>
                      {s.included ? <CheckIcon size={11} /> : <AlertIcon size={11} />} {s.label}
                    </span>
                  ))}
                </div>
                {withheld && (
                  <p className="ex-note">
                    Only workspace admins can export skill instructions, so the package has their names but not their content. Ask for a
                    download on the Skills page.
                  </p>
                )}
              </>
            )}

            <h3 className="ex-h">Settings it needs</h3>
            <div className="ex-chips">
              {needed.map((v) => (
                <span key={v.key} className="ex-chip mono" title={v.description}>{v.key}</span>
              ))}
            </div>
            <p className="ex-note">
              {optional > 0 ? `Plus ${optional} optional. ` : ""}All listed in <code>.env.example</code>; the access token is already filled
              with a random value made for this download.
            </p>

            <h3 className="ex-h">Stays in Agent Studio</h3>
            <ul className="ex-stays">
              {bundle.notCarried.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>

            <h3 className="ex-h">Deploy</h3>
            <CopyLine text={bundle.deployCommand} />
            <p className="ex-note">
              Or run <code>deploy.sh</code>, which checks the settings first. The README walks through it.
            </p>

            <details className="ex-files">
              <summary>Look inside: {bundle.files.length} files</summary>
              <div className="ex-files-grid">
                <ul>
                  {bundle.files.map((f) => (
                    <li key={f.path}>
                      <button className={shown?.path === f.path ? "on" : ""} onClick={() => setFile(f.path)} title={f.description}>
                        {f.path}
                      </button>
                    </li>
                  ))}
                </ul>
                {shown && (
                  <div className="ex-code">
                    <div className="ex-code-head">
                      <span>{shown.description}</span>
                      <CopyButton text={shown.content} />
                    </div>
                    <pre>{shown.content}</pre>
                  </div>
                )}
              </div>
            </details>
          </>
        )}
      </section>
    </div>
  );
}

// ---- call it through Agent Studio -------------------------------------------------------------

function CallTab({ agentId, bundle }: { agentId: string; bundle: ExportBundle | null }) {
  const [origin, setOrigin] = useState("");
  const [input, setInput] = useState("");
  const [rehearse, setRehearse] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: number; data: any } | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  const endpoint = `${origin}/api/v1/agents/${agentId}/invoke`;
  const inputs = bundle?.call.inputs ?? [];
  const example = `const res = await fetch("${endpoint}", {
  method: "POST",
  credentials: "include", // your Agent Studio sign-in
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    input: "What should I look at first?",${inputs.length ? `\n    inputs: { ${inputs.map((i) => `${i.key}: "..."`).join(", ")} },` : ""}
    dryRun: false
  })
});
const run = await res.json(); // run.status, run.output, run.runId`;

  async function tryIt() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, dryRun: rehearse }),
      });
      setResult({ status: res.status, data: await res.json().catch(() => ({})) });
    } catch (e: any) {
      setResult({ status: 0, data: { error: e.message || String(e) } });
    } finally {
      setBusy(false);
    }
  }

  const run = result?.data;
  const ok = result && result.status >= 200 && result.status < 300;

  return (
    <div className="ex-body ex-call">
      <p className="ex-lead">
        Start a run of this agent from a script or another tool. It runs here in Agent Studio, like any other run: the published
        version, with its connections, approvals, usage limits, and a record in Runs.
      </p>

      <div className="ex-callout warn">
        <AlertIcon size={15} />
        <div>
          <b>Calls need a signed-in Agent Studio session.</b> There are no API keys yet, so this works from a browser or script signed
          in as you, not from another server. To run the agent from your own systems, download a package instead.
        </div>
      </div>

      <h3 className="ex-h">Endpoint</h3>
      <CopyLine text={`POST ${endpoint}`} copy={endpoint} />
      {bundle && (
        <div className="ex-facts">
          <span>Up to {bundle.call.rateLimitRpm} calls a minute</span>
          {bundle.call.dlp && <span>Personal data is masked on the way in and out</span>}
          <span>Actions that need approval wait in Approvals</span>
        </div>
      )}

      <div className="ex-two">
        <div>
          <h3 className="ex-h">You send</h3>
          <dl className="ex-fields">
            <dt><code>input</code></dt>
            <dd>What to do, in words.</dd>
            <dt><code>inputs</code></dt>
            <dd>
              {inputs.length
                ? <>Values for its inputs: {inputs.map((i, n) => <span key={i.key}>{n > 0 && ", "}<code>{i.key}</code>{i.required && " (required)"}</span>)}.</>
                : "Values for declared inputs. This agent declares none."}
            </dd>
            <dt><code>dryRun</code></dt>
            <dd><code>true</code> to rehearse: it plans and drafts but carries out no actions.</dd>
          </dl>
        </div>
        <div>
          <h3 className="ex-h">You get back</h3>
          <dl className="ex-fields">
            <dt><code>status</code></dt>
            <dd><code>completed</code>, <code>awaiting_approval</code> (an action waits in Approvals) or <code>failed</code>.</dd>
            <dt><code>output</code></dt>
            <dd>The agent&apos;s answer.</dd>
            <dt><code>runId</code></dt>
            <dd>The run, to open in Runs.</dd>
            <dt><code>toolsCalled</code>, <code>usage</code></dt>
            <dd>What it did, and the tokens and cost.</dd>
          </dl>
        </div>
      </div>

      <details className="ex-files">
        <summary>Example (JavaScript)</summary>
        <div className="ex-code">
          <div className="ex-code-head">
            <span>From a page or script signed in to Agent Studio</span>
            <CopyButton text={example} />
          </div>
          <pre>{example}</pre>
        </div>
      </details>

      <h3 className="ex-h">Try it</h3>
      <div className="ex-try">
        <textarea className="textarea" rows={3} value={input} placeholder="What should the agent do?" onChange={(e) => setInput(e.target.value)} />
        <div className="ex-try-row">
          <label className="ex-check">
            <input type="checkbox" checked={rehearse} onChange={(e) => setRehearse(e.target.checked)} />
            Rehearse only: carry out no actions
          </label>
          <button className="btn btn-primary" onClick={tryIt} disabled={busy || !input.trim()}>
            {busy ? "Running…" : rehearse ? "Rehearse" : "Run it"}
          </button>
        </div>
        {!rehearse && <p className="ex-note warn">This starts a real run. Actions that don&apos;t need approval happen straight away.</p>}
        {result && (
          <div className={`ex-result${ok ? "" : " bad"}`}>
            <div className="ex-result-head">
              <span className={`ex-pill ${ok ? (run?.status === "awaiting_approval" ? "ask" : "auto") : "off"}`}>
                {ok ? STATUS_WORDS[run?.status] ?? "Done" : `Error ${result.status || ""}`}
              </span>
              {ok && run?.durationMs != null && <span className="ex-dim">{(run.durationMs / 1000).toFixed(1)}s</span>}
              {run?.runId && <Link href={`/runs/${run.runId}`} className="ex-open">Open the run →</Link>}
            </div>
            <pre>{ok ? run?.output || "(no answer yet)" : run?.error || run?.message || "The call failed."}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_WORDS: Record<string, string> = {
  completed: "Completed",
  awaiting_approval: "Waiting for approval",
  running: "Still running",
  failed: "Failed",
  error: "Failed",
};

// ---- bits ----------------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="ex-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? <CheckIcon size={12} /> : <CopyIcon size={12} />} {done ? "Copied" : "Copy"}
    </button>
  );
}

function CopyLine({ text, copy }: { text: string; copy?: string }) {
  return (
    <div className="ex-line">
      <code>{text}</code>
      <CopyButton text={copy ?? text} />
    </div>
  );
}
