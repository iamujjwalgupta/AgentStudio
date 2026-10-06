import fs from "fs/promises";
import path from "path";
import Papa from "papaparse";
import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import { q } from "./db";
import { storedPath } from "./storage";
import { normaliseInputs, type AgentSpec } from "./types";

/**
 * SQL over uploaded files, with no database behind them.
 *
 * Each query gets a fresh in-memory DuckDB with the run's CSV files loaded as
 * tables, typed (amounts as exact decimals, dates as dates) so an agent can
 * join and total them without casting every column. The engine is sealed: no
 * file system, no network, settings locked, a memory cap, and a time limit
 * that interrupts a runaway query rather than letting it hold the server.
 * Nothing it does outlives the call.
 */

const QUERY_MS = 20_000;
const MAX_ROWS_PER_FILE = 200_000;

type ColType = "VARCHAR" | "BIGINT" | "DECIMAL(18,2)" | "DOUBLE" | "DATE";
export type FileColumn = { name: string; header: string; type: ColType; note?: string };
export type FileTable = {
  table: string;
  file: string;
  input?: string;
  /** For a workbook: the sheet the table came from, and the other sheets it has. */
  sheet?: string;
  otherSheets?: string[];
  /** Lines above and below the table (bank name, account, period, opening balance, summary). */
  notesAbove?: string[];
  notesBelow?: string[];
  columns: FileColumn[];
  rows: (string | null)[][];
};

/* ── reading values the way finance files write them ──────── */

// Identifiers stay text whatever they look like: "004512" is a cheque number, not 4512.
// A name that ends in an identifier word (bill_no, chq_ref_no, document_number) or is one.
const ID_NAME =
  /(^|_)(no|num|nbr|number|id|ref|reference|code|utr|gstin|pan|ifsc|hsn|sac|mobile|phone|pincode)$|^(cheque|chq|invoice|inv|voucher|vch|document|doc|account|acct|instrument|bill)$/;
const MONEY_NAME = /(amount|amt|value|debit|credit|withdrawal|deposit|balance|tax|igst|cgst|sgst|cess|total|taxable|price|cost|paid|tds|gst|net|gross|^dr$|^cr$)/;
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** "₹1,25,000.50", "Rs. 1,250", "(2,500.00)", "-300" → "125000.50" etc.; null when not a number. */
function asNumber(raw: string): string | null {
  let s = raw.trim().replace(/^(₹|rs\.?|inr)\s*/i, "").replace(/\s*(₹|inr)$/i, "").replace(/\s+/g, "");
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/^-/.test(s)) {
    neg = !neg;
    s = s.slice(1);
  }
  // Grouping commas only where grouping commas go (Indian or international).
  if (!/^(\d{1,3}(,\d{2})*,\d{3}|\d{1,3}(,\d{3})*|\d+)(\.\d+)?$/.test(s)) return null;
  s = s.replace(/,/g, "");
  return (neg && Number(s) !== 0 ? "-" : "") + s;
}

type DateOrder = "dmy" | "mdy";
const pad = (n: number) => String(n).padStart(2, "0");
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
function validDate(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}
/** ISO, 05/09/2026, 05-09-26, 05.09.2026, 05-Sep-2026, 5 Sep 2026, Sep 5, 2026. Day first unless told otherwise. */
function asDate(raw: string, order: DateOrder): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  if (m) return order === "dmy" ? validDate(year(m[3]), +m[2], +m[1]) : validDate(year(m[3]), +m[1], +m[2]);
  m = s.match(/^(\d{1,2})[\s\-/]([A-Za-z]{3,9})[\s\-/,]+(\d{2}|\d{4})$/);
  if (m && MONTHS[m[2].slice(0, 4).toLowerCase()] !== undefined) return validDate(year(m[3]), MONTHS[m[2].slice(0, 4).toLowerCase()], +m[1]);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return validDate(year(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return validDate(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  return null;
}

/** A column's type from all its values, and its values in the form that type loads from. */
function typeColumn(name: string, values: string[]): { type: ColType; out: (string | null)[]; note?: string } {
  const present = values.map((v) => (v ?? "").trim());
  const filled = present.filter((v) => v !== "");
  const text = { type: "VARCHAR" as ColType, out: present.map((v) => (v === "" ? null : v)) };
  if (!filled.length) return text;

  // Dates: day first, as Indian files write them, unless a value proves otherwise.
  const slashed = filled.filter((v) => /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(v));
  const order: DateOrder = slashed.some((v) => Number(v.split(/[/.\-]/)[1]) > 12) && !slashed.some((v) => Number(v.split(/[/.\-]/)[0]) > 12) ? "mdy" : "dmy";
  if (filled.every((v) => asDate(v, order))) {
    const note = slashed.length ? (order === "dmy" ? "read as day/month/year" : "read as month/day/year") : undefined;
    return { type: "DATE", out: present.map((v) => (v === "" ? null : asDate(v, order))), ...(note ? { note } : {}) };
  }
  if (ID_NAME.test(name)) return text;

  const nums = filled.map(asNumber);
  if (nums.every((n) => n !== null)) {
    const decimals = Math.max(...nums.map((n) => (n!.includes(".") ? n!.split(".")[1].length : 0)));
    const out = present.map((v) => (v === "" ? null : asNumber(v)));
    const leadingZero = filled.some((v) => /^0\d/.test(v));
    if (leadingZero) return text;
    const reformatted = filled.some((v) => /[,₹()]|rs/i.test(v));
    const note = reformatted ? "amounts with commas, ₹ or brackets read as numbers" : undefined;
    if (decimals === 0 && !MONEY_NAME.test(name)) return { type: "BIGINT", out, ...(note ? { note } : {}) };
    if (decimals <= 2) return { type: "DECIMAL(18,2)", out, ...(note ? { note } : {}) };
    return { type: "DOUBLE", out, ...(note ? { note } : {}) };
  }
  return text;
}

/** Lower case, letters, digits and underscores; never starting with a digit; unique. */
function sqlNames(headers: string[], reserved: string[] = []): string[] {
  const seen = new Set<string>(reserved);
  return headers.map((h, i) => {
    let s = h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `column_${i + 1}`;
    if (/^[0-9]/.test(s)) s = `c_${s}`;
    let u = s;
    for (let n = 2; seen.has(u); n++) u = `${s}_${n}`;
    seen.add(u);
    return u;
  });
}

/* ── which files a run has ────────────────────────────────── */

async function documentByName(orgId: string, name: string) {
  const docs = await q<any>(`select id, name, path from documents where org_id = $1 order by created_at desc limit 200`, [orgId]);
  const doc = docs.find((d) => d.id === name || d.name === name || d.name.toLowerCase() === String(name).toLowerCase());
  if (!doc) throw new Error(`No uploaded file named "${name}". Uploaded: ${docs.slice(0, 20).map((d) => d.name).join(", ") || "none"}`);
  return doc;
}

const TABLE_EXTS = [".csv", ".tsv", ".txt", ".xlsx"];
const MAX_WORKBOOK_BYTES = 20 * 1024 * 1024;

async function parseFile(orgId: string, name: string, table: string, input?: string): Promise<FileTable> {
  const doc = await documentByName(orgId, name);
  const ext = path.extname(doc.name).toLowerCase();
  if (!TABLE_EXTS.includes(ext)) {
    throw new Error(`"${doc.name}" is not a CSV or Excel (.xlsx) file, so it cannot be queried. Read it with the document tool instead.`);
  }
  const t = await readTableFile(storedPath(doc.path), doc.name, table);
  return { ...t, ...(input ? { input } : {}) };
}

/** A CSV or Excel file on disk as a typed table. */
export async function readTableFile(filePath: string, file: string, table: string): Promise<FileTable> {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".xlsx") {
    const buf = await fs.readFile(filePath);
    return { ...tableFromGrid(await gridFromXlsx(buf, file), table, file) };
  }
  return tableFromCsv(await fs.readFile(filePath, "utf8"), table, file, ext === ".tsv");
}

/** A CSV's text as a typed table. */
export function tableFromCsv(raw: string, table: string, file: string, tabs = false): FileTable {
  const text = raw.replace(/^\uFEFF/, "").trim();
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy", delimiter: tabs ? "\t" : "" });
  return tableFromGrid({ rows: parsed.data.map((r) => r.map((c) => String(c ?? ""))) }, table, file);
}

export type Grid = { rows: string[][]; sheet?: string; otherSheets?: string[] };

/**
 * The cells of a workbook's main sheet (the one with the most filled rows) as
 * text: dates as YYYY-MM-DD, numbers as plain digits, formulas as their result.
 */
export async function gridFromXlsx(buf: Buffer, file: string): Promise<Grid> {
  if (buf.length > MAX_WORKBOOK_BYTES) throw new Error(`"${file}" is larger than 20 MB; export the sheet as CSV instead.`);
  if (buf.subarray(0, 2).toString("latin1") !== "PK") {
    throw new Error(`"${file}" is not an .xlsx workbook. Old .xls files cannot be read: open it in Excel and save it as .xlsx or CSV.`);
  }
  const ExcelJS: any = (await import("exceljs")).default ?? (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheets: { name: string; rows: string[][]; filled: number }[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== "visible") continue;
    const rows: string[][] = [];
    let filled = 0;
    ws.eachRow({ includeEmpty: true }, (row: any, n: number) => {
      const cells: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) cells.push(cellText(row.getCell(c).value));
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      rows[n - 1] = cells;
      if (cells.some(Boolean)) filled++;
      if (rows.length > MAX_ROWS_PER_FILE + 200) throw new Error(`"${file}" has more than ${MAX_ROWS_PER_FILE} rows on one sheet.`);
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    sheets.push({ name: ws.name, rows, filled });
  }
  const main = [...sheets].sort((a, b) => b.filled - a.filled)[0];
  if (!main || !main.filled) throw new Error(`"${file}" has no data on any sheet.`);
  return { rows: main.rows, sheet: main.name, otherSheets: sheets.filter((x) => x !== main && x.filled).map((x) => x.name) };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
function cellText(v: any): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    // A number in a cell formatted as a date (an amount under a date column's
    // format) reads as a date thousands of years out: give back the number.
    const y = v.getUTCFullYear();
    if (y < 1900 || y > 2200) return cellText(Math.round(((v.getTime() - Date.UTC(1899, 11, 30)) / 86400000) * 1e6) / 1e6);
    const d = `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`;
    const t = v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds() ? ` ${pad2(v.getUTCHours())}:${pad2(v.getUTCMinutes())}:${pad2(v.getUTCSeconds())}` : "";
    return d + t;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    const s = String(v);
    return /e/i.test(s) ? v.toFixed(10).replace(/\.?0+$/, "") : s;
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text ?? "").join("").trim();
  if ("result" in v) return cellText(v.result);
  if ("text" in v) return cellText(v.text);
  if ("error" in v) return "";
  return String(v).trim();
}

const isBlank = (r: string[]) => !r.some((c) => String(c ?? "").trim());
const width = (r: string[]) => r.filter((c) => String(c ?? "").trim()).length;
// "*******", "-----", "=====": rule lines some exports put around the table.
const isRule = (r: string[]) => !isBlank(r) && r.every((c) => !String(c ?? "").trim() || /^[\s*\-=_.~]+$/.test(String(c)));
const looksLikeValue = (c: string) => asNumber(c) !== null || asDate(c, "dmy") !== null;

/**
 * Finds the table in a grid: exports often put a title, the account, the period
 * and an opening balance above the column headings, and a summary below the
 * rows. The heading row is the first wide row of labels with data under it;
 * what is above and below is kept as notes.
 */
export function tableFromGrid(grid: Grid, table: string, file: string): FileTable {
  const all = grid.rows;
  const widest = Math.max(0, ...all.map(width));
  if (!widest) throw new Error(`"${file}" is empty.`);
  const need = Math.max(2, Math.ceil(widest * 0.6));
  let h = all.findIndex(
    (r, i) =>
      i < 60 &&
      width(r) >= need &&
      r.every((c) => !String(c ?? "").trim() || !looksLikeValue(String(c))) &&
      all.slice(i + 1, i + 5).some((n) => width(n) >= Math.max(2, Math.ceil(widest * 0.5))),
  );
  if (h < 0) h = 0;

  const headers = all[h].map((x) => String(x ?? "").trim());
  // Data runs from under the headings to the first blank line; rule lines are skipped.
  let i = h + 1;
  while (i < all.length && (isBlank(all[i]) || isRule(all[i]))) i++;
  const body: string[][] = [];
  for (; i < all.length && !isBlank(all[i]); i++) if (!isRule(all[i])) body.push(all[i]);
  const below = all.slice(i);
  // Short trailing rows (a "Total" line, a count) are summary, not data.
  const half = Math.max(2, Math.ceil(widest * 0.5));
  while (body.length > 1 && width(body[body.length - 1]) < half) below.unshift(body.pop()!);

  const cols = Math.max(headers.length, ...body.map((r) => r.length));
  while (headers.length < cols) headers.push("");
  // Columns empty in the heading and in every row are dropped; others without a heading get one.
  const keep = headers.map((hd, c) => Boolean(hd) || body.some((r) => String(r[c] ?? "").trim()));
  const kept = headers.map((hd, c) => ({ hd: hd || `column_${c + 1}`, c })).filter((x) => keep[x.c]);
  if (!kept.length) throw new Error(`"${file}" has no header row.`);
  if (body.length > MAX_ROWS_PER_FILE) throw new Error(`"${file}" has ${body.length} rows; files over ${MAX_ROWS_PER_FILE} rows cannot be queried.`);

  const names = sqlNames(kept.map((k) => k.hd), ["row_no"]);
  const typed = kept.map((k, j) => typeColumn(names[j], body.map((r) => String(r[k.c] ?? ""))));
  const note = (rows: string[][]) =>
    rows
      .filter((r) => !isBlank(r) && !isRule(r))
      .slice(0, 20)
      .map((r) => r.map((c) => String(c ?? "").trim()).filter(Boolean).join(" | "));
  const above = note(all.slice(0, h));
  const after = note(below);
  return {
    table,
    file,
    ...(grid.sheet ? { sheet: grid.sheet } : {}),
    ...(grid.otherSheets?.length ? { otherSheets: grid.otherSheets } : {}),
    ...(above.length ? { notesAbove: above } : {}),
    ...(after.length ? { notesBelow: after } : {}),
    columns: names.map((n, j) => ({ name: n, header: kept[j].hd, type: typed[j].type, ...(typed[j].note ? { note: typed[j].note } : {}) })),
    rows: body.map((_, r) => typed.map((t) => t.out[r])),
  };
}

/**
 * The files a run was given, by input: the table for "Bank statement" is
 * bank_statement. Named files are added under a name made from the file name.
 */
export async function runFiles(ctx: { orgId: string; runId?: string }, extra: string[] = []): Promise<FileTable[]> {
  const out: FileTable[] = [];
  const used = new Set<string>();
  if (ctx.runId) {
    const run = (await q<any>(`select spec, inputs from runs where id = $1 and org_id = $2`, [ctx.runId, ctx.orgId]))[0];
    const spec: AgentSpec | undefined = run?.spec;
    const values: Record<string, string> = run?.inputs || {};
    for (const i of normaliseInputs((spec?.inputs as any[]) || []).filter((x) => x.type === "file")) {
      const v = String(values[i.key] ?? "").trim();
      if (!v) continue;
      const [table] = sqlNames([i.key], [...used]);
      used.add(table);
      out.push(await parseFile(ctx.orgId, v, table, i.label));
    }
  }
  for (const name of extra) {
    if (out.some((t) => t.file.toLowerCase() === name.toLowerCase())) continue;
    const [table] = sqlNames([path.basename(name, path.extname(name))], [...used]);
    used.add(table);
    out.push(await parseFile(ctx.orgId, name, table));
  }
  return out;
}

/* ── the engine ───────────────────────────────────────────── */

export type SavedView = { name: string; sql: string };

export type FileSession = {
  tables: FileTable[];
  /** Saved views that could not be recreated, with why. */
  viewErrors: string[];
  /** One SELECT (or WITH … SELECT), capped at `limit` rows. */
  select: (sql: string, limit: number) => Promise<{ fields: string[]; rows: Record<string, any>[] }>;
  close: () => void;
};

const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

/*
 * The engine runs in a child process. DuckDB stops a running query when asked,
 * but not one stuck before it runs (planning a join across many stacked views
 * can take forever), and that would hold a core of the server for good. A child
 * can always be killed. It gets no environment beyond what Node needs to start,
 * so nothing secret is within its reach.
 */
const CHILD = String.raw`
const { createRequire } = require("module");
const { DuckDBInstance } = createRequire(process.cwd() + "/package.json")("@duckdb/node-api");
const quote = (s) => '"' + String(s).replace(/"/g, '""') + '"';
let con;
process.on("disconnect", () => process.exit(0));
process.on("message", async (m) => {
  try {
    if (m.op === "init") {
      const inst = await DuckDBInstance.create(":memory:", {
        memory_limit: "512MB", threads: "2", enable_external_access: "false",
        autoinstall_known_extensions: "false", autoload_known_extensions: "false", lock_configuration: "true",
      });
      con = await inst.connect();
      for (const t of m.tables) {
        // Loaded as text, then cast once into the typed table the agent sees.
        const stage = "__load_" + t.table;
        await con.run("create table " + quote(stage) + " (row_no integer, " + t.columns.map((c) => quote(c.name) + " varchar").join(", ") + ")");
        const app = await con.createAppender(stage);
        t.rows.forEach((row, r) => {
          app.appendInteger(r + 1);
          for (const v of row) (v === null ? app.appendNull() : app.appendVarchar(v));
          app.endRow();
        });
        app.closeSync();
        await con.run("create table " + quote(t.table) + " as select row_no, " +
          t.columns.map((c) => "cast(" + quote(c.name) + " as " + c.type + ") as " + quote(c.name)).join(", ") +
          " from " + quote(stage) + " order by row_no");
        await con.run("drop table " + quote(stage));
      }
      // The agent's saved steps, in the order they were saved, so one may build on another.
      const viewErrors = [];
      for (const v of m.views) {
        try { await con.run("create or replace view " + quote(v.name) + " as " + v.sql); }
        catch (e) { viewErrors.push(v.name + ": " + String(e && e.message || e).replace(/^(\w+ )?Error: /, "").split("\n")[0]); }
      }
      process.send({ id: m.id, viewErrors });
    } else if (m.op === "select") {
      const r = await con.runAndReadAll(m.sql);
      process.send({ id: m.id, fields: r.columnNames(), rows: r.getRowObjectsJson() });
    }
  } catch (e) {
    process.send({ id: m.id, error: String(e && e.message || e).replace(/^(\w+ )?Error: /, "") });
  }
});
process.send({ ready: true });
`;

type Child = { proc: ChildProcess; ready: Promise<void> };
let spare: Child | null = null;
let spareTimer: ReturnType<typeof setTimeout> | null = null;

function spawnChild(): Child {
  const env: Record<string, string> = {};
  for (const k of ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE"]) if (process.env[k]) env[k] = process.env[k]!;
  const options: SpawnOptions = { cwd: process.cwd(), env: env as NodeJS.ProcessEnv, stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true };
  const proc: ChildProcess = spawn(process.execPath, ["-e", CHILD], options);
  proc.stderr?.resume();
  const ready = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("The file query engine did not start.")), 20_000);
    proc.once("message", () => {
      clearTimeout(t);
      resolve();
    });
    proc.once("exit", () => reject(new Error("The file query engine stopped while starting.")));
  });
  ready.catch(() => {});
  return { proc, ready };
}

/** A started engine: the warm spare if there is one, and a new spare behind it. */
function takeChild(): Child {
  const c = spare && spare.proc.exitCode === null && !spare.proc.killed ? spare : spawnChild();
  c.proc.ref();
  (c.proc.channel as any)?.ref?.();
  spare = spawnChild();
  // Waiting is not work: an idle spare does not keep the process alive.
  spare.proc.unref();
  (spare.proc.channel as any)?.unref?.();
  if (spareTimer) clearTimeout(spareTimer);
  // An idle spare is let go after a few minutes.
  spareTimer = setTimeout(() => {
    spare?.proc.kill();
    spare = null;
  }, 5 * 60_000);
  spareTimer.unref?.();
  return c;
}

function ask(c: Child, msg: any, ms: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const onMessage = (m: any) => {
      if (m?.id !== id) return;
      done();
      m.error ? reject(new Error(m.error)) : resolve(m);
    };
    const onExit = () => {
      done();
      reject(new Error("The file query engine stopped."));
    };
    const timer = setTimeout(() => {
      done();
      c.proc.kill();
      reject(Object.assign(new Error("timeout"), { timeout: true }));
    }, ms);
    const done = () => {
      clearTimeout(timer);
      c.proc.off("message", onMessage);
      c.proc.off("exit", onExit);
    };
    c.proc.on("message", onMessage);
    c.proc.on("exit", onExit);
    c.proc.send({ ...msg, id });
  });
}

export async function openFileSession(tables: FileTable[], views: SavedView[] = []): Promise<FileSession> {
  if (!tables.length) throw new Error("This run has no uploaded CSV files to query.");
  const init = {
    op: "init",
    tables: tables.map((t) => ({ table: t.table, columns: t.columns.map((c) => ({ name: c.name, type: c.type })), rows: t.rows })),
    views: views.map((v) => ({ name: v.name, sql: v.sql })),
  };
  let child: Child | null = null;
  let viewErrors: string[] = [];
  // Started on open, and again after a query had to be stopped.
  const start = async () => {
    child = takeChild();
    await child.ready;
    const r = await ask(child, init, 60_000).catch((e) => {
      throw new Error(e?.timeout ? "Loading the files took too long. Saved views may be too heavy to rebuild; save simpler ones." : e.message);
    });
    viewErrors = r.viewErrors || [];
  };
  await start();

  return {
    tables,
    get viewErrors() {
      return viewErrors;
    },
    async select(sql: string, limit: number) {
      const trimmed = cleanSelect(sql);
      if (!child || child.proc.exitCode !== null || child.proc.killed) await start();
      try {
        const r = await ask(child!, { op: "select", sql: `select * from (${trimmed}) as q limit ${Math.max(1, Math.floor(limit))}` }, QUERY_MS);
        return { fields: r.fields, rows: r.rows };
      } catch (e: any) {
        if (e?.timeout) {
          child = null;
          throw new Error(
            `The query took longer than ${QUERY_MS / 1000} seconds and was stopped. Simplify it: match on a key rather than a range over everything, and build on fewer stacked views.`,
          );
        }
        throw new Error(withHint(String(e?.message || e), trimmed));
      }
    },
    close: () => {
      child?.proc.kill();
      child = null;
    },
  };
}

/** An engine error, with a plain pointer for the mistakes models make most. */
function withHint(message: string, sql: string): string {
  // A text value in double quotes is read as a column name.
  const quoted = message.match(/Referenced column "([^"]+)" not found/);
  if (quoted && sql.includes(`"${quoted[1]}"`)) {
    return `${message}\n\nIf "${quoted[1]}" is a text value, put it in single quotes: '${quoted[1]}'. Double quotes are only for column names.`;
  }
  return message;
}

/** One SELECT (or WITH … SELECT), without leading comments or a trailing semicolon. */
function cleanSelect(sql: string): string {
  const trimmed = withoutLeadingComments(String(sql || "")).replace(/;+\s*$/, "");
  if (!/^(select|with|from)\b/i.test(trimmed) || /;/.test(trimmed)) {
    throw new Error("Only a single read-only SELECT (or WITH … SELECT) statement is permitted.");
  }
  return trimmed;
}

/* ── saved views ──────────────────────────────────────────── */

/**
 * Views saved in this run, and in earlier turns of the same conversation, in
 * the order they were saved; a later one of the same name replaces an earlier.
 */
export async function savedViews(ctx: { orgId: string; runId?: string }): Promise<SavedView[]> {
  if (!ctx.runId) return [];
  const rows = await q<any>(
    `select v.name, v.sql
       from file_views v join runs r on r.id = v.run_id
      where r.org_id = $2
        and (v.run_id = $1
             or (r.chat_id is not null
                 and r.chat_id = (select chat_id from runs where id = $1)
                 and r.started_at <= (select started_at from runs where id = $1)))
      order by v.created_at`,
    [ctx.runId, ctx.orgId],
  );
  const byName = new Map<string, SavedView>();
  for (const r of rows) {
    byName.delete(r.name);
    byName.set(r.name, { name: r.name, sql: r.sql });
  }
  return [...byName.values()];
}

const VIEW_NAME = /^[a-z_][a-z0-9_]{0,47}$/;

/**
 * Saves a SELECT as a named view for the rest of the run, after checking it
 * runs. Returns what the agent needs to build on it.
 */
export async function saveView(ctx: { orgId: string; runId?: string }, tables: FileTable[], name: string, sql: string) {
  if (!ctx.runId) throw new Error("Views can only be saved during a run.");
  const n = String(name || "").trim().toLowerCase();
  if (!VIEW_NAME.test(n)) throw new Error(`"${name}" cannot be a view name: use lower-case letters, digits and underscores, starting with a letter.`);
  if (tables.some((t) => t.table === n)) throw new Error(`"${n}" is the name of an uploaded file's table. Choose another name for the view.`);
  const body = cleanSelect(sql);
  const views = (await savedViews(ctx)).filter((v) => v.name !== n);
  const session = await openFileSession(tables, [...views, { name: n, sql: body }]);
  try {
    const failed = session.viewErrors.find((e) => e.startsWith(`${n}:`));
    if (failed) throw new Error(withHint(failed.slice(n.length + 2), body));
    const count = await session.select(`select count(*) as n from ${quote(n)}`, 1);
    const sample = await session.select(`select * from ${quote(n)}`, 5);
    await q(
      `insert into file_views (run_id, name, sql) values ($1, $2, $3)
       on conflict (run_id, name) do update set sql = excluded.sql, created_at = now()`,
      [ctx.runId, n, body],
    );
    return { saved: n, rows: Number(count.rows[0]?.n ?? 0), columns: sample.fields, sample: sample.rows };
  } finally {
    session.close();
  }
}

/** For the agent: each table, its columns as typed, and a few rows. */
export function describeTables(tables: FileTable[]) {
  return tables.map((t) => ({
    table: t.table,
    file: t.file,
    ...(t.input ? { input: t.input } : {}),
    ...(t.sheet ? { sheet: t.sheet } : {}),
    ...(t.otherSheets?.length ? { other_sheets_not_loaded: t.otherSheets } : {}),
    ...(t.notesAbove?.length ? { lines_above_the_table: t.notesAbove } : {}),
    ...(t.notesBelow?.length ? { lines_below_the_table: t.notesBelow } : {}),
    rows: t.rows.length,
    columns: [
      "row_no integer (row of the table, from 1)",
      ...t.columns.map((c) => `${c.name} ${c.type.toLowerCase()}${c.header !== c.name ? ` (header "${c.header}")` : ""}${c.note ? ` — ${c.note}` : ""}`),
    ],
    sample: t.rows.slice(0, 3).map((r, i) => Object.fromEntries([["row_no", i + 1], ...t.columns.map((c, j) => [c.name, r[j]])])),
  }));
}

function withoutLeadingComments(sql: string): string {
  let s = sql.trim();
  for (;;) {
    if (s.startsWith("--")) {
      const nl = s.indexOf("\n");
      s = nl < 0 ? "" : s.slice(nl + 1).trim();
    } else if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      s = end < 0 ? "" : s.slice(end + 2).trim();
    } else return s;
  }
}
