/**
 * An agent's result as structured content rather than prose: headline numbers,
 * charts, tables, findings and actions. One shape, rendered four ways — the
 * dashboard in the app, an Excel workbook, a PDF report and a PowerPoint deck —
 * so every form shows the same figures.
 *
 * Pure data and formatting only: imported by the browser as well as the server.
 */

export type Fmt = "currency" | "number" | "integer" | "percent" | "date" | "text";
export type Tone = "good" | "bad" | "warn" | "neutral";

export type Kpi = { label: string; value: number | string | null; format?: Fmt; tone?: Tone; note?: string };
export type ChartKind = "bar" | "line" | "donut";
export type Chart = {
  title: string;
  kind: ChartKind;
  categories: string[];
  series: { name: string; values: number[] }[];
  format?: Fmt;
  note?: string;
};
export type Column = { key: string; label: string; format?: Fmt };
export type Table = { title: string; columns: Column[]; rows: Record<string, any>[]; note?: string; truncated?: number };
export type Finding = { tone: Tone; title: string; detail?: string };
export type Action = { text: string; owner?: string };

export type Deliverable = {
  title: string;
  subtitle?: string;
  summary?: string;
  currency: string;
  kpis: Kpi[];
  charts: Chart[];
  tables: Table[];
  findings: Finding[];
  actions: Action[];
  /** Where the figures came from, for the footer: connection and file names. */
  sources: string[];
  generatedAt: string;
};

export const TABLE_ROW_CAP = 500;
export const CHART_CATEGORY_CAP = 40;

const FMTS: Fmt[] = ["currency", "number", "integer", "percent", "date", "text"];
const TONES: Tone[] = ["good", "bad", "warn", "neutral"];
export const asFmt = (f: any): Fmt | undefined => (FMTS.includes(f) ? f : undefined);
export const asTone = (t: any): Tone => (TONES.includes(t) ? t : "neutral");

/** "vendor_bank_last_4" → "Vendor bank last 4". */
export function humanize(key: string): string {
  const s = String(key).replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
}

/** A sensible format for a column from its name and values, when none is given. */
export function guessFormat(key: string, values: any[]): Fmt {
  // "Duplicate invoice ID" and duplicate_invoice_id alike.
  const k = key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const sample = values.filter((v) => v !== null && v !== undefined && v !== "").slice(0, 25);
  const numeric = sample.length > 0 && sample.every((v) => typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())));
  if (/(^|_)(id|no|number|code|ref|reference)$/.test(k) || /(^|_)(gstin|pan|iban)/.test(k)) return "text";
  if (sample.length && sample.every((v) => v instanceof Date || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T|$)/.test(v)))) return "date";
  if (!numeric) return "text";
  if (/(amount|value|total|inr|usd|cost|price|balance|paid|held|outstanding|spend|revenue|tax|gst)/.test(k)) return "currency";
  if (/(percent|pct|rate|ratio|share)/.test(k)) return "percent";
  return sample.every((v) => Number.isInteger(Number(v))) ? "integer" : "number";
}

const toNumber = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,₹$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Indian grouping for INR (₹26,20,731.13), international otherwise. */
export function formatValue(v: any, fmt: Fmt | undefined, currency = "INR"): string {
  if (v === null || v === undefined || v === "") return "—";
  const locale = currency === "INR" ? "en-IN" : "en-US";
  switch (fmt) {
    case "currency": {
      const n = toNumber(v);
      if (n === null) return String(v);
      return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    }
    case "number": {
      const n = toNumber(v);
      return n === null ? String(v) : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
    }
    case "integer": {
      const n = toNumber(v);
      return n === null ? String(v) : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
    }
    case "percent": {
      const n = toNumber(v);
      if (n === null) return String(v);
      // A ratio (0.42) and a percentage (42) are both common; values within ±1 read as ratios.
      const pct = Math.abs(n) <= 1 ? n * 100 : n;
      return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(pct)}%`;
    }
    case "date": {
      const d = v instanceof Date ? v : new Date(String(v));
      if (Number.isNaN(d.getTime())) return String(v);
      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
    }
    default:
      return v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  }
}

/** Compact form for chart axes and labels: ₹26.2L, ₹4.6Cr, 1.2K. */
export function formatCompact(v: number, fmt: Fmt | undefined, currency = "INR"): string {
  if (!Number.isFinite(v)) return "";
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  const sym = fmt === "currency" ? (currency === "INR" ? "₹" : currency === "USD" ? "$" : "") : "";
  if (fmt === "percent") return formatValue(v, "percent", currency);
  let s: string;
  if (currency === "INR" && fmt === "currency") {
    s = a >= 1e7 ? `${(a / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr` : a >= 1e5 ? `${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : a.toFixed(0);
  } else {
    s = a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : `${Math.round(a * 100) / 100}`;
  }
  return `${sign}${sym}${s.replace(/\.0(?=[A-Za-z]|$)/, "")}`;
}

/**
 * Brings stored or model-supplied content into the shape above: drops empty or
 * malformed parts, caps sizes, fills formats. Never throws on odd input.
 */
export function normalizeDeliverable(raw: any): Deliverable {
  const r = raw && typeof raw === "object" ? raw : {};
  const str = (v: any, max = 400) => (v === null || v === undefined ? "" : String(v)).slice(0, max).trim();
  const kpis: Kpi[] = (Array.isArray(r.kpis) ? r.kpis : [])
    .filter((k: any) => k && str(k.label))
    .slice(0, 8)
    .map((k: any) => ({
      label: str(k.label, 80),
      value: k.value === undefined ? null : typeof k.value === "number" ? k.value : k.value === null ? null : str(k.value, 80),
      format: asFmt(k.format) ?? (typeof k.value === "number" ? "number" : "text"),
      tone: asTone(k.tone),
      ...(str(k.note) ? { note: str(k.note, 160) } : {}),
    }));
  const charts: Chart[] = (Array.isArray(r.charts) ? r.charts : [])
    .filter((c: any) => c && Array.isArray(c.categories) && Array.isArray(c.series) && c.series.length)
    .slice(0, 6)
    .map((c: any) => {
      const categories = c.categories.slice(0, CHART_CATEGORY_CAP).map((x: any) => str(x, 60));
      return {
        title: str(c.title, 120) || "Chart",
        kind: (["bar", "line", "donut"].includes(c.kind) ? c.kind : "bar") as ChartKind,
        categories,
        series: c.series.slice(0, 5).map((s: any) => ({
          name: str(s?.name, 60) || "Value",
          values: categories.map((_: any, i: number) => toNumber(s?.values?.[i]) ?? 0),
        })),
        format: asFmt(c.format) ?? "number",
        ...(str(c.note) ? { note: str(c.note, 200) } : {}),
      };
    });
  const tables: Table[] = (Array.isArray(r.tables) ? r.tables : [])
    .filter((t: any) => t && Array.isArray(t.rows))
    .slice(0, 8)
    .map((t: any) => {
      const rows = t.rows.slice(0, TABLE_ROW_CAP).map((row: any) => (row && typeof row === "object" ? row : {}));
      const keys: string[] =
        Array.isArray(t.columns) && t.columns.length
          ? t.columns.map((c: any) => str(c?.key ?? c, 80)).filter(Boolean)
          : [...new Set(rows.flatMap((row: any) => Object.keys(row)))].map(String);
      const given = new Map((Array.isArray(t.columns) ? t.columns : []).map((c: any) => [str(c?.key ?? c, 80), c]));
      const columns: Column[] = keys.slice(0, 16).map((key) => {
        const c: any = given.get(key) || {};
        return { key, label: str(c.label, 80) || humanize(key), format: asFmt(c.format) ?? guessFormat(key, rows.map((row: any) => row[key])) };
      });
      return {
        title: str(t.title, 120) || "Table",
        columns,
        rows,
        ...(str(t.note) ? { note: str(t.note, 300) } : {}),
        ...(Number(t.truncated) > 0 ? { truncated: Number(t.truncated) } : t.rows.length > TABLE_ROW_CAP ? { truncated: t.rows.length } : {}),
      };
    });
  return {
    title: str(r.title, 140) || "Result",
    ...(str(r.subtitle) ? { subtitle: str(r.subtitle, 200) } : {}),
    ...(str(r.summary) ? { summary: str(r.summary, 1500) } : {}),
    currency: /^[A-Z]{3}$/.test(str(r.currency)) ? str(r.currency) : "INR",
    kpis,
    charts,
    tables,
    findings: (Array.isArray(r.findings) ? r.findings : [])
      .filter((f: any) => f && str(f.title))
      .slice(0, 12)
      .map((f: any) => ({ tone: asTone(f.tone), title: str(f.title, 200), ...(str(f.detail) ? { detail: str(f.detail, 600) } : {}) })),
    actions: (Array.isArray(r.actions) ? r.actions : [])
      .filter((a: any) => a && str(a.text ?? a))
      .slice(0, 12)
      .map((a: any) => ({ text: str(a.text ?? a, 300), ...(str(a.owner) ? { owner: str(a.owner, 80) } : {}) })),
    sources: (Array.isArray(r.sources) ? r.sources : []).map((s: any) => str(s, 120)).filter(Boolean).slice(0, 6),
    generatedAt: str(r.generatedAt, 40) || new Date().toISOString(),
  };
}

/** A safe file name from the title: "AP payment run check — 7 Oct" → "AP-payment-run-check-7-Oct". */
export function fileBase(d: Pick<Deliverable, "title">): string {
  return (d.title || "result").replace(/[^\w\- ]+/g, " ").trim().replace(/\s+/g, "-").slice(0, 80) || "result";
}
