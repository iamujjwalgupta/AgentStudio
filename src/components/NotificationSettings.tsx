"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/format";

type Delivery = {
  event: string;
  channel: string;
  recipient: string;
  subject: string;
  status: string;
  detail: string;
  created_at: string;
};

/** Which events the workspace hears about, where, and whether they arrived. */
export default function NotificationSettings() {
  const [timezone, setTimezone] = useState("UTC");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<Record<string, string[]>>({});
  const [available, setAvailable] = useState({ email: false, slack: false });
  const [recent, setRecent] = useState<Delivery[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // Mirrors the defaults in src/lib/notify.ts.
  const DEFAULTS: Record<string, string[]> = {
    approval_waiting: ["email", "slack"],
    run_failed: ["email", "slack"],
    share_received: ["email"],
    invitation: ["email"],
    spend_cap: ["email", "slack"],
  };

  async function load() {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error("Notification settings could not be loaded.");
      const j = await res.json();
      setLabels(j.labels ?? {});
      setSettings(Object.keys(j.settings ?? {}).length ? j.settings : DEFAULTS);
      setAvailable(j.available ?? { email: false, slack: false });
      setRecent(j.recent ?? []);
      setCanEdit(Boolean(j.canEdit));
      setTimezone(j.timezone || "UTC");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function toggle(event: string, channel: string) {
    const current = settings[event] ?? [];
    const next = current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel];
    setSettings({ ...settings, [event]: next });
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Settings could not be saved.");
      setSaved(true);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Notifications</h2>
      <p className="help">
        The app tells people what needs them, using the email and Slack connections above. A delivery that fails is
        recorded and never affects the thing it was reporting.
      </p>

      {!available.email && !available.slack && (
        <div className="note" style={{ marginBottom: 12 }}>
          No email or Slack connection yet, so nothing can be delivered. Add one above and these settings take effect.
        </div>
      )}

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="table">
        <div className="tr th" style={{ gridTemplateColumns: "1fr 110px 110px" }}>
          <div>When this happens</div>
          <div>Email</div>
          <div>Slack</div>
        </div>
        {Object.entries(labels).map(([event, label]) => (
          <div className="tr" key={event} style={{ gridTemplateColumns: "1fr 110px 110px" }}>
            <div>{label}</div>
            {["email", "slack"].map((ch) => (
              <div key={ch}>
                <label className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={(settings[event] ?? []).includes(ch)}
                    onChange={() => toggle(event, ch)}
                  />
                  <span className="sub-line">
                    {available[ch as "email" | "slack"] ? "on" : "no connection"}
                  </span>
                </label>
              </div>
            ))}
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="panel-foot">
          <span className="sub-line">{saved ? "Saved." : ""}</span>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save notifications"}
          </button>
        </div>
      )}

      {recent.length > 0 && (
        <>
          <div className="eyebrow mt">Recent deliveries</div>
          <div className="table" style={{ marginTop: 8 }}>
            {recent.map((d, i) => (
              <div className="tr" key={i} style={{ gridTemplateColumns: "1.6fr 1fr 130px 90px" }}>
                <div>
                  <div className="name">{d.subject || d.event}</div>
                  {d.detail && <div className="sub-line">{d.detail}</div>}
                </div>
                <div className="sub-line mono">{d.recipient || "—"}</div>
                <div className="mono dim">{formatDateTime(d.created_at, timezone)}</div>
                <div>
                  <span className={`pill ${d.status === "sent" ? "green" : d.status === "failed" ? "amber" : "grey"}`}>
                    {d.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
