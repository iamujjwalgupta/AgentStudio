"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FinIcon from "./FinIcon";
import { OwnerTag } from "./parts";
import { ACTION_LIBRARY, AGENTS, targetHref } from "@/lib/finance";

type Toast = { id: number; message: string; kind: "ok" | "info" };

type Finance = {
  openAgent: (id: string) => void;
  runAgent: (id: string) => void;
  openAction: (personaId: string, index: number) => void;
  isDone: (personaId: string, index: number) => boolean;
  toggleDone: (personaId: string, index: number) => void;
  notify: (message: string, kind?: "ok" | "info") => void;
};

const Ctx = createContext<Finance | null>(null);

export function useFinance(): Finance {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFinance must be used inside FinanceProvider");
  return v;
}

const DONE_KEY = "as_fin_done";

/**
 * Shared state for the Finance pages: the demo agent profile, the action
 * breakdown dialog, which actions have been ticked off (kept in this browser
 * only), and short confirmation messages.
 */
export default function FinanceProvider({ children }: { children: React.ReactNode }) {
  const [agentId, setAgentId] = useState<string | null>(null);
  const [action, setAction] = useState<{ pid: string; idx: number } | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DONE_KEY) || "[]");
      if (Array.isArray(saved)) setDone(saved.filter((x) => typeof x === "string"));
    } catch {
      /* storage unavailable: start empty */
    }
  }, []);

  const notify = useCallback((message: string, kind: "ok" | "info" = "info") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  const value = useMemo<Finance>(
    () => ({
      openAgent: (id) => setAgentId(id),
      runAgent: (id) => {
        const a = AGENTS.find((x) => x.id === id);
        notify(`Agent run queued: “${a ? a.name : id}” triggered successfully in test sandbox.`, "ok");
      },
      openAction: (pid, idx) => setAction({ pid, idx }),
      isDone: (pid, idx) => done.includes(`${pid}_${idx}`),
      toggleDone: (pid, idx) => {
        const key = `${pid}_${idx}`;
        setDone((prev) => {
          const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
          try {
            localStorage.setItem(DONE_KEY, JSON.stringify(next));
          } catch {
            /* not saved; still works for this visit */
          }
          return next;
        });
      },
      notify,
    }),
    [done, notify],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {agentId && <AgentDialog id={agentId} onClose={() => setAgentId(null)} onRun={value.runAgent} />}
      {action && <ActionDialog pid={action.pid} idx={action.idx} onClose={() => setAction(null)} />}
      <div className="fin-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`fin-toast ${t.kind}`}>
            <FinIcon name={t.kind === "ok" ? "check" : "sparkles"} size={15} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Dialog frame in the Agent Studio pattern: scrim, panel, Escape and scrim click close it. */
export function FinDialog({
  label,
  onClose,
  children,
  wide = false,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    const back = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      back?.focus?.();
    };
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className={`panel modal fin-modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={label}>
        <button className="icon-btn fin-modal-x" onClick={onClose} aria-label="Close">
          <FinIcon name="x" size={15} />
        </button>
        {children}
      </div>
    </div>
  );
}

function AgentDialog({ id, onClose, onRun }: { id: string; onClose: () => void; onRun: (id: string) => void }) {
  const a = AGENTS.find((x) => x.id === id);
  if (!a) return null;
  return (
    <FinDialog label={a.name} onClose={onClose} wide>
      <div className="eyebrow">Demo agent catalogue</div>
      <h2 className="fin-modal-title">{a.name}</h2>
      <div className="fin-tags">
        <OwnerTag type={a.type} />
        <span className="tag static">{a.archetype}</span>
        <span className="tag static">{a.tower}</span>
      </div>
      <p className="fin-modal-lead">{a.desc}</p>

      {!!a.features?.length && (
        <section className="fin-msec">
          <h3>What it does</h3>
          <ul className="fin-checks">
            {a.features.map((f, i) => (
              <li key={i}><FinIcon name="check" size={14} />{f}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="fin-msec">
        <h3>Technology</h3>
        <div className="fin-kv">
          <div><span>Stack</span><b>{a.techStack || "—"}</b></div>
          <div><span>Model</span><b>{a.model || "—"}</b></div>
        </div>
      </section>

      <section className="fin-msec">
        <h3>Last 30 days</h3>
        <div className="fin-stats">
          <div className="fin-stat"><b>{a.usage ? a.usage.runs.toLocaleString("en-IN") : "0"}</b><span>Runs</span></div>
          <div className="fin-stat"><b>{a.usage?.latency ?? "—"}</b><span>Average time</span></div>
          <div className="fin-stat"><b>{a.usage?.success ?? "—"}</b><span>Success rate</span></div>
          <div className="fin-stat"><b>{a.usage?.tokens ?? "—"}</b><span>Tokens</span></div>
        </div>
      </section>

      <section className="fin-msec">
        <h3>Feedback</h3>
        <div className="fin-social">
          <span><FinIcon name="star" size={14} filled /> {a.social?.rating ?? "—"} rating</span>
          <span><FinIcon name="thumbs-up" size={14} /> {a.social?.likes ?? 0} likes</span>
          <span><FinIcon name="download" size={14} /> {a.social?.downloads ?? 0} deployments</span>
        </div>
        {a.social?.feedback?.length ? (
          a.social.feedback.map((q, i) => <blockquote key={i} className="fin-quote">“{q}”</blockquote>)
        ) : (
          <p className="dim fin-small">No feedback recorded yet.</p>
        )}
      </section>

      <div className="panel-foot">
        <span className="fin-small dim">An illustrative profile. Running it is a demonstration, not a real run.</span>
        <div className="fin-row">
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={() => onRun(a.id)}>
            <FinIcon name="play" size={12} filled /> Run agent
          </button>
        </div>
      </div>
    </FinDialog>
  );
}

function ActionDialog({ pid, idx, onClose }: { pid: string; idx: number; onClose: () => void }) {
  const router = useRouter();
  const a = (ACTION_LIBRARY[pid] || [])[idx];
  if (!a) return null;
  return (
    <FinDialog label={a.title} onClose={onClose} wide>
      <div className="eyebrow">Open action</div>
      <h2 className="fin-modal-title">
        <span className={`fin-sev ${a.sev}`} aria-hidden="true" />
        {a.title}
      </h2>
      <p className="fin-small dim">{a.meta}</p>

      <section className="fin-msec">
        <h3>Breakdown</h3>
        <div className="fin-breakdown">
          {a.breakdown.map(([k, v], i) => (
            <div key={i}><span>{k}</span><b>{v}</b></div>
          ))}
        </div>
      </section>

      <section className="fin-msec">
        <h3>How to resolve it</h3>
        <ol className="fin-steps">
          {a.steps.map((s, i) => (
            <li key={i}><span className="fin-step-n">{i + 1}</span>{s}</li>
          ))}
        </ol>
      </section>

      <div className="panel-foot">
        <span />
        <div className="fin-row">
          <button className="btn" onClick={onClose}>Close</button>
          {a.goTo && (
            <button
              className="btn btn-primary"
              onClick={() => {
                onClose();
                router.push(targetHref(a.goTo!, pid));
              }}
            >
              Open the process <FinIcon name="arrow-right" size={13} />
            </button>
          )}
        </div>
      </div>
    </FinDialog>
  );
}
