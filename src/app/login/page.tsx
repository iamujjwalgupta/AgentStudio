"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", password: "", name: "", org: "" });
  // An invitation link lands here; sign-up then joins that workspace rather
  // than creating a new one, so the workspace name is not asked for.
  const [invite, setInvite] = useState("");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("invite");
    if (t) {
      setInvite(t);
      setMode("register");
    }
  }, []);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: mode, ...form, invite: invite || undefined }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(data.error || "Something went wrong.");
    router.push("/agents");
    router.refresh();
  };

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="eyebrow">Agent Studio</div>
        <h1>{mode === "login" ? "Sign in" : invite ? "Join the workspace" : "Create a workspace"}</h1>
        <p className="sub" style={{ fontSize: 13, marginBottom: 18 }}>
          {mode === "login"
            ? "Your agents, connections and audit trail live in your workspace."
            : "You will be the first admin. Invite the rest of your team afterwards."}
        </p>

        <div className="stack">
          {mode === "register" && !invite && (
            <>
              <label className="field">
                <span className="eyebrow">Your name</span>
                <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} />
              </label>
              <label className="field">
                <span className="eyebrow">Workspace name</span>
                <input className="input" value={form.org} onChange={(e) => set("org", e.target.value)} placeholder="Acme Operations" />
              </label>
            </>
          )}
          <label className="field">
            <span className="eyebrow">Email</span>
            <input className="input" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </label>
          <label className="field">
            <span className="eyebrow">Password</span>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>
        </div>

        {err && <div className="error mt">{err}</div>}

        <button className="btn primary mt" style={{ width: "100%" }} onClick={submit} disabled={busy}>
          {busy && <span className="spin" />}
          {mode === "login" ? "Sign in" : invite ? "Join workspace" : "Create workspace"}
        </button>

        <button
          className="btn mt-s"
          style={{ width: "100%", border: 0, background: "none", color: "var(--muted)" }}
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setErr(null);
          }}
        >
          {mode === "login" ? "No workspace yet? Create one" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
