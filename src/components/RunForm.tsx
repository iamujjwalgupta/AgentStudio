"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { normaliseInputs, type AgentSpec } from "@/lib/types";

/**
 * How a person actually uses an agent.
 *
 * The form is generated from the agent's declared inputs, so each agent asks for
 * exactly what it needs — a file here, a threshold there — instead of offering
 * one box and hoping. Files upload first and are handed to the agent by name;
 * the agent reads them with its document tool rather than having them inlined.
 */
export default function RunForm({
  agentId,
  agentName,
  spec,
  published,
}: {
  agentId: string;
  agentName: string;
  spec: AgentSpec;
  published: boolean;
}) {
  const router = useRouter();
  const inputs = normaliseInputs(spec.inputs as any[]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  const set = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }));

  async function start(dryRun: boolean) {
    setBusy(dryRun ? "rehearse" : "run");
    setError("");
    try {
      // Files become documents first, then the agent is told their names.
      const resolved: Record<string, string> = { ...values };
      for (const input of inputs.filter((i) => i.type === "file")) {
        const f = files[input.key];
        if (!f) continue;
        setProgress(`Uploading ${f.name}…`);
        const fd = new FormData();
        fd.append("file", f);
        const up = await fetch("/api/documents", { method: "POST", body: fd });
        const uj = await up.json();
        if (!up.ok) throw new Error(uj.error || `${f.name} could not be uploaded.`);
        resolved[input.key] = uj.document.name;
      }

      setProgress("Starting the run…");
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, values: resolved, input: note, dryRun, useDraft: !published }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The run could not be started.");
      router.push(`/runs/${j.runId}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
      setProgress("");
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Run an agent</div>
          <h1>{agentName}</h1>
          <p className="sub">{spec.purpose || "Give it what it needs, then set it going."}</p>
        </div>
        <Link className="btn" href={`/agents/${agentId}`}>
          Open in the builder
        </Link>
      </header>

      {!published && (
        <div className="note" style={{ marginBottom: 14 }}>
          This agent is not published, so the draft will be used. Publish it to run the reviewed version.
        </div>
      )}
      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="panel">
        {inputs.length === 0 ? (
          <p className="help" style={{ marginBottom: 0 }}>
            This agent asks for nothing in particular. Add anything you want it to know below, or just run it.
          </p>
        ) : (
          <div className="stack">
            {inputs.map((i) => (
              <label className="field" key={i.key}>
                <span className="eyebrow">
                  {i.label}
                  {i.required && <span className="req"> required</span>}
                </span>

                {i.type === "file" ? (
                  <>
                    <input
                      className="input"
                      type="file"
                      onChange={(e) => setFiles({ ...files, [i.key]: e.target.files?.[0] ?? null })}
                    />
                    {files[i.key] && <span className="sub-line mono">{files[i.key]!.name}</span>}
                  </>
                ) : i.type === "longtext" ? (
                  <textarea
                    className="textarea"
                    rows={4}
                    placeholder={i.hint}
                    value={values[i.key] ?? ""}
                    onChange={(e) => set(i.key, e.target.value)}
                  />
                ) : i.type === "choice" ? (
                  <select className="input" value={values[i.key] ?? ""} onChange={(e) => set(i.key, e.target.value)}>
                    <option value="">Choose…</option>
                    {(i.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    type={i.type === "number" ? "number" : i.type === "date" ? "date" : "text"}
                    placeholder={i.hint}
                    value={values[i.key] ?? ""}
                    onChange={(e) => set(i.key, e.target.value)}
                  />
                )}

                {i.hint && i.type !== "text" && i.type !== "number" && (
                  <span className="help" style={{ marginTop: 5 }}>{i.hint}</span>
                )}
              </label>
            ))}
          </div>
        )}

        <label className="field mt">
          <span className="eyebrow">Anything else</span>
          <textarea
            className="textarea"
            rows={2}
            placeholder="Optional. Extra context for this run only."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="panel-foot">
          <button className="btn" onClick={() => start(true)} disabled={!!busy} title="Runs it, but describes gated actions instead of carrying them out">
            {busy === "rehearse" ? "Rehearsing…" : "Rehearse"}
          </button>
          <button className="btn btn-primary" onClick={() => start(false)} disabled={!!busy}>
            {busy === "run" ? progress || "Working…" : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
