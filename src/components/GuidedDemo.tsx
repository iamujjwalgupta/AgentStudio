"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";

export const TOUR_STORAGE_KEY = "agent-studio.tour-completed";
export const START_TOUR_EVENT = "agent-studio:start-tour";

export type TourStep = {
  id: string;
  target: string; // selector: [data-tour="..."]
  eyebrow: string;
  title: string;
  description: string;
  highlights: string[];
  path?: string;
  actionLabel?: string;
};

const STEPS: TourStep[] = [
  {
    id: "brand",
    target: "brand",
    eyebrow: "Platform Overview",
    title: "Welcome to Agent Studio",
    description:
      "An enterprise no-code platform for building, orchestrating, and governing autonomous AI agents and multi-agent swarms with production tooling, real-time debugging, and strict human approval gates.",
    highlights: [
      "Translates natural language briefs into structured, verifiable AgentSpecs",
      "Connects to enterprise databases, APIs, MCP servers, and internal web apps",
      "Enforces human approval gates and PII guardrails before consequential actions",
    ],
  },
  {
    id: "agents",
    target: "agents",
    eyebrow: "01 · Build",
    path: "/agents",
    actionLabel: "View Agents & Swarms",
    title: "Agents, Swarms & Evals",
    description:
      "The core of your autonomous workforce. Build agents with a guided six-step compiler, orchestrate multi-agent swarms, configure cron triggers, inspect live execution, and benchmark performance.",
    highlights: [
      "AI brief compiler with draft vs. published versioning and visual diffs",
      "Multi-Agent Swarm Canvas for visual supervisor-to-subagent delegation",
      "Recurring Cron Triggers, Live Debugger with breakpoints & Eval benchmarks",
      "1-Click REST API gateway & Python / Docker deployment exporter",
    ],
  },
  {
    id: "skills",
    target: "skills",
    eyebrow: "02 · Build",
    path: "/skills",
    actionLabel: "View Skills",
    title: "Domain Knowledge & SOPs",
    description:
      "Codify how your team works. While tools define what an agent is permitted to do, skills teach it organizational procedures, tone of voice, compliance standards, and operational playbooks.",
    highlights: [
      "AI-assisted drafting from brief natural language descriptions",
      "Markdown instruction editor with interactive Grid and List views",
      "Attachable to any agent with automatic hot-reloading on next execution",
    ],
  },
  {
    id: "apps",
    target: "apps",
    eyebrow: "03 · Build",
    path: "/apps",
    actionLabel: "View Embedded Apps",
    title: "Embedded Apps & Canvas Hub",
    description:
      "Embed operational web applications, internal dashboards, and external SaaS tools directly alongside your agents. Work across multi-tab split layouts with an interactive Agent Assistant.",
    highlights: [
      "Bi-directional window.postMessage SDK bridge for deep app-agent interactivity",
      "Multi-Tab and Split View Canvas to run tools side-by-side with your agent",
      "Session presets, instant bookmarking, and paired contextual agent assistant",
    ],
  },
  {
    id: "sandbox",
    target: "sandbox",
    eyebrow: "04 · Simulate",
    path: "/sandbox",
    actionLabel: "View Sandboxes",
    title: "Multi-Framework Sandbox Hub",
    description:
      "Isolated simulation runtimes for Google ADK, LangGraph, Palantir Foundry AIP, and OpenAI Swarm. Test reasoning loops and promote agents directly into Agent Studio.",
    highlights: [
      "Universal AST decompilation across 4 leading enterprise agent frameworks",
      "Live LLM execution traces with simulated telemetry and mock backends",
      "One-click promotion into verified Agent Studio managed assets",
    ],
  },
  {
    id: "connections",
    target: "connections",
    eyebrow: "05 · Build",
    path: "/connections",
    actionLabel: "View Connection Vault",
    title: "Connection Vault, OAuth & MCP",
    description:
      "Give agents access to real enterprise tools without compromising security. Credentials are encrypted at rest with AUTH_SECRET and safeguarded by read-only and DLP guardrails.",
    highlights: [
      "1-Click OAuth 2.0 integration for enterprise identity and third-party SaaS",
      "Model Context Protocol (MCP) server auto-discovery & visual schema browser",
      "Live connection health heartbeats, webhook listeners, and SQL read-only guards",
    ],
  },
  {
    id: "approvals",
    target: "approvals",
    eyebrow: "06 · Operate",
    path: "/approvals",
    actionLabel: "View Approvals",
    title: "Human-in-the-Loop Governance",
    description:
      "Enterprise governance built-in. Whenever an agent plans a medium- or high-risk action (like updating a database, sending emails, or calling external APIs), it pauses and waits for human review.",
    highlights: [
      "Execution state is persisted indefinitely until a decision is recorded",
      "Approval resumes the run seamlessly; rejection prompts the agent to adapt",
      "Full cryptographic audit trail of who approved or rejected each action",
    ],
  },
  {
    id: "runs",
    target: "runs",
    eyebrow: "07 · Activity & Monitoring",
    path: "/runs",
    actionLabel: "View Run Traces",
    title: "Observability & Step Traces",
    description:
      "Inspect what your agents are doing in real time. Observe each thought, tool call, PII filter, and result in the execution loop with downloadable artifacts.",
    highlights: [
      "Live step-by-step reasoning, input/output inspection, and thought logs",
      "Generates downloadable artifacts (CSV, PDF, XLSX, DOCX, Markdown)",
      "Pinpoints exact prompt, tool parameters, and published version used",
    ],
  },
  {
    id: "spend",
    target: "spend",
    eyebrow: "08 · Activity & Monitoring",
    path: "/spend",
    actionLabel: "View Spend Analytics",
    title: "Spend Caps & Cost Intelligence",
    description:
      "Keep cost and token utilization under strict control. Track model token expenditure, configure monthly workspace budget caps, and analyze cost efficiency.",
    highlights: [
      "Real-time USD tracking broken down by model, agent, and daily timeline",
      "Hard spend cap thresholds that prevent runaway agent loops and overages",
      "Cost economics breakdown comparing frontier vs. specialized models",
    ],
  },
  {
    id: "audit",
    target: "audit",
    eyebrow: "09 · Activity & Monitoring",
    path: "/audit",
    actionLabel: "View Audit Trail",
    title: "Immutable Audit Trail",
    description:
      "Comprehensive enterprise security and compliance log. Audit every administrative event, credential change, agent deployment, and human approval decision.",
    highlights: [
      "Append-only, tamper-resistant log recording all agent and security events",
      "Actor attribution with exact timestamps, IP/user context, and event details",
      "Exportable logs ready for enterprise SIEM ingestion and SOC2 audits",
    ],
  },
  {
    id: "shares",
    target: "shares",
    eyebrow: "Workspace Collaboration",
    path: "/shares",
    actionLabel: "View Shares & Team",
    title: "Agent Sharing & Workspace Permissions",
    description:
      "Collaborate across your team with fine-grained access control. Share agents with specific colleagues or departments, review pending invites, and manage workspace membership.",
    highlights: [
      "Granular agent sharing with custom permissions (View or Edit)",
      "Pending invitation badges with 1-click acceptance or revocation",
      "Workspace member administration with role-based access control",
    ],
  },
  {
    id: "foot",
    target: "foot",
    eyebrow: "Workspaces & Help",
    title: "Workspaces & On-Demand Demo",
    description:
      "You are ready to build! Switch between organization workspaces, manage your active session, or relaunch this Guided Demo anytime from the sidebar footer.",
    highlights: [
      "Multi-workspace switching with isolated agents, credentials, and runs",
      "Relaunch this tour at any time by clicking 'Guided Demo' in the sidebar footer",
      "Keyboard shortcuts: use arrow keys (← / →) to navigate and Esc to exit",
    ],
  },
];

type Box = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export function launchTour() {
  if (typeof window !== "undefined") {
    if (window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    window.dispatchEvent(new CustomEvent(START_TOUR_EVENT));
  }
}

/** Button to place in the sidebar footer to relaunch the guided demo */
export function TourLauncher() {
  return (
    <button
      className="tour-launch-btn"
      onClick={launchTour}
      aria-label="Launch Guided Tour"
      title="Start guided platform tour"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="8" cy="8" r="6.5" />
        <path d="M11 5l-2 5-5 2 2-5 5-2z" />
      </svg>
      <span>Guided Demo</span>
    </button>
  );
}

export default function GuidedDemo() {
  const router = useRouter();
  const pathname = usePathname();

  const [active, setActive] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [targetBox, setTargetBox] = useState<Box | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number }>({ top: 100, left: 320 });

  const cardRef = useRef<HTMLDivElement>(null);

  // Check if first-time user on mount
  useEffect(() => {
    try {
      const completed = localStorage.getItem(TOUR_STORAGE_KEY);
      if (!completed) {
        // Small delay so initial paint and hydration complete gracefully
        const timer = setTimeout(() => {
          setWelcomeOpen(true);
        }, 800);
        return () => clearTimeout(timer);
      }
    } catch {
      /* ignore storage access restrictions */
    }
  }, []);

  // Listen for manual tour launch events
  useEffect(() => {
    const handleStart = () => {
      if (window.scrollY > 0) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      setWelcomeOpen(false);
      setIndex(0);
      setActive(true);
    };

    window.addEventListener(START_TOUR_EVENT, handleStart);
    return () => window.removeEventListener(START_TOUR_EVENT, handleStart);
  }, []);

  // Measure and position spotlight and card
  const measure = useCallback(() => {
    if (!active) return;
    const step = STEPS[index];
    if (!step) return;

    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const pad = 6;
    const box: Box = {
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    };
    setTargetBox(box);

    // Compute tooltip card position to the right of the sidebar
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const cardW = 400;
    const cardH = cardRef.current ? cardRef.current.offsetHeight : 340;

    // Prefer placing card to the right of the highlighted box
    let left = box.left + box.width + 18;
    if (left + cardW > winW - 20) {
      // If overflowing right, center horizontally
      left = Math.max(20, (winW - cardW) / 2);
    }

    // Align vertically with the center of the target, clamped inside viewport
    let top = box.top + box.height / 2 - cardH / 2;
    top = Math.max(24, Math.min(top, winH - cardH - 24));

    setCardPos({ top, left });
  }, [active, index]);

  // Scroll target element into view and smoothly track position
  useEffect(() => {
    if (!active) return;
    const step = STEPS[index];
    if (!step) return;

    const el = document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null;
    if (el) {
      if (index === 0 || step.target === "brand") {
        if (window.scrollY > 0) {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        const rail = el.closest(".rail");
        if (rail && rail.scrollTop > 0) {
          rail.scrollTo({ top: 0, behavior: "smooth" });
        }
      } else {
        const rect = el.getBoundingClientRect();
        const inView = rect.top >= 20 && rect.bottom <= window.innerHeight - 20;
        if (!inView) {
          el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        }
      }
    }

    measure();

    // Track smoothly across animation frames as smooth scroll progresses
    let animId: number;
    const startTime = performance.now();
    const tick = (now: number) => {
      measure();
      if (now - startTime < 600) {
        animId = requestAnimationFrame(tick);
      }
    };
    animId = requestAnimationFrame(tick);

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [active, index, measure]);

  // Re-measure when step changes, window resizes, or pathname changes
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, pathname]);

  // Keyboard navigation
  useEffect(() => {
    if (!active && !welcomeOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeTour();
      } else if (active) {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          next();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          prev();
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, welcomeOpen, index]);

  function startTour() {
    if (window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    setWelcomeOpen(false);
    setIndex(0);
    setActive(true);
  }

  function dismissWelcome() {
    setWelcomeOpen(false);
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, "dismissed");
    } catch {}
  }

  function closeTour() {
    setActive(false);
    setWelcomeOpen(false);
    setTargetBox(null);
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, "true");
    } catch {}
  }

  function next() {
    if (index < STEPS.length - 1) {
      setIndex(index + 1);
    } else {
      closeTour();
    }
  }

  function prev() {
    if (index > 0) {
      setIndex(index - 1);
    }
  }

  function navigateTo(path?: string) {
    if (path) {
      router.push(path);
    }
  }

  const step = STEPS[index];

  return (
    <>
      {/* ── First-Time Welcome Modal ────────────────────────────────────── */}
      {welcomeOpen && (
        <div className="tour-modal-backdrop">
          <div
            className="tour-welcome-panel panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-title"
          >
            <div className="tour-welcome-ticks" />
            <div className="eyebrow" style={{ color: "var(--ok)", letterSpacing: ".12em" }}>
              Welcome to Agent Studio
            </div>
            <h2 id="welcome-title" className="tour-welcome-title">
              Autonomous agents, built with real tools and real governance.
            </h2>
            <p className="tour-welcome-sub">
              New here? Take a quick 1-minute guided demo to get familiar with navigating the platform, building agents, and setting up guardrails.
            </p>

            <div className="tour-welcome-features">
              <div className="tour-wf-item">
                <span className="tour-wf-code mono">01</span>
                <div>
                  <strong>Agents, Swarms &amp; Automated Evals</strong>
                  <p className="sub-line">Compile briefs into specs, orchestrate supervisor swarms, schedule cron triggers, and benchmark regression suites.</p>
                </div>
              </div>
              <div className="tour-wf-item">
                <span className="tour-wf-code mono">02</span>
                <div>
                  <strong>Embedded Canvas Apps &amp; Bi-directional Bridge</strong>
                  <p className="sub-line">Run external and internal tools in split-view tabs with an active agent assistant and JS bridge SDK.</p>
                </div>
              </div>
              <div className="tour-wf-item">
                <span className="tour-wf-code mono">03</span>
                <div>
                  <strong>Enterprise Vault, OAuth &amp; MCP Superpowers</strong>
                  <p className="sub-line">Encrypted connections, 1-click OAuth 2.0, MCP auto-discovery, live heartbeats, and webhooks.</p>
                </div>
              </div>
              <div className="tour-wf-item">
                <span className="tour-wf-code mono">04</span>
                <div>
                  <strong>Human Governance, DLP Masking &amp; Audit Trail</strong>
                  <p className="sub-line">Consequential action approvals, PII redaction guardrails, spend caps, and tamper-resistant audit logs.</p>
                </div>
              </div>
            </div>

            <div className="tour-welcome-foot">
              <button className="btn" onClick={dismissWelcome}>
                Explore on my own
              </button>
              <button className="btn btn-primary" onClick={startTour} autoFocus>
                Start Guided Demo →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Active Tour Overlay & Spotlight ──────────────────────────────── */}
      {active && step && (
        <div className="tour-active-root">
          {/* Dark backdrop with click to exit */}
          <div className="tour-backdrop" onClick={closeTour} />

          {/* Glowing spotlight bracket around the target element */}
          {targetBox && (
            <div
              className="tour-spotlight"
              style={{
                top: `${targetBox.top}px`,
                left: `${targetBox.left}px`,
                width: `${targetBox.width}px`,
                height: `${targetBox.height}px`,
                opacity: targetBox.top + targetBox.height < 0 ? 0 : 1,
              }}
            >
              <span className="tour-bracket top-left" />
              <span className="tour-bracket top-right" />
              <span className="tour-bracket bottom-left" />
              <span className="tour-bracket bottom-right" />
            </div>
          )}

          {/* Floating Guidance Card */}
          <div
            ref={cardRef}
            className="tour-card panel"
            style={{
              top: `${cardPos.top}px`,
              left: `${cardPos.left}px`,
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tour-step-title"
          >
            {/* Header / progress */}
            <div className="tour-card-head">
              <div className="eyebrow" style={{ color: "var(--ok)", margin: 0 }}>
                {step.eyebrow}
              </div>
              <div className="tour-counter mono">
                {index + 1} <span className="dim">/ {STEPS.length}</span>
              </div>
            </div>

            {/* Title & Description */}
            <h3 id="tour-step-title" className="tour-card-title">
              {step.title}
            </h3>
            <p className="tour-card-desc">{step.description}</p>

            {/* Feature Highlights */}
            <div className="tour-highlights">
              {step.highlights.map((h, i) => (
                <div key={i} className="tour-hl-item">
                  <span className="tour-hl-bullet" />
                  <span>{h}</span>
                </div>
              ))}
            </div>

            {/* Interactive Section Action (if applicable) */}
            {step.path && (
              <div className="tour-jump-row">
                <button
                  className="btn btn-ghost tour-jump-btn"
                  onClick={() => navigateTo(step.path)}
                >
                  <span>{step.actionLabel || "Go to page"}</span>
                  <span className="mono">↗</span>
                </button>
              </div>
            )}

            {/* Navigation Foot */}
            <div className="tour-card-foot">
              <div className="tour-dots" role="tablist" aria-label="Tour progress">
                {STEPS.map((_, i) => (
                  <button
                    key={i}
                    className={`tour-dot ${i === index ? "active" : ""}`}
                    onClick={() => setIndex(i)}
                    aria-label={`Go to step ${i + 1}`}
                  />
                ))}
              </div>

              <div className="tour-nav-actions">
                <button
                  className="btn btn-ghost"
                  onClick={closeTour}
                  style={{ fontSize: 12, padding: "5px 9px" }}
                >
                  Skip
                </button>
                {index > 0 && (
                  <button
                    className="btn"
                    onClick={prev}
                    style={{ fontSize: 12, padding: "5px 12px" }}
                  >
                    Back
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  onClick={next}
                  style={{ fontSize: 12, padding: "5px 14px" }}
                >
                  {index === STEPS.length - 1 ? "Finish Tour" : "Next →"}
                </button>
              </div>
            </div>

            <div className="tour-keys-hint mono">
              <span>← / → keys navigate</span>
              <span>Esc to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
