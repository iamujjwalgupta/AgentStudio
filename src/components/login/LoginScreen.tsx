"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import AgentConstellation from "./AgentConstellation";

type Mode = "login" | "register";
type Invite = { token: string; valid: boolean | null; email?: string; org?: string; invitedBy?: string };

const WORDS = ["agent.", "analyst.", "reviewer.", "assistant."];

export default function LoginScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [form, setForm] = useState({ email: "", password: "", name: "", org: "" });
  const [invite, setInvite] = useState<Invite | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [caps, setCaps] = useState(false);
  const panel = useRef<HTMLElement>(null);

  // An invitation link lands here: sign-up then joins that workspace instead of
  // creating one, and the page says which workspace and who sent it.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite");
    if (!token) return;
    setMode("register");
    setInvite({ token, valid: null });
    fetch(`/api/auth?invite=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((j) => {
        setInvite({ token, valid: Boolean(j.valid), email: j.email, org: j.org, invitedBy: j.invitedBy });
        if (j.valid && j.email) setForm((f) => ({ ...f, email: j.email }));
      })
      .catch(() => setInvite({ token, valid: null }));
  }, []);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const joining = Boolean(invite && invite.valid !== false);
  const creating = mode === "register" && !joining;

  const switchMode = (m: Mode) => {
    setMode(m);
    setErr(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || done) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: mode,
          ...form,
          invite: mode === "register" && joining ? invite?.token : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "Something went wrong. Please try again.");
        setShaking(true);
        setBusy(false);
        return;
      }
      setDone(true);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setTimeout(() => {
        router.push("/agents");
        router.refresh();
      }, reduce ? 0 : 900);
    } catch {
      setErr("Could not reach Agent Studio. Check your connection and try again.");
      setShaking(true);
      setBusy(false);
    }
  };

  // A soft light that follows the pointer across the form side.
  const onPanelMove = (e: React.PointerEvent) => {
    const r = panel.current?.getBoundingClientRect();
    if (!r) return;
    panel.current!.style.setProperty("--mx", `${e.clientX - r.left}px`);
    panel.current!.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  const title =
    mode === "login"
      ? "Welcome back"
      : joining
        ? invite?.org
          ? `Join ${invite.org}`
          : "Join the workspace"
        : "Create your workspace";
  const sub =
    mode === "login"
      ? "Sign in to your workspace: your agents, approvals and audit trail."
      : joining
        ? invite?.invitedBy
          ? `${invite.invitedBy} invited you. Create your account to accept.`
          : "Create your account to accept the invitation."
        : "You'll be its first admin, and can invite your team afterwards.";

  return (
    <div className={`lg${done ? " lg-done" : ""}`}>
      <section className="lg-hero" aria-label="About Agent Studio">
        <div className="lg-aurora" aria-hidden="true"><i /><i /><i /></div>
        <div className="lg-floor" aria-hidden="true" />
        <AgentConstellation className="lg-canvas" />
        <div className="lg-vignette" aria-hidden="true" />

        <header className="lg-brand lg-in" style={{ ["--d" as any]: "0ms" }}>
          <span className="lg-logo"><Spark /></span>
          <span>Agent Studio</span>
        </header>

        <div className="lg-copy">
          <div className="lg-kicker lg-in" style={{ ["--d" as any]: "120ms" }}>
            <span className="lg-pulse" /> Governed AI agents for enterprise teams
          </div>
          <h1 className="lg-in" style={{ ["--d" as any]: "220ms" }}>
            Describe the work in plain language.
            <br />
            Publish it as a governed <Rotator words={WORDS} />
          </h1>
          <p className="lg-in" style={{ ["--d" as any]: "340ms" }}>
            Agents that query your systems, draft the deliverable, and wait for a person before anything leaves the building.
          </p>
        </div>

        <RunStrip />

        <ul className="lg-trust lg-in" style={{ ["--d" as any]: "640ms" }}>
          <li><Shield /> Actions wait for approval</li>
          <li><Trail /> Every step in the audit trail</li>
          <li><Gauge /> Usage limits per workspace</li>
        </ul>
      </section>

      <main className="lg-side" ref={panel} onPointerMove={onPanelMove}>
        <div className="lg-mobile-brand" aria-hidden="true">
          <span className="lg-logo"><Spark /></span> Agent Studio
        </div>

        <div className={`lg-card${shaking ? " lg-shake" : ""}`} onAnimationEnd={(e) => e.animationName === "lg-shake" && setShaking(false)}>
          {!joining && (
            <div className="lg-tabs" role="tablist" aria-label="Sign in or create a workspace">
              <span className={`lg-thumb${mode === "register" ? " right" : ""}`} aria-hidden="true" />
              <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "on" : ""} onClick={() => switchMode("login")}>
                Sign in
              </button>
              <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "on" : ""} onClick={() => switchMode("register")}>
                Create workspace
              </button>
            </div>
          )}

          {invite && mode === "register" && (
            <div className={`lg-invite${invite.valid === false ? " bad" : ""}`}>
              {invite.valid === false
                ? "This invitation is no longer valid. Ask for a new one, or create your own workspace below."
                : invite.valid === null
                  ? "Checking your invitation…"
                  : <>You&apos;re joining <b>{invite.org}</b>{invite.invitedBy ? <> at the invitation of <b>{invite.invitedBy}</b></> : null}.</>}
            </div>
          )}

          <h2 className="lg-title" key={title}>{title}</h2>
          <p className="lg-sub">{sub}</p>

          <form onSubmit={submit} noValidate>
            <div className={`lg-extra${creating ? " open" : ""}`} aria-hidden={!creating}>
              <div>
                <Field label="Your name" value={form.name} onChange={(v) => set("name", v)} autoComplete="name" tabIndex={creating ? 0 : -1} icon={<Person />} />
                <Field label="Workspace name" value={form.org} onChange={(v) => set("org", v)} autoComplete="organization" tabIndex={creating ? 0 : -1} icon={<Building />} hint="Your team or company, e.g. Acme Finance" />
              </div>
            </div>

            <Field
              label="Work email"
              type="email"
              value={form.email}
              onChange={(v) => set("email", v)}
              autoComplete="email"
              icon={<Mail />}
              readOnly={mode === "register" && joining && Boolean(invite?.email)}
              hint={mode === "register" && joining && invite?.email ? "The invitation was sent to this address." : undefined}
            />
            <Field
              label="Password"
              type={showPw ? "text" : "password"}
              value={form.password}
              onChange={(v) => set("password", v)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              icon={<Lock />}
              onKey={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
              after={
                <button type="button" className="lg-eye" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? "Hide password" : "Show password"}>
                  {showPw ? <EyeOff /> : <Eye />}
                </button>
              }
            />
            {caps && <div className="lg-caps">Caps Lock is on</div>}
            {mode === "register" && <Strength value={form.password} />}

            <div className="lg-err" role="alert" aria-live="assertive">
              {err && <span>{err}</span>}
            </div>

            <button className={`lg-submit${busy ? " busy" : ""}${done ? " ok" : ""}`} type="submit" disabled={busy || done}>
              <span className="lg-submit-label">
                {done ? (
                  <><Check /> {mode === "login" ? "Signed in" : "Workspace ready"}</>
                ) : busy ? (
                  <><span className="lg-spin" /> {mode === "login" ? "Signing in…" : "Setting up…"}</>
                ) : (
                  <>{mode === "login" ? "Sign in" : joining ? "Join workspace" : "Create workspace"} <Arrow /></>
                )}
              </span>
            </button>
          </form>

          {!joining && (
            <p className="lg-switch">
              {mode === "login" ? "New to Agent Studio?" : "Already have an account?"}{" "}
              <button type="button" onClick={() => switchMode(mode === "login" ? "register" : "login")}>
                {mode === "login" ? "Create a workspace" : "Sign in"}
              </button>
            </p>
          )}
          {joining && (
            <p className="lg-switch">
              Already have an account?{" "}
              <button type="button" onClick={() => { setInvite(null); switchMode("login"); }}>Sign in instead</button>
            </p>
          )}
        </div>

        <footer className="lg-foot">
          <span><Lock /> Signed, HTTP-only session</span>
          <span>Sign-in locks for 5 minutes after 5 failed tries</span>
          <span>Every sign-in is recorded in the audit trail</span>
        </footer>
      </main>

      <div className="lg-warp" aria-hidden="true" />
    </div>
  );
}

// ---- pieces ---------------------------------------------------------------------------

function Field({
  label, value, onChange, type = "text", autoComplete, icon, after, hint, readOnly, tabIndex, onKey,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  icon?: ReactNode;
  after?: ReactNode;
  hint?: string;
  readOnly?: boolean;
  tabIndex?: number;
  onKey?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className={`lg-field${value ? " filled" : ""}${readOnly ? " locked" : ""}`}>
      <span className="lg-ico">{icon}</span>
      <input
        type={type}
        value={value}
        placeholder=" "
        autoComplete={autoComplete}
        readOnly={readOnly}
        tabIndex={tabIndex}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onKeyUp={onKey}
      />
      <span className="lg-label">{label}</span>
      {after}
      <span className="lg-ring" aria-hidden="true" />
      {hint && <small className="lg-hint">{hint}</small>}
    </label>
  );
}

/** What the server asks for (8+ characters), and a little encouragement beyond it. */
function Strength({ value }: { value: string }) {
  const score = !value
    ? 0
    : value.length < 8
      ? 1
      : 1 + [value.length >= 12, /[a-z]/.test(value) && /[A-Z]/.test(value), /\d/.test(value) && /[^A-Za-z0-9]/.test(value)].filter(Boolean).length;
  const words = ["At least 8 characters", "Too short", "Fair", "Good", "Strong"];
  return (
    <div className={`lg-strength s${score}`} aria-live="polite">
      <div className="lg-bars">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= score ? "on" : ""} />)}</div>
      <span>{words[score]}</span>
    </div>
  );
}

function Rotator({ words }: { words: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setI((n) => (n + 1) % words.length), 2600);
    return () => clearInterval(id);
  }, [words.length]);
  return (
    <span className="lg-rot" aria-label={words[0]}>
      <span className="lg-rot-sizer" aria-hidden="true">{words.reduce((a, b) => (b.length > a.length ? b : a))}</span>
      {words.map((w, n) => (
        <span key={w} className={`lg-rot-word${n === i ? " on" : n === (i + words.length - 1) % words.length ? " out" : ""}`} aria-hidden="true">
          {w}
        </span>
      ))}
    </span>
  );
}

type St = "idle" | "run" | "done" | "wait" | "ok";
const STEPS = [
  { label: "Read the brief", detail: "Vendor spend review, September" },
  { label: "Query a database", detail: "Finance DB · 1,284 rows" },
  { label: "Search the web", detail: "3 sources cited" },
  { label: "Send an email", detail: "To the finance leads" },
  { label: "Write the deliverable", detail: "spend-review.md" },
];
const FRAMES: St[][] = [
  ["run", "idle", "idle", "idle", "idle"],
  ["done", "run", "idle", "idle", "idle"],
  ["done", "done", "run", "idle", "idle"],
  ["done", "done", "done", "run", "idle"],
  ["done", "done", "done", "wait", "idle"],
  ["done", "done", "done", "wait", "idle"],
  ["done", "done", "done", "ok", "run"],
  ["done", "done", "done", "ok", "done"],
  ["done", "done", "done", "ok", "done"],
  ["done", "done", "done", "ok", "done"],
];

/**
 * An example run, playing on a loop in one slim line along the bottom, so it
 * never covers the network: the steps tick through, the email waits for a
 * person, is approved, and the run completes.
 */
function RunStrip() {
  const [f, setF] = useState(7);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setF(0);
    const id = setInterval(() => setF((n) => (n + 1) % FRAMES.length), 1300);
    return () => clearInterval(id);
  }, []);
  const st = FRAMES[f];
  const waiting = st.includes("wait");
  const finished = st.every((s) => s === "done" || s === "ok");
  const active = st.findIndex((s) => s === "run" || s === "wait");
  const now = finished
    ? "Deliverable ready · spend-review.md"
    : waiting
      ? `${STEPS[active].label} · held for a finance lead`
      : `${STEPS[active].label} · ${STEPS[active].detail}`;
  const state = waiting ? "wait" : finished ? "ok" : "";

  return (
    <div className="lg-strip lg-in" style={{ ["--d" as any]: "480ms" }} aria-hidden="true">
      <span className="lg-strip-tag">Example run</span>
      <b className="lg-strip-name">Vendor spend review</b>
      <span className="lg-strip-steps">
        {st.map((s, i) => (
          <i key={i} className={s} title={STEPS[i].label} />
        ))}
      </span>
      <span key={now} className={`lg-strip-now ${state}`}>
        {waiting ? <Hand /> : finished ? <Check /> : <span className="lg-step-spin" />}
        <span className="lg-strip-txt">{now}</span>
      </span>
      <span className={`lg-run-state ${state}`}>{waiting ? "Waiting for approval" : finished ? "Completed" : "Running"}</span>
    </div>
  );
}

// ---- icons ------------------------------------------------------------------------------

const I = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const Spark = () => <I size={18}><path d="M12 3l2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z" /></I>;
const Mail = () => <I><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M4 7l8 6 8-6" /></I>;
const Lock = () => <I><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></I>;
const Person = () => <I><circle cx="12" cy="8" r="3.6" /><path d="M5 20c1.2-3.6 4-5.2 7-5.2s5.8 1.6 7 5.2" /></I>;
const Building = () => <I><rect x="5" y="3.5" width="14" height="17" rx="1.5" /><path d="M9 8h2M13 8h2M9 12h2M13 12h2M10 20.5v-4h4v4" /></I>;
const Eye = () => <I><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></I>;
const EyeOff = () => <I><path d="M3 3l18 18M10.6 6.1A9.9 9.9 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.1 3.8M6.3 7.6A16.6 16.6 0 0 0 2.5 12s3.5 6.5 9.5 6.5a9.4 9.4 0 0 0 4.3-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></I>;
const Arrow = () => <I><path d="M5 12h14M13 6l6 6-6 6" /></I>;
const Check = () => <I><path d="M5 12.5l4.5 4.5L19 7.5" /></I>;
const Hand = () => <I><path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-6.5V5a1.5 1.5 0 0 1 3 0v7m0-5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.6-2.2L4.6 15a1.6 1.6 0 0 1 2.4-2l1 1" /></I>;
const Shield = () => <I><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z" /><path d="M8.8 12l2.2 2.2 4.2-4.4" /></I>;
const Trail = () => <I><path d="M5 5h14M5 12h14M5 19h9" /><circle cx="19" cy="19" r="1.6" /></I>;
const Gauge = () => <I><path d="M4 16a8 8 0 1 1 16 0" /><path d="M12 16l4-5" /><circle cx="12" cy="16" r="1.3" /></I>;
