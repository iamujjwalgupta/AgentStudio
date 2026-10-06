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

/**
 * One stop per sidebar link, top to bottom, in the sidebar's groups. Every
 * sentence describes what the product does today — the tour is the first thing
 * a new person reads, so it must not promise features that are not there.
 */
const STEPS: TourStep[] = [
  {
    id: "brand",
    target: "brand",
    eyebrow: "Welcome",
    title: "Welcome to Agent Studio",
    description:
      "Build AI agents that do real work with your own systems and data, with people deciding the risky steps. This tour walks through the sidebar, top to bottom.",
    highlights: [
      "Describe a job in plain words; it becomes an agent you can review and edit",
      "Agents reach your systems only through connections you grant",
      "Anything risky waits for a person to approve it",
    ],
  },
  {
    id: "agents",
    target: "agents",
    eyebrow: "Build",
    path: "/agents",
    actionLabel: "Open Agents",
    title: "Agents",
    description:
      "Each agent is a job written down: what it is for, the steps it follows, the actions it may take and when it runs. Drafts are safe to change; publishing makes a version live.",
    highlights: [
      "Start from a short brief, then review the steps, inputs and actions it produces",
      "Choose which actions need a person's approval before they happen",
      "Run by hand, on a schedule, from another system, or as part of a team",
    ],
  },
  {
    id: "skills",
    target: "skills",
    eyebrow: "Build",
    path: "/skills",
    actionLabel: "Open Skills",
    title: "Skills",
    description:
      "Write down how your team does a piece of work once, and attach it to any agent. An agent reads a skill only when the task in front of it calls for it.",
    highlights: [
      "Draft a skill from a short description, then edit it",
      "See which agents use each skill",
      "Turn a reviewer's correction into a skill straight from Approvals",
    ],
  },
  {
    id: "connections",
    target: "connections",
    eyebrow: "Build",
    path: "/connections",
    actionLabel: "Open Connections",
    title: "Connections",
    description:
      "The systems agents can reach — databases, APIs, email, Slack, Teams, Jira, GitHub, S3 — and your Anthropic and Gemini keys. Secrets are stored encrypted.",
    highlights: [
      "Test a connection before an agent depends on it",
      "See which agents use each connection, and what needs fixing",
      "An agent only uses the connections it has been given",
    ],
  },
  {
    id: "sandbox",
    target: "sandbox",
    eyebrow: "Build",
    path: "/sandbox",
    actionLabel: "Open the Sandbox",
    title: "Sandbox",
    description:
      "Bring in an agent built with Google ADK, LangChain, OpenAI Agents or Palantir Foundry. See what it does, test it with a real model, and add it as a draft.",
    highlights: [
      "The framework is detected automatically; each tool is matched to an Agent Studio action",
      "Tests pause at every tool call so you supply the result — nothing real is called",
      "Adds the agent as a draft, listing the connections it still needs",
    ],
  },
  {
    id: "apps",
    target: "apps",
    eyebrow: "Work",
    path: "/apps",
    actionLabel: "Open Apps",
    title: "Apps",
    description:
      "Open your team's web apps and dashboards inside Agent Studio, next to your agents.",
    highlights: [
      "Each app loads the way it is set up — via Agent Studio, directly, or sandboxed",
      "Ask an agent about the app you are looking at",
      "Apps that add the bridge script can share what is on screen and ask for approvals",
    ],
  },
  {
    id: "approvals",
    target: "approvals",
    eyebrow: "Work",
    path: "/approvals",
    actionLabel: "Open Approvals",
    title: "Approvals",
    description:
      "When an agent reaches an action that needs a decision — sending an email, changing data — it pauses here until someone decides.",
    highlights: [
      "See exactly what would be sent or changed, not raw data",
      "Approve to let it happen; reject with a note and the agent carries on without it",
      "Where possible, someone other than the person who started the run decides",
    ],
  },
  {
    id: "runs",
    target: "runs",
    eyebrow: "Work",
    path: "/runs",
    actionLabel: "Open Runs",
    title: "Runs",
    description:
      "Every time an agent ran: what it was asked, each step it took, what it produced and what it cost.",
    highlights: [
      "Filter by agent, status, trigger and period",
      "Follow a run live as each step finishes",
      "Copy or download the deliverable",
    ],
  },
  {
    id: "usage",
    target: "usage",
    eyebrow: "Oversee",
    path: "/usage",
    actionLabel: "Open Usage & limits",
    title: "Usage & limits",
    description:
      "Every model call on the Anthropic and Gemini keys is counted. Set limits in tokens or dollars, per month or per day, on a key or on one agent.",
    highlights: [
      "Tokens and cost by key, agent, feature, person and model",
      "At a limit, new model calls stop; owner and admins are told at 80% and 100%",
      "A month-end projection and a CSV export",
    ],
  },
  {
    id: "audit",
    target: "audit",
    eyebrow: "Oversee",
    path: "/audit",
    actionLabel: "Open the Audit trail",
    title: "Audit trail",
    description:
      "Who did what, and when — every change to agents, skills and connections, every run, publish, approval and sign-in. Nothing in it can be edited.",
    highlights: [
      "Search and filter by person, category and period",
      "Open any event for its details and that item's history",
      "Export what you have filtered as CSV",
    ],
  },
  {
    id: "members",
    target: "members",
    eyebrow: "Workspace",
    path: "/members",
    actionLabel: "Open Members",
    title: "Members",
    description: "Who is in this workspace and what each person may do.",
    highlights: [
      "Invite people by email as an admin, builder or approver",
      "See exactly what each role can do",
      "Only the owner can change roles or remove people",
    ],
  },
  {
    id: "shares",
    target: "shares",
    eyebrow: "Workspace",
    path: "/shares",
    actionLabel: "Open Shares",
    title: "Shares",
    description: "Send an agent to someone in another workspace, or accept one sent to you.",
    highlights: [
      "It arrives as a draft copy — connections and credentials are never sent",
      "Nothing is added until the recipient accepts",
      "The sender can withdraw a share until it is accepted",
    ],
  },
  {
    id: "foot",
    target: "foot",
    eyebrow: "That's it",
    title: "You're ready",
    description: "Who you are signed in as, and this tour — relaunch it any time from Guided Demo.",
    highlights: [
      "Switch workspace from the card at the top of the sidebar",
      "Shrink the sidebar to icons with the arrow button beside the name",
      "Use ← and → to move through the tour, and Esc to close it",
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
  const [steps, setSteps] = useState<TourStep[]>(STEPS);
  const visibleSteps = () =>
    typeof document === "undefined" ? STEPS : STEPS.filter((s) => document.querySelector(`[data-tour="${s.target}"]`));

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
      setSteps(visibleSteps());
      setIndex(0);
      setActive(true);
    };

    window.addEventListener(START_TOUR_EVENT, handleStart);
    return () => window.removeEventListener(START_TOUR_EVENT, handleStart);
  }, []);

  // Measure and position spotlight and card
  const measure = useCallback(() => {
    if (!active) return;
    const step = steps[index];
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
  }, [active, index, steps]);

  // Scroll target element into view and smoothly track position
  useEffect(() => {
    if (!active) return;
    const step = steps[index];
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
  }, [active, index, measure, steps]);

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
  }, [active, welcomeOpen, index, steps]);

  function startTour() {
    if (window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    setWelcomeOpen(false);
    setSteps(visibleSteps());
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
    if (index < steps.length - 1) {
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

  const step = steps[index];

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
              Agents that do real work — with people in control.
            </h2>
            <p className="tour-welcome-sub">
              New here? A one-minute tour walks through the sidebar and what each part is for.
            </p>

            <div className="tour-welcome-features">
              {[
                ["Build", "Describe a job in plain words, review the steps and actions it produces, and publish when it is right."],
                ["Connect", "Give agents your databases, APIs, email and messaging — secrets are stored encrypted."],
                ["Control", "Risky actions wait for a person's approval, and usage limits cap model spend."],
                ["Oversee", "Every run, step, cost and decision is recorded, and nothing in the audit trail can be edited."],
              ].map(([t, d], i) => (
                <div key={t} className="tour-wf-item">
                  <span className="tour-wf-code mono">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{t}</strong>
                    <p className="sub-line">{d}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="tour-welcome-foot">
              <button className="btn" onClick={dismissWelcome}>
                Explore on my own
              </button>
              <button className="btn btn-primary" onClick={startTour} autoFocus>
                Take the tour →
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
                {index + 1} <span className="dim">of {steps.length}</span>
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
                {steps.map((st, i) => (
                  <button
                    key={st.id}
                    className={`tour-dot ${i === index ? "active" : ""} ${i < index ? "done" : ""}`}
                    onClick={() => setIndex(i)}
                    aria-label={`Go to ${st.title}`}
                    title={st.title}
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
                  {index === steps.length - 1 ? "Finish" : "Next →"}
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
