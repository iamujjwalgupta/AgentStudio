"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SkillMarkdown from "../SkillMarkdown";
import ActionPreview from "../approvals/ActionPreview";
import DeliverableView from "../deliverable/DeliverableView";
import { AlertIcon, ChatIcon, CheckIcon, CopyIcon, CrossIcon, DocIcon, ShieldIcon, SparkIcon, TrashIcon, WrenchIcon } from "../agent-ui";
import type { SpecInput } from "@/lib/types";
import type { ChatTurn } from "@/lib/chat";

/**
 * Working with an agent as a conversation. Each message is a run: the agent
 * works through it live, stops for approvals in the thread, and answers with
 * text and, when it has figures to show, a dashboard with Excel, PDF and
 * PowerPoint downloads. Follow-ups know what was said and found before.
 */

type Input = SpecInput & { exts: string[] };
type ChatRow = { id: string; title: string; updated_at: string; last_status: string | null; turns: number };

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function took(from: string, to?: string | null) {
  const s = Math.max(0, Math.round(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  running: { label: "Working", cls: "live" },
  awaiting_approval: { label: "Waiting for a decision", cls: "wait" },
  completed: { label: "Done", cls: "ok" },
  failed: { label: "Failed", cls: "bad" },
  rejected: { label: "Stopped", cls: "bad" },
};

const PaperclipIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M13.2 7.4 8 12.6a3.3 3.3 0 0 1-4.7-4.7l5.5-5.5a2.2 2.2 0 0 1 3.1 3.1L6.4 11a1.1 1.1 0 0 1-1.6-1.6l4.9-4.9" />
  </svg>
);
const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 13V3M3.8 7.2 8 3l4.2 4.2" />
  </svg>
);
const SlidersIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </svg>
);

export default function AgentChat({
  agent,
  inputs,
  initialChatId,
}: {
  agent: { id: string; name: string; purpose: string; published: boolean; retired: boolean };
  inputs: Input[];
  initialChatId: string | null;
}) {
  const router = useRouter();
  const fileInputs = inputs.filter((i) => i.type === "file");
  const fieldInputs = inputs.filter((i) => i.type !== "file");

  const [chats, setChats] = useState<ChatRow[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialChatId);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loadingChat, setLoadingChat] = useState(Boolean(initialChatId));
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [fields, setFields] = useState<Record<string, string>>({});
  const [showFields, setShowFields] = useState(false);
  const [rehearse, setRehearse] = useState(false);
  const [sending, setSending] = useState<{ message: string; files: string[]; progress: string } | null>(null);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [deciding, setDeciding] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [, tick] = useState(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const last = turns[turns.length - 1];
  const busy = Boolean(last && !last.stuck && (last.status === "running" || last.status === "awaiting_approval"));

  /* ── loading ─────────────────────────────────────────────── */

  const loadChats = useCallback(async () => {
    const res = await fetch(`/api/chats?agentId=${agent.id}`, { cache: "no-store" });
    if (res.ok) setChats((await res.json()).chats);
  }, [agent.id]);

  const loadTurns = useCallback(async (id: string) => {
    const res = await fetch(`/api/chats/${id}`, { cache: "no-store" });
    if (!res.ok) {
      setError(res.status === 404 ? "That conversation was not found." : "The conversation could not be loaded.");
      setTurns([]);
      return null;
    }
    const j = await res.json();
    setTurns(j.turns);
    return j.turns as ChatTurn[];
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  // Opening a conversation: its turns, and the details it was last given.
  useEffect(() => {
    if (!activeId) {
      setTurns([]);
      return;
    }
    let live = true;
    setLoadingChat(true);
    loadTurns(activeId).then((t) => {
      if (!live) return;
      setLoadingChat(false);
      const prev = t?.[t.length - 1]?.values ?? {};
      setFields(Object.fromEntries(fieldInputs.map((i) => [i.key, prev[i.key] ?? ""])));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, loadTurns]);

  // Live while the agent works; slower while it waits on someone else's decision.
  const pollEvery = !last || last.stuck ? 0 : last.status === "running" ? 2500 : last.status === "awaiting_approval" ? 8000 : 0;
  useEffect(() => {
    if (!activeId || !pollEvery) return;
    const t = setInterval(() => {
      loadTurns(activeId).then((next) => {
        const end = next?.[next.length - 1];
        if (end && end.status !== "running" && end.status !== "awaiting_approval") loadChats();
      });
    }, pollEvery);
    return () => clearInterval(t);
  }, [activeId, pollEvery, loadTurns, loadChats]);

  useEffect(() => {
    if (last?.status !== "running") return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [last?.status]);

  // Keep the newest turn in view as it grows.
  const stepCount = turns.reduce((n, t) => n + t.steps.length, 0);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns.length, stepCount, last?.status, sending]);

  /* ── actions ─────────────────────────────────────────────── */

  function openChat(id: string | null) {
    setError("");
    setActiveId(id);
    setFiles({});
    if (!id) setFields({});
    router.replace(id ? `/agents/${agent.id}/chat?c=${id}` : `/agents/${agent.id}/chat`, { scroll: false });
  }

  function pickFile(i: Input, f: File | null) {
    if (f && i.exts.length && !i.exts.some((e) => f.name.toLowerCase().endsWith(e))) {
      setError(`${i.label} takes ${i.exts.join(", ")} files; ${f.name} is not one of them.`);
      return;
    }
    setError("");
    setFiles((s) => ({ ...s, [i.key]: f }));
  }

  // A file dropped anywhere on the composer goes to the first slot still empty.
  function dropFiles(list: FileList) {
    const remaining = [...fileInputs];
    for (const f of Array.from(list)) {
      const slot = remaining.find((i) => !files[i.key] && (!i.exts.length || i.exts.some((e) => f.name.toLowerCase().endsWith(e)))) ?? remaining[0];
      if (!slot) break;
      pickFile(slot, f);
      remaining.splice(remaining.indexOf(slot), 1);
    }
  }

  async function send(override?: string) {
    const message = (override ?? text).trim();
    const chosen = fileInputs.filter((i) => files[i.key]);
    if (!message && !chosen.length) return;
    if (!activeId) {
      const missing = inputs.filter((i) => i.required && !(i.type === "file" ? files[i.key] : (fields[i.key] ?? "").trim()));
      if (missing.length) {
        setError(`${agent.name} needs ${missing.map((m) => m.label).join(", ")} to start.`);
        if (missing.some((m) => m.type !== "file")) setShowFields(true);
        return;
      }
    }
    setError("");
    setSending({ message, files: chosen.map((i) => files[i.key]!.name), progress: "" });
    try {
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) if (String(v).trim()) values[k] = String(v).trim();
      for (const i of chosen) {
        const f = files[i.key]!;
        setSending((s) => s && { ...s, progress: `Uploading ${f.name}…` });
        const fd = new FormData();
        fd.append("file", f);
        const up = await fetch("/api/documents", { method: "POST", body: fd });
        const uj = await up.json().catch(() => ({}));
        if (!up.ok) throw new Error(uj.error || `${f.name} could not be uploaded.`);
        values[i.key] = uj.document.name;
      }
      setSending((s) => s && { ...s, progress: "" });
      const res = await fetch(activeId ? `/api/chats/${activeId}` : "/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, message, values, dryRun: rehearse }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The agent could not be started.");
      setText("");
      setFiles({});
      setShowFields(false);
      if (!activeId) {
        setActiveId(j.chatId);
        router.replace(`/agents/${agent.id}/chat?c=${j.chatId}`, { scroll: false });
      } else {
        await loadTurns(activeId);
      }
      loadChats();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(null);
    }
  }

  async function decide(a: ChatTurn["approvals"][number], decision: "approved" | "rejected") {
    setDeciding(a.id);
    setError("");
    try {
      const res = await fetch(`/api/approvals/${a.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, comment: (notes[a.id] ?? "").trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The decision could not be recorded.");
      if (j.resumeError) setError(`Recorded, but the agent could not carry on: ${j.resumeError}`);
      if (activeId) await loadTurns(activeId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeciding(null);
    }
  }

  async function removeChat(c: ChatRow) {
    if (!confirm(`Delete “${c.title}”? The runs stay in the run history.`)) return;
    const res = await fetch(`/api/chats/${c.id}`, { method: "DELETE" });
    if (!res.ok) return setError("That conversation could not be deleted.");
    if (c.id === activeId) openChat(null);
    loadChats();
  }

  /* ── view ────────────────────────────────────────────────── */

  const carried = useMemo(() => (last ? last.values : {}) as Record<string, string>, [last]);
  const fieldsSet = fieldInputs.filter((i) => (fields[i.key] ?? "").trim()).length;
  const canSend = !sending && !busy && !agent.retired && Boolean(text.trim() || fileInputs.some((i) => files[i.key]));
  const starters = [
    fileInputs.length
      ? `Work through the attached ${fileInputs[0].label.toLowerCase()} and show me the results`
      : `Run your full check and show me the results`,
    `What do you need from me, and what will you produce?`,
    `Walk me through how you do this, step by step`,
  ];

  return (
    <div className="ch">
      <aside className="ch-side">
        <div className="ch-side-head">
          <Link href="/agents" className="ch-back">← Agents</Link>
          <button className="btn btn-primary ch-new" onClick={() => openChat(null)} disabled={!activeId && !turns.length}>
            <ChatIcon size={13} /> New conversation
          </button>
        </div>
        <div className="ch-side-label">Conversations</div>
        <ul className="ch-list">
          {chats === null ? (
            <li className="ch-list-skel"><span /><span /><span /></li>
          ) : chats.length === 0 ? (
            <li className="ch-list-empty">None yet. Your conversations with {agent.name} will be listed here.</li>
          ) : (
            chats.map((c) => {
              const s = STATUS[c.last_status ?? ""] ?? null;
              return (
                <li key={c.id} className={c.id === activeId ? "on" : ""}>
                  <button className="ch-list-item" onClick={() => openChat(c.id)}>
                    <span className="ch-list-title">{c.title}</span>
                    <span className="ch-list-meta">
                      {s && <i className={`ch-dot ${s.cls}`} />}
                      {ago(c.updated_at)} · {c.turns} {c.turns === 1 ? "message" : "messages"}
                    </span>
                  </button>
                  <button className="ch-list-del" onClick={() => removeChat(c)} aria-label={`Delete ${c.title}`} title="Delete conversation">
                    <TrashIcon size={13} />
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      <section className="ch-main">
        <header className="ch-head">
          <span className="ch-avatar lg"><SparkIcon size={16} /></span>
          <div className="grow">
            <h1>{agent.name}</h1>
            <div className="ch-head-meta">
              <span className={`ch-badge ${agent.published ? "ok" : "draft"}`}>{agent.published ? "Published" : "Draft"}</span>
              {agent.purpose && <span className="ch-purpose">{agent.purpose}</span>}
            </div>
          </div>
          <Link href={`/agents/${agent.id}/run`} className="btn btn-ghost">Run form</Link>
          <Link href={`/agents/${agent.id}`} className="btn">Open builder</Link>
        </header>

        <div className="ch-thread" ref={threadRef}>
          <div className="ch-col">
            {agent.retired && <div className="ch-banner bad"><AlertIcon size={14} /> This agent is retired. Restore it in the builder to talk to it again.</div>}
            {!agent.published && !agent.retired && (
              <div className="ch-banner info"><ShieldIcon size={14} /> Not published yet — you are talking to the saved draft.</div>
            )}

            {loadingChat ? (
              <div className="ch-skel"><span /><span /><span /></div>
            ) : !turns.length && !sending ? (
              <div className="ch-hello">
                <span className="ch-hello-mark"><SparkIcon size={26} /></span>
                <h2>{agent.name}</h2>
                <p>{agent.purpose || "Ask it to do its work, then ask follow-up questions about what it found."}</p>
                {inputs.length > 0 && (
                  <div className="ch-needs">
                    <span className="ch-needs-label">It works with</span>
                    {inputs.map((i) => (
                      <span key={i.key} className={`ch-need ${i.type === "file" ? "file" : ""}`}>
                        {i.type === "file" ? <DocIcon size={12} /> : <SlidersIcon />}
                        {i.label}
                        {i.exts.length > 0 && <em>{i.exts.join(" ")}</em>}
                        {i.required && <b>required</b>}
                      </span>
                    ))}
                  </div>
                )}
                <div className="ch-starters">
                  {starters.map((s) => (
                    <button key={s} onClick={() => { setText(s); taRef.current?.focus(); }}>
                      {s}
                      <span aria-hidden="true">→</span>
                    </button>
                  ))}
                </div>
                <p className="ch-hello-foot">
                  Results come back as a dashboard you can download as Excel, PDF or PowerPoint. Actions that need approval stop in the conversation for a decision.
                </p>
              </div>
            ) : (
              turns.map((t, idx) => (
                <Turn
                  key={t.runId}
                  t={t}
                  agentName={agent.name}
                  latest={idx === turns.length - 1}
                  notes={notes}
                  setNote={(id, v) => setNotes((n) => ({ ...n, [id]: v }))}
                  deciding={deciding}
                  decide={decide}
                />
              ))
            )}

            {sending && (
              <div className="ch-turn">
                <UserBubble message={sending.message} files={sending.files} pending />
                <div className="ch-agent">
                  <span className="ch-avatar"><SparkIcon size={13} /></span>
                  <div className="ch-agent-body">
                    <div className="ch-working"><span className="ch-spin" /> {sending.progress || "Starting…"}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <footer
          className={`ch-compose-wrap${dragging ? " drag" : ""}`}
          onDragOver={(e) => {
            if (!fileInputs.length) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (!fileInputs.length) return;
            e.preventDefault();
            setDragging(false);
            dropFiles(e.dataTransfer.files);
          }}
        >
          <div className="ch-col">
            {error && (
              <div className="ch-error">
                <AlertIcon size={13} /> <span className="grow">{error}</span>
                <button onClick={() => setError("")} aria-label="Dismiss"><CrossIcon size={10} /></button>
              </div>
            )}
            <div className="ch-compose">
              {showFields && fieldInputs.length > 0 && (
                <div className="ch-fields">
                  {fieldInputs.map((i) => (
                    <label key={i.key} className="ch-field">
                      <span>{i.label}{i.required && <b> required</b>}</span>
                      {i.type === "choice" ? (
                        <select className="input" value={fields[i.key] ?? ""} onChange={(e) => setFields({ ...fields, [i.key]: e.target.value })}>
                          <option value="">Choose…</option>
                          {(i.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : i.type === "longtext" ? (
                        <textarea className="textarea" rows={2} placeholder={i.hint} value={fields[i.key] ?? ""} onChange={(e) => setFields({ ...fields, [i.key]: e.target.value })} />
                      ) : (
                        <input
                          className="input"
                          type={i.type === "number" ? "number" : i.type === "date" ? "date" : "text"}
                          placeholder={i.hint}
                          value={fields[i.key] ?? ""}
                          onChange={(e) => setFields({ ...fields, [i.key]: e.target.value })}
                        />
                      )}
                    </label>
                  ))}
                </div>
              )}

              {(fileInputs.length > 0 || fieldInputs.length > 0) && (
                <div className="ch-slots">
                  {fileInputs.map((i) => {
                    const f = files[i.key];
                    const prev = carried[i.key];
                    return f ? (
                      <span key={i.key} className="ch-slot set">
                        <DocIcon size={12} /> <b>{f.name}</b>
                        <button onClick={() => setFiles((s) => ({ ...s, [i.key]: null }))} aria-label={`Remove ${f.name}`}><CrossIcon size={9} /></button>
                      </span>
                    ) : (
                      <label key={i.key} className={`ch-slot${prev ? " carried" : ""}${i.required && !prev ? " need" : ""}`} title={i.hint || undefined}>
                        <input type="file" hidden accept={i.exts.join(",") || undefined} onChange={(e) => { pickFile(i, e.target.files?.[0] ?? null); e.target.value = ""; }} />
                        <PaperclipIcon />
                        {prev ? <>Using <b>{prev}</b> · replace</> : <>{i.label}{i.required ? " · required" : ""}</>}
                      </label>
                    );
                  })}
                  {fieldInputs.length > 0 && (
                    <button className={`ch-slot details${showFields ? " on" : ""}`} onClick={() => setShowFields((v) => !v)}>
                      <SlidersIcon /> Details{fieldsSet ? ` · ${fieldsSet} set` : ""}
                    </button>
                  )}
                </div>
              )}

              <textarea
                ref={taRef}
                className="ch-input"
                rows={1}
                placeholder={
                  agent.retired
                    ? "This agent is retired."
                    : busy
                      ? last?.status === "awaiting_approval"
                        ? "Decide the action above, then carry on…"
                        : `${agent.name} is working…`
                      : turns.length
                        ? "Ask a follow-up — drill into a finding, change a threshold, ask for another view…"
                        : `Tell ${agent.name} what you need${fileInputs.length ? ", and attach the file" : ""}…`
                }
                value={text}
                disabled={agent.retired}
                onChange={(e) => {
                  setText(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (canSend) send();
                  }
                }}
              />
              <div className="ch-compose-foot">
                <label className={`ch-toggle${rehearse ? " on" : ""}`} title="Runs it, but describes approval-gated actions instead of carrying them out">
                  <input type="checkbox" checked={rehearse} onChange={(e) => setRehearse(e.target.checked)} />
                  <span className="ch-switch" aria-hidden="true" />
                  Rehearse
                </label>
                <span className="grow" />
                <span className="ch-hint">Enter to send · Shift+Enter for a new line</span>
                <button className="ch-send" onClick={() => send()} disabled={!canSend} aria-label="Send">
                  {sending ? <span className="ch-spin light" /> : <SendIcon />}
                </button>
              </div>
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}

function UserBubble({ message, files, pending, dryRun }: { message: string; files: string[]; pending?: boolean; dryRun?: boolean }) {
  return (
    <div className={`ch-user${pending ? " pending" : ""}`}>
      <div className="ch-bubble">
        {message ? <p>{message}</p> : <p className="dim-light">Sent {files.length === 1 ? "a file" : "files"}</p>}
        {files.length > 0 && (
          <div className="ch-files">
            {files.map((f) => <span key={f} className="ch-file"><DocIcon size={11} /> {f}</span>)}
          </div>
        )}
      </div>
      {dryRun && <span className="ch-rehearsal">Rehearsal</span>}
    </div>
  );
}

function Turn({
  t,
  agentName,
  latest,
  notes,
  setNote,
  deciding,
  decide,
}: {
  t: ChatTurn;
  agentName: string;
  latest: boolean;
  notes: Record<string, string>;
  setNote: (id: string, v: string) => void;
  deciding: string | null;
  decide: (a: ChatTurn["approvals"][number], d: "approved" | "rejected") => void;
}) {
  const [showSteps, setShowSteps] = useState(false);
  const [copied, setCopied] = useState(false);
  const working = t.status === "running" && !t.stuck;
  const s = t.stuck ? { label: "Stopped", cls: "bad" } : STATUS[t.status] ?? { label: t.status, cls: "" };
  const pending = t.approvals.filter((a) => a.status === "pending");
  const decided = t.approvals.filter((a) => a.status !== "pending");
  const toolSteps = t.steps.filter((x) => x.kind === "tool");
  const stepLabel = (x: ChatTurn["steps"][number]) =>
    x.kind === "model" ? (x.title && x.title !== "Deliverable" && x.title !== "Reasoning" ? x.title : "Thinking it through") : x.title || x.tool || x.kind;
  // Repeats of the same step read as one line with a count.
  const grouped: { step: ChatTurn["steps"][number]; n: number }[] = [];
  for (const x of t.steps) {
    const prev = grouped[grouped.length - 1];
    if (prev && stepLabel(prev.step) === stepLabel(x)) {
      prev.n++;
    } else grouped.push({ step: x, n: 1 });
  }
  const recent = grouped.slice(-5);

  return (
    <div className="ch-turn">
      <UserBubble message={t.message} files={t.files} dryRun={t.dryRun} />

      <div className="ch-agent">
        <span className="ch-avatar"><SparkIcon size={13} /></span>
        <div className="ch-agent-body">
          <div className="ch-agent-top">
            <b>{agentName}</b>
            <span className={`ch-state ${s.cls}`}><i className={`ch-dot ${s.cls}`} /> {s.label}</span>
            <span className="ch-time">{clock(t.startedAt)}{t.endedAt || working ? ` · ${took(t.startedAt, t.endedAt)}` : ""}</span>
          </div>

          {working && (
            <div className="ch-progress">
              <div className="ch-progress-bar"><span /></div>
              <ol>
                {recent.map((g, i) => (
                  <li key={grouped.length - recent.length + i}>
                    {g.step.kind === "model" ? <SparkIcon size={11} /> : <WrenchIcon size={11} />} {stepLabel(g.step)}
                    {g.n > 1 && <span className="ch-times">×{g.n}</span>}
                  </li>
                ))}
                <li className="now"><span className="ch-spin" /> {t.steps.length ? "Working on the next step…" : "Reading the request…"}</li>
              </ol>
            </div>
          )}

          {t.stuck && (
            <div className="ch-banner bad"><AlertIcon size={14} /> This turn never finished — most likely the server restarted. Ask again to retry.</div>
          )}
          {t.error && !t.stuck && <div className="ch-banner bad"><AlertIcon size={14} /> {t.error}</div>}

          {pending.map((a) => (
            <section key={a.id} className="ch-approval">
              <div className="ch-approval-head">
                <ShieldIcon size={13} /> <b>{a.label}</b>
                <span className={`apx-risk ${a.risk}`}>{a.risk === "high" ? "High risk" : a.risk === "low" ? "Low risk" : "Medium risk"}</span>
                <span className="grow" />
                <span className="ch-approval-kicker">Needs a decision</span>
              </div>
              <div className="apx-preview"><ActionPreview tool={a.tool} p={a.payload} /></div>
              {a.blocked ? (
                <div className="ch-approval-blocked"><ShieldIcon size={13} /> {a.blocked} <Link href="/approvals">Approvals →</Link></div>
              ) : (
                <div className="ch-approval-act">
                  {a.selfWouldApprove && <div className="ch-approval-self"><AlertIcon size={12} /> Nobody else here can decide this, so it is recorded as a self-approval.</div>}
                  <input
                    className="input"
                    placeholder="Note — optional; if you reject, the agent is told this as the reason"
                    value={notes[a.id] ?? ""}
                    onChange={(e) => setNote(a.id, e.target.value)}
                  />
                  <button className="btn btn-danger" onClick={() => decide(a, "rejected")} disabled={deciding === a.id}><CrossIcon size={10} /> Reject</button>
                  <button className="btn btn-primary" onClick={() => decide(a, "approved")} disabled={deciding === a.id}>
                    <CheckIcon size={12} /> {deciding === a.id ? "Working…" : "Approve"}
                  </button>
                </div>
              )}
            </section>
          ))}

          {t.output && (
            <div className="ch-answer">
              <SkillMarkdown source={t.output} className="ch-md" />
            </div>
          )}

          {t.deliverable && (
            <div className="ch-result">
              <DeliverableView d={t.deliverable.spec} id={t.deliverable.id} compact fullHref={`/deliverables/${t.deliverable.id}`} />
            </div>
          )}

          {decided.length > 0 && (
            <div className="ch-decided">
              {decided.map((a) => (
                <span key={a.id} className={`ch-decision ${a.status}`}>
                  {a.status === "approved" ? <CheckIcon size={11} /> : <CrossIcon size={9} />} {a.label} — {a.status}
                  {a.comment ? <em> “{a.comment}”</em> : null}
                </span>
              ))}
            </div>
          )}

          {!working && (
            <div className="ch-agent-foot">
              {t.steps.length > 0 && (
                <button onClick={() => setShowSteps((v) => !v)}>
                  {showSteps ? "Hide steps" : `${t.steps.length} steps · ${toolSteps.length} tool ${toolSteps.length === 1 ? "call" : "calls"}`}
                </button>
              )}
              {t.output && (
                <button
                  onClick={() => navigator.clipboard?.writeText(t.output || "").then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); })}
                >
                  {copied ? <><CheckIcon size={11} /> Copied</> : <><CopyIcon size={11} /> Copy answer</>}
                </button>
              )}
              <Link href={`/runs/${t.runId}`}>Run details ↗</Link>
              {latest && t.status === "completed" && !t.deliverable && !t.output && <span className="dim">No answer was written.</span>}
            </div>
          )}
          {showSteps && !working && (
            <ol className="ch-steps">
              {t.steps.map((x, i) => (
                <li key={i} className={x.status === "error" ? "err" : ""}>
                  <span className="ch-steps-ic">{x.status === "error" ? <AlertIcon size={11} /> : x.kind === "model" ? <SparkIcon size={11} /> : <WrenchIcon size={11} />}</span>
                  <span className="grow">{stepLabel(x)}</span>
                  {x.tool && x.kind === "tool" && <code>{x.tool}</code>}
                  {x.ms ? <span className="ch-steps-ms">{(x.ms / 1000).toFixed(1)}s</span> : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
