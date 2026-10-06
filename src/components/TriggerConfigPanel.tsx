"use client";

import { useEffect, useState } from "react";
import { normaliseInputs, type AgentSpec } from "@/lib/types";
import { parseSchedule, planFrom, unattendedNotes, type Schedule } from "@/lib/schedule";
import { formatWhen } from "@/lib/format";
import { AlertIcon, CheckIcon, ClockIcon, CopyIcon, FormIcon, PlugIcon, RunIcon } from "@/components/agent-ui";

/**
 * The Schedule step: on demand, or on a repeating schedule picked with a day and
 * a time. The choices write the plain-English sentence the scheduler reads
 * (lib/schedule.ts), and only sentences it runs exactly are ever written.
 *
 * A schedule only fires for the published version, so a change made here takes
 * effect when the agent is next published.
 */

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_SHORT: Record<string, string> = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };
const ORD_WORD = ["", "first", "second", "third", "fourth", "fifth"];
const suffix = (n: number) => (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");

type Repeat = "daily" | "weekdays" | "weekly" | "monthly" | "quarterly";
/** For monthly: "5" is the 5th calendar day, "w1".."w5" the nth working day, "wl" the last working day. */
type Pick = { repeat: Repeat; weekday: string; monthDay: string; time: string };

const DEFAULT_PICK: Pick = { repeat: "weekly", weekday: "monday", monthDay: "w1", time: "09:00" };

function fromSchedule(s: Schedule | null): Pick | null {
  if (!s) return null;
  const base = { ...DEFAULT_PICK, time: s.time };
  if (s.freq === "daily" || s.freq === "weekdays" || s.freq === "quarterly") return { ...base, repeat: s.freq };
  // The parser numbers weekdays from Sunday.
  if (s.freq === "weekly") return { ...base, repeat: "weekly", weekday: WEEKDAYS[((s.weekday ?? 1) + 6) % 7] };
  const d = s.day ?? 1;
  return { ...base, repeat: "monthly", monthDay: s.workingDay ? (d === -1 ? "wl" : `w${d}`) : String(d) };
}

function toSentence(p: Pick): string {
  const at = `at ${p.time}`;
  switch (p.repeat) {
    case "daily":
      return `every day ${at}`;
    case "weekdays":
      return `every weekday ${at}`;
    case "weekly":
      return `every ${p.weekday} ${at}`;
    case "quarterly":
      return `quarterly ${at}`;
    case "monthly": {
      if (p.monthDay === "wl") return `last working day of the month ${at}`;
      if (p.monthDay.startsWith("w")) return `${ORD_WORD[Number(p.monthDay.slice(1))]} working day of the month ${at}`;
      const n = Number(p.monthDay);
      return `monthly on the ${n}${suffix(n)} ${at}`;
    }
  }
}

function describe(p: Pick): string {
  const time = p.time;
  switch (p.repeat) {
    case "daily":
      return `every day at ${time}`;
    case "weekdays":
      return `every working day (Mon–Fri) at ${time}`;
    case "weekly":
      return `every ${p.weekday[0].toUpperCase()}${p.weekday.slice(1)} at ${time}`;
    case "quarterly":
      return `on the first working day of each quarter at ${time}`;
    case "monthly": {
      if (p.monthDay === "wl") return `on the last working day of each month at ${time}`;
      if (p.monthDay.startsWith("w")) return `on the ${ORD_WORD[Number(p.monthDay.slice(1))]} working day of each month at ${time}`;
      const n = Number(p.monthDay);
      return `on the ${n}${suffix(n)} of each month at ${time}`;
    }
  }
}

export default function ScheduleStep({
  spec,
  set,
  agentId,
  timezone = "UTC",
  isLive,
  nextRunAt,
}: {
  spec: AgentSpec;
  set: (p: Partial<AgentSpec>) => void;
  agentId: string;
  timezone?: string;
  isLive: boolean;
  /** When the live version is next due, from the server. */
  nextRunAt: string | null;
}) {
  const [copied, setCopied] = useState<"" | "url" | "body">("");
  // A note for scheduled runs is rarely needed when there are no fields to fill, so it is tucked away until asked for.
  const [noteOpen, setNoteOpen] = useState(!!(spec.trigger.input || "").trim());
  const [origin, setOrigin] = useState("");
  const [docs, setDocs] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);

  // Event triggers were never wired to anything; an old spec holding one runs on demand.
  const type = spec.trigger.type === "schedule" ? "schedule" : "manual";
  const setTrigger = (patch: Partial<AgentSpec["trigger"]>) => set({ trigger: { ...spec.trigger, ...patch } });
  const text = spec.trigger.schedule || "";
  const parsed = parseSchedule(text).schedule;
  const pick = fromSchedule(parsed);
  const current = pick ?? DEFAULT_PICK;
  const unreadable = type === "schedule" && !!text.trim() && !parsed;
  const choose = (patch: Partial<Pick>) => setTrigger({ type: "schedule", schedule: toSentence({ ...current, ...patch }) });
  const plan = planFrom(toSentence(current), timezone);

  const inputs = normaliseInputs(spec.inputs as any[]);
  const standing = spec.trigger.inputs || {};
  const setStanding = (key: string, v: string) => setTrigger({ inputs: { ...standing, [key]: v } });
  const empty = inputs.filter((i) => !(standing[i.key] ?? "").trim());
  const missing = empty.filter((i) => i.required);
  const hasInstruction = !!(spec.trigger.input || "").trim();
  // The same test the scheduler's own warnings use (lib/schedule.ts): empty values with no standing instruction.
  const unattended = unattendedNotes({ inputs, trigger: spec.trigger }).length > 0;
  const endpoint = `${origin}/api/v1/agents/${agentId}/invoke`;
  // What a caller sends: the same fields the run form asks for (see /api/v1/agents/[id]/invoke).
  const exampleBody = JSON.stringify(
    {
      input: "What you would type in the run box",
      ...(inputs.length
        ? { inputs: Object.fromEntries(inputs.map((i) => [i.key, i.type === "file" ? "name-of-uploaded-document.pdf" : i.type === "number" ? 0 : i.type === "date" ? "2026-10-01" : (i.options ?? [])[0] ?? ""])) }
        : {}),
      dryRun: false,
    },
    null,
    2,
  );
  const copy = (what: "url" | "body", value: string) => {
    navigator.clipboard?.writeText(value);
    setCopied(what);
    setTimeout(() => setCopied(""), 1800);
  };

  // Uploaded documents, so a scheduled run can be pointed at a file by name.
  const hasFile = inputs.some((i) => i.type === "file");
  useEffect(() => {
    if (type !== "schedule" || !hasFile) return;
    let live = true;
    fetch("/api/documents")
      .then((r) => r.json())
      .then((j) => live && setDocs(Array.isArray(j.documents) ? j.documents : []))
      .catch(() => live && setDocs([]));
    return () => {
      live = false;
    };
  }, [type, hasFile]);

  return (
    <div className="ab-ins">
      <h2 className="ab-h">When it runs</h2>
      <p className="ab-lead">Run it by hand whenever it is needed, or let it run on its own on a day and time you pick.</p>

      <section className="ab-sec">
        <div className="ab-choices" style={{ marginBottom: type === "schedule" ? 18 : 0 }}>
          <button type="button" className={`ab-choice ${type === "manual" ? "on" : ""}`} onClick={() => setTrigger({ type: "manual" })}>
            <span className="ic"><RunIcon /></span>
            <span>
              <b>On demand</b>
              <span>Someone clicks Run, or another system calls it.</span>
            </span>
          </button>
          <button
            type="button"
            className={`ab-choice ${type === "schedule" ? "on" : ""}`}
            onClick={() => setTrigger({ type: "schedule", schedule: parsed ? text : toSentence(DEFAULT_PICK) })}
          >
            <span className="ic"><ClockIcon /></span>
            <span>
              <b>On a schedule</b>
              <span>Runs by itself on the day and time you pick.</span>
            </span>
          </button>
        </div>

        {type === "schedule" && (
          <>
            {unreadable && (
              <div className="ab-hint warn">
                <AlertIcon />
                <span className="grow">The current schedule “{text}” cannot be run. Pick a day and time below to replace it.</span>
              </div>
            )}

            <div className="ab-sched">
              <label className="ab-field">
                <span className="ab-label">Repeats</span>
                <select className="input" value={current.repeat} onChange={(e) => choose({ repeat: e.target.value as Repeat })}>
                  <option value="daily">Every day</option>
                  <option value="weekdays">Every working day (Mon–Fri)</option>
                  <option value="weekly">Every week</option>
                  <option value="monthly">Every month</option>
                  {current.repeat === "quarterly" && <option value="quarterly">Every quarter</option>}
                </select>
              </label>

              {current.repeat === "weekly" && (
                <div className="ab-field">
                  <span className="ab-label">Day</span>
                  <div className="ab-days" role="radiogroup" aria-label="Day of the week">
                    {WEEKDAYS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        role="radio"
                        aria-checked={current.weekday === d}
                        className={current.weekday === d ? "on" : ""}
                        onClick={() => choose({ weekday: d })}
                      >
                        {DAY_SHORT[d]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {current.repeat === "monthly" && (
                <label className="ab-field">
                  <span className="ab-label">Day of the month</span>
                  <select className="input" value={current.monthDay} onChange={(e) => choose({ monthDay: e.target.value })}>
                    <option value="w1">First working day</option>
                    {/* An existing "second working day" and the like stays selectable. */}
                    {["w2", "w3", "w4", "w5"].includes(current.monthDay) && (
                      <option value={current.monthDay}>{`${ORD_WORD[Number(current.monthDay.slice(1))][0].toUpperCase()}${ORD_WORD[Number(current.monthDay.slice(1))].slice(1)} working day`}</option>
                    )}
                    <option value="wl">Last working day</option>
                    <optgroup label="A date">
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={String(n)}>{`${n}${suffix(n)}`}</option>
                      ))}
                    </optgroup>
                  </select>
                </label>
              )}

              <label className="ab-field">
                <span className="ab-label">Time</span>
                <span className="ab-time">
                  <input
                    type="time"
                    value={current.time}
                    onChange={(e) => e.target.value && choose({ time: e.target.value })}
                    aria-label="Time of day"
                  />
                </span>
              </label>
            </div>

            <div className={`ab-next ${plan.next ? "" : "paused"}`} style={{ marginTop: 14, marginBottom: 0 }}>
              <span>
                <strong>
                  <CheckIcon size={13} /> Runs {describe(current)} ({timezone}).
                </strong>
                {isLive && nextRunAt
                  ? `Next run: ${formatWhen(nextRunAt, timezone)}. Changes here take effect when you publish them.`
                  : plan.next
                    ? `Once published, the first run would be ${formatWhen(plan.next, timezone)}.`
                    : ""}
              </span>
            </div>
            {!isLive && (
              <p className="sub-line" style={{ margin: "8px 0 0" }}>
                A schedule only starts once the agent is published. If a scheduled run fails, the workspace owner and approvers are emailed.
              </p>
            )}

            {/* Agents without run inputs rarely need a note, so it waits behind a link. */}
            {inputs.length === 0 &&
              (noteOpen ? (
                <label className="ab-field" style={{ marginTop: 14 }}>
                  <span className="ab-label">Note for each scheduled run <em>— optional</em></span>
                  <textarea
                    className="textarea"
                    rows={2}
                    autoFocus={!spec.trigger.input}
                    placeholder="e.g. Cover the week that has just ended."
                    value={spec.trigger.input || ""}
                    onChange={(e) => setTrigger({ input: e.target.value })}
                  />
                </label>
              ) : (
                <button type="button" className="ab-tl-addbtn" style={{ marginTop: 8, paddingLeft: 0 }} onClick={() => setNoteOpen(true)}>
                  + Add a note for each scheduled run
                </button>
              ))}
          </>
        )}

        {type === "manual" &&
          (agentId ? (
            <div className="ab-api">
              <div className="ab-api-head">
                <span className="ab-sec-ic"><PlugIcon size={16} /></span>
                <div className="grow">
                  <b>Call it from another system</b>
                  <span>
                    Start this agent with one HTTPS request, made while signed in to this workspace. It runs the live version, or the
                    draft until one is published.
                  </span>
                </div>
                <a className="ab-link" href={`/api/v1/agents/${agentId}/invoke`} target="_blank" rel="noreferrer">API description ↗</a>
              </div>
              <div className="ab-api-url">
                <span className="ab-method">POST</span>
                <code title={endpoint}>{endpoint}</code>
                <button type="button" className="ab-copy" onClick={() => copy("url", endpoint)}>
                  {copied === "url" ? <><CheckIcon size={13} /> Copied</> : <><CopyIcon size={13} /> Copy</>}
                </button>
              </div>
              <details className="ab-api-ex">
                <summary>Example request body</summary>
                <div className="ab-api-pre">
                  <pre>{exampleBody}</pre>
                  <button type="button" className="ab-copy" onClick={() => copy("body", exampleBody)}>
                    {copied === "body" ? <><CheckIcon size={13} /> Copied</> : <><CopyIcon size={13} /> Copy</>}
                  </button>
                </div>
                <p className="sub-line" style={{ margin: "8px 0 0" }}>
                  <code>inputs</code> takes the same fields as the run form; <code>dryRun: true</code> rehearses without carrying out
                  approval-gated actions.
                </p>
              </details>
            </div>
          ) : (
            <p className="sub-line" style={{ margin: "14px 0 0" }}>Once the agent is saved, other systems can also start it through its API address.</p>
          ))}
      </section>

      {/* Only agents with a run form need values for runs nobody attends. */}
      {type === "schedule" && inputs.length > 0 && (
        <section className="ab-sec">
          <header className="ab-sec-head">
            <span className="ab-sec-ic"><FormIcon size={17} /></span>
            <div className="grow">
              <h3>Values for scheduled runs</h3>
              <p>Nobody is there to fill in the run form, so set what each scheduled run should use.</p>
            </div>
            {inputs.length > 0 && (
              <span className={`ab-pill ${missing.length || unattended ? "warn" : ""}`}>
                {missing.length
                  ? `${missing.length} required ${missing.length === 1 ? "value" : "values"} missing`
                  : empty.length && !hasInstruction
                    ? `${inputs.length - empty.length} of ${inputs.length} filled`
                    : "All set"}
              </span>
            )}
          </header>

          {inputs.length > 0 && (
            <div className="ab-standing">
              {inputs.map((i) => {
                const v = standing[i.key] ?? "";
                return (
                  <label key={i.key} className="ab-field">
                    <span className="ab-label">
                      {i.label || i.key}
                      {i.required && <em> — required</em>}
                    </span>
                    {i.type === "choice" ? (
                      <select className="input" value={v} onChange={(e) => setStanding(i.key, e.target.value)}>
                        <option value="">Choose…</option>
                        {(i.options ?? []).map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    ) : i.type === "date" ? (
                      <input className="input" type="date" value={v} onChange={(e) => setStanding(i.key, e.target.value)} />
                    ) : i.type === "number" ? (
                      <input className="input" type="number" value={v} placeholder={i.hint} onChange={(e) => setStanding(i.key, e.target.value)} />
                    ) : i.type === "longtext" ? (
                      <textarea className="textarea" rows={2} value={v} placeholder={i.hint} onChange={(e) => setStanding(i.key, e.target.value)} />
                    ) : i.type === "file" ? (
                      docs && docs.length > 0 ? (
                        <select className="input" value={v} onChange={(e) => setStanding(i.key, e.target.value)}>
                          <option value="">Choose an uploaded document…</option>
                          {v && !docs.some((d) => d.name === v) && <option value={v}>{v}</option>}
                          {docs.map((d) => (
                            <option key={d.id} value={d.name}>{d.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input className="input" value={v} placeholder="The name of an uploaded document" onChange={(e) => setStanding(i.key, e.target.value)} />
                      )
                    ) : (
                      <input className="input" value={v} placeholder={i.hint} onChange={(e) => setStanding(i.key, e.target.value)} />
                    )}
                  </label>
                );
              })}
            </div>
          )}

          {noteOpen ? (
            <label className="ab-field" style={{ marginTop: 14 }}>
              <span className="ab-label">Note for each scheduled run <em>— optional</em></span>
              <textarea
                className="textarea"
                rows={2}
                autoFocus={!spec.trigger.input}
                placeholder="e.g. Cover the week that has just ended."
                value={spec.trigger.input || ""}
                onChange={(e) => setTrigger({ input: e.target.value })}
              />
            </label>
          ) : (
            <button type="button" className="ab-tl-addbtn" style={{ marginTop: 8, paddingLeft: 0 }} onClick={() => setNoteOpen(true)}>
              + Add a note for each scheduled run
            </button>
          )}
          {(missing.length > 0 || unattended) && (
            <div className="ab-hint warn" style={{ marginTop: 10, marginBottom: 0 }}>
              <AlertIcon />
              <span className="grow">
                {missing.length
                  ? `Fill in ${missing.map((i) => i.label || i.key).join(", ")}. Without ${missing.length === 1 ? "it" : "them"}, each scheduled run is told the value was not supplied.`
                  : "Some fields have no value and there is no note, so scheduled runs would work without them. Fill them in, or add a note."}
              </span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
