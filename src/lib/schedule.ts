/**
 * Turns the plain-English schedule a person types into something a machine can
 * fire, and works out when it next falls due.
 *
 * The typed sentence stays the human record. This module derives a structured
 * schedule from it, and is explicit about the parts it could not honour — a
 * phrase like "once results are final" names an event no clock can detect, so
 * the cadence is scheduled and the qualifier is reported back as a caveat
 * rather than silently ignored.
 */

export type Freq = "daily" | "weekdays" | "weekly" | "monthly" | "quarterly";

export type Schedule = {
  freq: Freq;
  /** Local wall-clock time, "HH:MM". */
  time: string;
  /** 0 = Sunday … 6 = Saturday. Weekly only. */
  weekday?: number;
  /** Day of the month, or the nth day when workingDay is set. -1 means last. */
  day?: number;
  /** Count `day` in working days (Mon–Fri) rather than calendar days. */
  workingDay?: boolean;
};

export type ParseResult = {
  schedule: Schedule | null;
  /** What the parser could not honour, in plain language. Empty when exact. */
  caveat: string;
};

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, last: -1,
  "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5,
};
const DEFAULT_TIME = "08:00";

/* ── parsing ──────────────────────────────────────────────── */

export function parseSchedule(input: string): ParseResult {
  const raw = (input || "").trim();
  if (!raw) return { schedule: null, caveat: "" };
  const s = raw.toLowerCase();

  // Time of day, if one is stated.
  let time = DEFAULT_TIME;
  let timeStated = false;
  const t = s.match(/\b(?:at|by)\s+(\d{1,2})[:.](\d{2})\s*(am|pm)?/);
  if (t) {
    let h = Number(t[1]);
    const m = Number(t[2]);
    if (t[3] === "pm" && h < 12) h += 12;
    if (t[3] === "am" && h === 12) h = 0;
    if (h <= 23 && m <= 59) {
      time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      timeStated = true;
    }
  }

  const named = DAYS.findIndex((d) => new RegExp(`\\b${d}s?\\b`).test(s));
  let schedule: Schedule | null = null;

  if (/\bquarter(ly)?\b/.test(s)) {
    schedule = { freq: "quarterly", time, day: 1, workingDay: true };
  } else if (/\b(working day|weekday|business day)s?\b/.test(s) && /\bevery\b/.test(s) && !/\bmonth\b/.test(s)) {
    schedule = { freq: "weekdays", time };
  } else if (named >= 0) {
    schedule = { freq: "weekly", time, weekday: named };
  } else if (/\bmonth(ly)?\b/.test(s)) {
    const ord = s.match(/\b(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\b/);
    const dom = s.match(/\bon the (\d{1,2})(?:st|nd|rd|th)?\b/);
    const working = /\b(working|business) day\b/.test(s);
    schedule = {
      freq: "monthly",
      time,
      day: dom ? Number(dom[1]) : ord ? ORDINALS[ord[1]] : 1,
      workingDay: working || !dom,
    };
  } else if (/\bweek(ly)?\b/.test(s)) {
    schedule = { freq: "weekly", time, weekday: 1 };
  } else if (/\bday\b|\bdaily\b/.test(s)) {
    schedule = { freq: "daily", time };
  }

  if (!schedule) return { schedule: null, caveat: "" };

  // Anything left that names a human event rather than a clock.
  const bits: string[] = [];
  const cond = s.match(
    /\b(?:before|after|once|during|when)\b[^,.]*/g,
  );
  if (cond) bits.push(...cond.map((c) => c.trim()));
  if (!timeStated) bits.push(`no time of day was given, so ${DEFAULT_TIME} is used`);

  return {
    schedule,
    caveat: bits.length ? bits.join("; ") : "",
  };
}

/**
 * Warnings about running a spec unattended, independent of its cadence.
 * Shared by the app and by scripts/arm-schedules.mjs so the two cannot drift.
 */
export function unattendedNotes(spec: {
  inputs?: { label: string; key?: string }[];
  trigger?: { input?: string; inputs?: Record<string, string> };
}): string[] {
  const declared = spec.inputs || [];
  const values = spec.trigger?.inputs || {};
  const filled = declared.filter((i, idx) => {
    const key = i.key || String(i.label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `input_${idx + 1}`;
    return (values[key] ?? "").toString().trim() !== "";
  }).length;
  const needs = declared.length - filled;
  const standing = (spec.trigger?.input || "").trim();
  if (needs > 0 && !standing) {
    return [
      `this agent asks for ${needs} input${needs === 1 ? "" : "s"} at run time ` +
        `and a scheduled run has nobody to supply ${needs === 1 ? "it" : "them"} ` +
        `— set a standing input on the Schedule step`,
    ];
  }
  return [];
}

/* ── describing ───────────────────────────────────────────── */

const nth = (n: number) =>
  n === -1 ? "last" : ["", "first", "second", "third", "fourth", "fifth"][n] || `${n}th`;

export function describeSchedule(s: Schedule, tz: string): string {
  const at = `at ${s.time}`;
  switch (s.freq) {
    case "daily":
      return `Every day ${at} ${tz}`;
    case "weekdays":
      return `Every working day ${at} ${tz}`;
    case "weekly": {
      const d = DAYS[s.weekday ?? 1];
      return `Every ${d[0].toUpperCase()}${d.slice(1)} ${at} ${tz}`;
    }
    case "monthly":
      return `Monthly, on the ${nth(s.day ?? 1)} ${s.workingDay ? "working day" : "day"} ${at} ${tz}`;
    case "quarterly":
      return `Quarterly, on the ${nth(s.day ?? 1)} ${s.workingDay ? "working day" : "day"} of the quarter ${at} ${tz}`;
  }
}

/* ── timezone helpers ─────────────────────────────────────── */

/** Offset of `tz` from UTC, in ms, at the given instant. */
function tzOffset(at: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(at)) if (part.type !== "literal") p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUTC - at.getTime();
}

/** The instant at which the given wall-clock time occurs in `tz`. */
function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const o1 = tzOffset(new Date(guess), tz);
  let ts = guess - o1;
  const o2 = tzOffset(new Date(ts), tz);
  if (o2 !== o1) ts = guess - o2;
  return new Date(ts);
}

/** Calendar parts of an instant, as seen in `tz`. */
function partsIn(at: Date, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(at)) if (part.type !== "literal") p[part.type] = part.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, wd };
}

const isWorkingDay = (y: number, m: number, d: number) => {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd >= 1 && wd <= 5;
};

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The calendar day matching a monthly/quarterly day rule, or null. */
function dayForMonth(y: number, m: number, day: number, working: boolean): number | null {
  const last = daysInMonth(y, m);
  if (!working) return day === -1 ? last : day >= 1 && day <= last ? day : null;

  if (day === -1) {
    for (let d = last; d >= 1; d--) if (isWorkingDay(y, m, d)) return d;
    return null;
  }
  let seen = 0;
  for (let d = 1; d <= last; d++) {
    if (isWorkingDay(y, m, d)) {
      seen++;
      if (seen === day) return d;
    }
  }
  return null;
}

/* ── the next occurrence ──────────────────────────────────── */

/**
 * The first firing strictly after `from`. Returns null if the schedule can
 * never fire. Walks candidate local days forward, so daylight-saving shifts and
 * month lengths are handled by the calendar rather than by arithmetic.
 */
export function nextRun(s: Schedule, tz: string, from: Date = new Date()): Date | null {
  const [hh, mm] = s.time.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

  const start = partsIn(from, tz);
  let { y, m, d } = start;

  for (let i = 0; i < 800; i++) {
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    let matches = false;

    switch (s.freq) {
      case "daily":
        matches = true;
        break;
      case "weekdays":
        matches = wd >= 1 && wd <= 5;
        break;
      case "weekly":
        matches = wd === (s.weekday ?? 1);
        break;
      case "monthly":
        matches = dayForMonth(y, m, s.day ?? 1, !!s.workingDay) === d;
        break;
      case "quarterly":
        matches = m % 3 === 1 && dayForMonth(y, m, s.day ?? 1, !!s.workingDay) === d;
        break;
    }

    if (matches) {
      const at = zonedToUtc(y, m, d, hh, mm, tz);
      if (at.getTime() > from.getTime()) return at;
    }

    // step one local day
    const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
    y = nextDay.getUTCFullYear();
    m = nextDay.getUTCMonth() + 1;
    d = nextDay.getUTCDate();
  }
  return null;
}

/** Convenience: parse a sentence and say when it would next fire. */
export function planFrom(text: string, tz: string, from: Date = new Date()) {
  const { schedule, caveat } = parseSchedule(text);
  if (!schedule) return { schedule: null, caveat, next: null, description: "" };
  return {
    schedule,
    caveat,
    next: nextRun(schedule, tz, from),
    description: describeSchedule(schedule, tz),
  };
}
