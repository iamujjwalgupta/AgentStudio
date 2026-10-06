import fs from "fs/promises";
import path from "path";
import { Client as PgClient } from "pg";
import Papa from "papaparse";
import { decrypt } from "./crypto";
import { q, one } from "./db";
import { skillName, type SkillRow } from "./skills";
import type { Risk } from "./types";
import { assertSafeUrl } from "./ssrf";
import { storedPath } from "./storage";
import { anthropicUsage, assertWithinLimits, recordUsage } from "./metering";

export type ToolContext = {
  orgId: string;
  userId: string;
  connections: Record<string, ConnRow>; // keyed by connection id
  /** Skills granted to this agent, resolved by the orchestrator. */
  skills: SkillRow[];
  storageDir: string;
  /**
   * The key and model for actions that call a model of their own (web search),
   * on the agent's own engine: an agent on Gemini searches with the Gemini key.
   */
  apiKey: string;
  model: string;
  engine?: "anthropic" | "gemini";
  runId?: string;
  agentId?: string;
};

export type ConnRow = {
  id: string;
  name: string;
  kind: string;
  config: any;
  secret_enc: string | null;
};

export type ToolDef = {
  id: string;
  label: string;
  description: string;
  risk: Risk;
  /** Connection kind this tool needs, if any. */
  needs?: "postgres" | "http" | "smtp" | "slack" | "msteams" | "s3" | "jira" | "github" | "redis";
  /**
   * Granted by the runtime rather than chosen in the builder. An implicit tool
   * is never offered as an action and never carries a gate, so it must be
   * incapable of doing anything a person would want to review.
   */
  implicit?: boolean;
  schema: Record<string, any>;
  run: (input: any, ctx: ToolContext) => Promise<any>;
};

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

/**
 * The granted connection an action means. Models name connections loosely
 * ("ap_demo" for "AP Ledger (ap_demo)"), and the schemas promise the name is
 * optional with only one granted, so: the only one of its kind wins; otherwise
 * id, exact name, name in any case, then a name that uniquely contains it.
 */
function connOf(ctx: ToolContext, kind: string, id?: string): ConnRow {
  const list = Object.values(ctx.connections).filter((c) => c.kind === kind);
  if (!list.length) throw new Error(`No ${kind} connection is available to this agent. Add one under Connections and grant it to the agent.`);
  if (list.length === 1 || !id) return list[0];
  const want = String(id).trim().toLowerCase();
  const found =
    list.find((c) => c.id === id || c.name === id) ??
    list.find((c) => c.name.toLowerCase() === want) ??
    (() => {
      const partial = list.filter((c) => c.name.toLowerCase().includes(want));
      return partial.length === 1 ? partial[0] : undefined;
    })();
  if (!found) {
    throw new Error(`No ${kind} connection called "${id}" is granted to this agent. Use one of: ${list.map((c) => `"${c.name}"`).join(", ")}.`);
  }
  return found;
}

const secretOf = (c: ConnRow) => (c.secret_enc ? decrypt(c.secret_enc) : "");

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const clip = (s: string, n = 12000) => (s.length > n ? s.slice(0, n) + `\n…[truncated, ${s.length} chars total]` : s);

/**
 * A statement with its leading comments ("-- Test A: exact") removed, so the
 * check on what kind of statement it is reads the statement itself. Comments
 * inside it are left alone.
 */
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

/* ── read-only database sessions ──────────────────────────── */

export type ReadOnlySession = {
  connectionName: string;
  documentName?: string;
  /** One SELECT (or WITH … SELECT), capped at `limit` rows. */
  select: (sql: string, limit: number) => Promise<{ fields: string[]; rows: any[] }>;
  close: () => Promise<void>;
};

/**
 * A connection to a granted Postgres database for read-only queries, with an
 * uploaded CSV attached as the temporary table `upload` when one is named.
 * Shared by actions that read figures for the user (the result dashboard), so
 * they follow the same rules as "Query a database".
 */
export async function readOnlySession(ctx: ToolContext, connection?: string, document?: string): Promise<ReadOnlySession> {
  const c = connOf(ctx, "postgres", connection);
  const upload = document ? await uploadedTable(ctx.orgId, document) : null;
  const client = new PgClient({ connectionString: secretOf(c), connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    if (upload) await loadUpload(client, upload);
    await client.query("set default_transaction_read_only = on");
  } catch (e) {
    await client.end().catch(() => {});
    throw e;
  }
  return {
    connectionName: c.name,
    ...(upload ? { documentName: upload.name } : {}),
    async select(sql: string, limit: number) {
      const trimmed = withoutLeadingComments(String(sql || "")).replace(/;+\s*$/, "");
      if (!/^(select|with)\b/i.test(trimmed) || /;/.test(trimmed)) {
        throw new Error("Only a single read-only SELECT (or WITH … SELECT) statement is permitted.");
      }
      const r = await client.query(`select * from (${trimmed}) as q limit ${Math.max(1, Math.floor(limit))}`);
      return { fields: r.fields.map((f) => f.name), rows: r.rows };
    },
    close: () => client.end(),
  };
}

/* ── uploaded tables ──────────────────────────────────────── */

type UploadedTable = { name: string; cols: string[]; sqlCols: string[]; rows: Record<string, string>[] };

/**
 * An uploaded CSV of this workspace, parsed. Rows are numbered from 1 in file
 * order, the same numbering the document reader uses, so a row an agent finds
 * in a query is the row it names when writing a copy of the file.
 */
async function uploadedTable(orgId: string, name: string): Promise<UploadedTable> {
  const docs = await q<any>(`select id, name, path from documents where org_id = $1 order by created_at desc limit 100`, [orgId]);
  const doc = docs.find((d) => d.id === name || d.name === name || d.name.toLowerCase() === String(name).toLowerCase());
  if (!doc) throw new Error(`No uploaded document named "${name}". Available: ${docs.map((d) => d.name).join(", ") || "none"}`);
  const ext = path.extname(doc.name).toLowerCase();
  if (![".csv", ".tsv", ".xlsx"].includes(ext)) throw new Error(`"${doc.name}" is not a CSV or Excel (.xlsx) file.`);
  let cols: string[];
  let data: Record<string, string>[];
  if (ext === ".xlsx") {
    const { readTableFile } = await import("./file-sql");
    const t = await readTableFile(storedPath(doc.path), doc.name, "upload");
    cols = t.columns.map((c) => c.header);
    data = t.rows.map((r) => Object.fromEntries(cols.map((h, j) => [h, r[j] ?? ""])));
  } else {
    const parsed = Papa.parse<Record<string, string>>((await fs.readFile(storedPath(doc.path), "utf8")).trim(), { header: true, skipEmptyLines: true });
    cols = (parsed.meta.fields || []).filter(Boolean);
    data = parsed.data;
  }
  // Column names a query can use as they are: lower case, letters, digits and underscores.
  const seen = new Set<string>(["row_no"]);
  const sqlCols = cols.map((c, i) => {
    let s = c.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `column_${i + 1}`;
    if (/^[0-9]/.test(s)) s = `c_${s}`;
    let u = s;
    for (let n = 2; seen.has(u); n++) u = `${s}_${n}`;
    seen.add(u);
    return u;
  });
  return { name: doc.name, cols, sqlCols, rows: data };
}

async function loadUpload(client: PgClient, t: UploadedTable) {
  const quoted = t.sqlCols.map((c) => `"${c}"`);
  await client.query(`create temp table upload (row_no integer, ${quoted.map((c) => `${c} text`).join(", ")})`);
  for (let start = 0; start < t.rows.length; start += 200) {
    const batch = t.rows.slice(start, start + 200);
    const width = t.cols.length + 1;
    const values: any[] = [];
    const tuples = batch.map((row, k) => {
      values.push(start + k + 1, ...t.cols.map((c) => (row[c] ?? "").toString()));
      return `(${Array.from({ length: width }, (_, j) => `$${k * width + j + 1}`).join(", ")})`;
    });
    await client.query(`insert into upload (row_no, ${quoted.join(", ")}) values ${tuples.join(", ")}`, values);
  }
}

/* ── document parsing ─────────────────────────────────────── */

async function parseDocument(filePath: string, name: string): Promise<string> {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".pdf") {
    const mod: any = await import("pdf-parse/lib/pdf-parse.js");
    const fn = mod.default ?? mod;
    const data = await fn(await fs.readFile(filePath));
    return data.text;
  }
  if (ext === ".docx") {
    const mammoth: any = await import("mammoth");
    const r = await (mammoth.default ?? mammoth).extractRawText({ path: filePath });
    return r.value;
  }
  // Tables (CSV, TSV) are paged by read_document itself, row by row.
  return fs.readFile(filePath, "utf8");
}

/* ── web search on Gemini ──────────────────────────────────── */

/**
 * Web search for an agent that runs on Gemini: Gemini with Google Search
 * grounding, on the workspace's Gemini key. Returns the same shape as the
 * Claude search, with the pages it drew on.
 */
async function geminiSearch(query: string, ctx: ToolContext) {
  if (!ctx.apiKey) throw new Error("This agent runs on Gemini, and the workspace has no Gemini key. Add one under Connections.");
  await assertWithinLimits(ctx.orgId, "gemini", ctx.agentId);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ctx.model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": ctx.apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `Search the web and answer factually, citing your sources. Question: ${query}` }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
    }),
    signal: AbortSignal.timeout(90_000),
  }).catch((e: any) => {
    throw new Error(`Could not reach Gemini for the web search: ${e?.message || e}`);
  });
  const data: any = await res.json().catch(() => ({}));
  const u = data.usageMetadata || {};
  await recordUsage(
    { orgId: ctx.orgId, feature: "web_search", agentId: ctx.agentId, runId: ctx.runId, userId: ctx.userId },
    "gemini",
    ctx.model,
    { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) },
  );
  if (!res.ok) {
    const msg = String(data?.error?.message || `HTTP ${res.status}`);
    throw new Error(
      res.status === 429
        ? "The Gemini key has hit its rate limit or quota, so the web search could not run. Wait a minute and try again."
        : res.status === 400 || res.status === 403
          ? `Gemini refused the web search (${msg.slice(0, 200)}). Check the Gemini key under Connections.`
          : `The web search failed (${res.status}): ${msg.slice(0, 200)}`,
    );
  }
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
  const meta = cand?.groundingMetadata || {};
  // Google's links are redirects through its own server; follow each once to the page itself.
  const chunks: { uri: string; title: string }[] = (meta.groundingChunks || [])
    .map((c: any) => c.web)
    .filter((w: any) => w?.uri)
    .slice(0, 12);
  const sources = await Promise.all(
    chunks.map(async (w) => {
      try {
        const r = await fetch(w.uri, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5000) });
        const to = r.headers.get("location");
        return { title: w.title, url: to && /^https?:\/\//.test(to) ? to : w.uri };
      } catch {
        return { title: w.title, url: w.uri };
      }
    }),
  );
  if (!text) throw new Error("The web search returned no answer. Try a more specific query.");
  return {
    answer: clip(text, 8000),
    sources: [...new Map(sources.map((x) => [x.url, x])).values()],
    ...(Array.isArray(meta.webSearchQueries) && meta.webSearchQueries.length ? { searched_for: meta.webSearchQueries } : {}),
  };
}

/* ── the registry ─────────────────────────────────────────── */

export const TOOLS: ToolDef[] = [
  {
    id: "web_search",
    label: "Search the web",
    description: "Search the public web for current information and return a cited summary.",
    risk: "low",
    schema: {
      type: "object",
      properties: { query: { type: "string", description: "What to search for" } },
      required: ["query"],
    },
    async run({ query }, ctx) {
      if (ctx.engine === "gemini") return geminiSearch(String(query || ""), ctx);
      // A model call of its own, so it is metered and limited like the run that makes it.
      await assertWithinLimits(ctx.orgId, "anthropic", ctx.agentId);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ctx.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: ctx.model || MODEL,
          max_tokens: 1500,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
          messages: [
            {
              role: "user",
              content: `Search the web and answer factually with source URLs. Question: ${query}`,
            },
          ],
        }),
      });
      const data = await res.json();
      await recordUsage(
        { orgId: ctx.orgId, feature: "web_search", agentId: ctx.agentId, runId: ctx.runId, userId: ctx.userId },
        "anthropic",
        ctx.model || MODEL,
        anthropicUsage(data),
      );
      if (data.error) throw new Error(data.error.message || "Web search failed");
      const text = (data.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
      const sources = new Set<string>();
      for (const b of data.content || []) {
        for (const c of b.citations || []) if (c.url) sources.add(c.url);
        if (b.type === "web_search_tool_result") {
          for (const r of b.content || []) if (r.url) sources.add(r.url);
        }
      }
      return { answer: clip(text, 8000), sources: [...sources].slice(0, 12) };
    },
  },

  {
    id: "fetch_url",
    label: "Fetch a web page",
    description: "Retrieve a specific URL and return its readable text content.",
    risk: "low",
    schema: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute http(s) URL" } },
      required: ["url"],
    },
    async run({ url }) {
      const safe = await assertSafeUrl(url);
      const res = await fetch(safe.toString(), {
        headers: { "user-agent": "AgentStudio/1.0" },
        signal: AbortSignal.timeout(20_000),
      });
      const type = res.headers.get("content-type") || "";
      const body = await res.text();
      return {
        url,
        status: res.status,
        contentType: type,
        text: clip(type.includes("html") ? stripHtml(body) : body),
      };
    },
  },

  {
    id: "sql_query",
    label: "Query a database",
    description:
      "Run a read-only SQL SELECT against a connected Postgres database. Call with list_tables true first to discover the schema.",
    risk: "low",
    needs: "postgres",
    schema: {
      type: "object",
      properties: {
        connection: { type: "string", description: "Connection name, optional if only one is granted" },
        list_tables: { type: "boolean", description: "Return the schema instead of running a query" },
        sql: { type: "string", description: "A single SELECT statement" },
        limit: { type: "number", description: "Max rows to return, default 200" },
        document: {
          type: "string",
          description:
            "Name of an uploaded CSV to use in the query as the temporary table `upload` (a row_no column plus the file's columns, all text). " +
            "Join it to the database instead of copying the file's values into the SQL.",
        },
      },
    },
    async run({ connection, sql, list_tables, limit, document }, ctx) {
      const c = connOf(ctx, "postgres", connection);
      const upload = document ? await uploadedTable(ctx.orgId, document) : null;
      const client = new PgClient({ connectionString: secretOf(c), connectionTimeoutMillis: 10_000 });
      await client.connect();
      try {
        // The file goes into a temporary table for this session only: it never
        // touches the database's own tables, and a read-only transaction may
        // still write to a temporary table.
        if (upload) await loadUpload(client, upload);
        const uploaded = upload
          ? { uploaded_file: { name: upload.name, table: "upload", columns: ["row_no", ...upload.sqlCols], rows: upload.rows.length } }
          : {};
        if (list_tables || !sql) {
          const r = await client.query(
            `select table_schema, table_name, column_name, data_type
             from information_schema.columns
             where table_schema not in ('pg_catalog','information_schema')
             order by table_schema, table_name, ordinal_position limit 800`,
          );
          const byTable: Record<string, string[]> = {};
          for (const row of r.rows) {
            const k = `${row.table_schema}.${row.table_name}`;
            (byTable[k] ||= []).push(`${row.column_name} ${row.data_type}`);
          }
          // What the database says about itself: table and column comments, and
          // the rules on allowed values (CHECK constraints), so an agent knows a
          // status is 'paid' rather than guessing 'Paid'.
          const notes: Record<string, string> = {};
          const meta = await client
            .query(
              `select n.nspname || '.' || c.relname as t,
                      obj_description(c.oid, 'pg_class') as comment,
                      (select string_agg(a.attname || ': ' || col_description(c.oid, a.attnum), '; ')
                         from pg_attribute a
                        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                          and col_description(c.oid, a.attnum) is not null) as columns,
                      (select string_agg(pg_get_constraintdef(k.oid), '; ')
                         from pg_constraint k where k.conrelid = c.oid and k.contype = 'c') as rules
                 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where c.relkind in ('r', 'v', 'p')
                  and n.nspname not in ('pg_catalog', 'information_schema')
                  and n.nspname not like 'pg\\_t%'`,
            )
            .catch(() => ({ rows: [] as any[] }));
          for (const m of meta.rows) {
            const parts = [m.comment, m.columns && `Columns: ${m.columns}`, m.rules && `Allowed values: ${m.rules}`].filter(Boolean);
            if (parts.length && byTable[m.t]) notes[m.t] = parts.join(" · ");
          }
          return { connection: c.name, schema: byTable, ...(Object.keys(notes).length ? { notes } : {}), ...uploaded };
        }
        const trimmed = withoutLeadingComments(sql).replace(/;+\s*$/, "");
        if (!/^(select|with)\b/i.test(trimmed) || /;/.test(trimmed)) {
          throw new Error("Only a single read-only SELECT (or WITH … SELECT) statement is permitted.");
        }
        const capped = /\blimit\b/i.test(trimmed) ? trimmed : `${trimmed} limit ${Math.min(limit || 200, 1000)}`;
        await client.query("set default_transaction_read_only = on");
        const r = await client.query(capped);
        return { connection: c.name, rowCount: r.rowCount, rows: r.rows.slice(0, 500), ...uploaded };
      } finally {
        await client.end();
      }
    },
  },

  {
    id: "read_document",
    label: "Read an uploaded document",
    description:
      "Read a file the user uploaded — CSV, Excel (.xlsx), PDF, DOCX or plain text. Call with no name to list what is available. " +
      "Long files come back a page at a time; the result says which rows (or characters) it holds and where to read on from.",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "File name or id. Omit to list available documents." },
        from_row: { type: "number", description: "CSV and Excel: the first data row to return, counting from 1. Default 1." },
        from_char: { type: "number", description: "Other files: the character to start from, counting from 0. Default 0." },
      },
    },
    async run({ name, from_row, from_char }, ctx) {
      const docs = await q<any>(
        `select id, name, mime, path, size_bytes from documents where org_id = $1 order by created_at desc limit 100`,
        [ctx.orgId],
      );
      if (!name) return { documents: docs.map((d) => ({ id: d.id, name: d.name, size: d.size_bytes })) };
      const doc = docs.find((d) => d.id === name || d.name === name || d.name.toLowerCase() === String(name).toLowerCase());
      if (!doc) throw new Error(`No document named "${name}". Available: ${docs.map((d) => d.name).join(", ") || "none"}`);

      // A table comes back as CSV text, whole rows only, as many as fit a page.
      // The agent is told exactly which rows it has, so it never mistakes part
      // of a file for all of it.
      const ext = path.extname(doc.name).toLowerCase();
      if (ext === ".csv" || ext === ".tsv" || ext === ".xlsx") {
        let cols: string[];
        let rows: any[];
        let around: Record<string, any> = {};
        if (ext === ".xlsx") {
          // The table on the main sheet, found under any title lines, as the query engine sees it.
          const { readTableFile } = await import("./file-sql");
          const t = await readTableFile(storedPath(doc.path), doc.name, "t");
          cols = t.columns.map((c) => c.header);
          rows = t.rows.map((r) => Object.fromEntries(cols.map((h, j) => [h, r[j] ?? ""])));
          around = {
            ...(t.sheet ? { sheet: t.sheet } : {}),
            ...(t.notesAbove?.length ? { lines_above_the_table: t.notesAbove } : {}),
            ...(t.notesBelow?.length ? { lines_below_the_table: t.notesBelow } : {}),
          };
        } else {
          const parsed = Papa.parse((await fs.readFile(storedPath(doc.path), "utf8")).trim(), { header: true, skipEmptyLines: true });
          cols = parsed.meta.fields || [];
          rows = parsed.data as any[];
        }
        const start = Math.min(Math.max(Math.floor(Number(from_row) || 1), 1), Math.max(rows.length, 1)) - 1;
        const cell = (v: any) => {
          const s = v == null ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [cols.map(cell).join(",")];
        let size = lines[0].length;
        let i = start;
        for (; i < rows.length; i++) {
          const line = cols.map((c) => cell(rows[i][c])).join(",");
          if (size + line.length > 18000 && i > start) break;
          lines.push(line);
          size += line.length + 1;
        }
        return {
          name: doc.name,
          ...around,
          columns: cols,
          totalRows: rows.length,
          rows: rows.length ? `${start + 1}–${i} of ${rows.length}` : "none",
          ...(i < rows.length ? { more: `Rows ${i + 1}–${rows.length} are not shown. Call again with from_row ${i + 1}.` } : { complete: true }),
          content: lines.join("\n"),
        };
      }

      const text = await parseDocument(storedPath(doc.path), doc.name);
      const at = Math.min(Math.max(Math.floor(Number(from_char) || 0), 0), text.length);
      const end = Math.min(at + 20000, text.length);
      return {
        name: doc.name,
        characters: text.length,
        shown: `${at}–${end}`,
        ...(end < text.length ? { more: `Characters ${end}–${text.length} are not shown. Call again with from_char ${end}.` } : { complete: true }),
        content: text.slice(at, end),
      };
    },
  },

  {
    id: "query_files",
    label: "Query the uploaded files",
    description:
      "Run SQL over the CSV files given to this run — no database needed. Each file is a table named after its input " +
      "(for example bank_statement, cash_book), with row_no (its line in the file, from 1) and the file's columns, already typed: " +
      "amounts as exact decimals (commas, ₹ and brackets handled), dates as dates (day/month/year read correctly), reference " +
      "numbers as text. Call with list_tables true first to see the tables, columns and sample rows. The SQL is DuckDB, close to " +
      "PostgreSQL: ::casts, ILIKE, regexp_replace(x, '[^0-9]', '', 'g'), abs(), date_diff('day', a, b), string_agg, window " +
      "functions, FULL OUTER JOIN. Match and total in SQL rather than reading rows and adding them up yourself. " +
      "Build the work in steps: give save_as to keep a SELECT as a named view (e.g. matches, unmatched, summary) that later " +
      "queries and present_result can select from by name, instead of repeating long queries.",
    risk: "low",
    implicit: true,
    schema: {
      type: "object",
      properties: {
        list_tables: { type: "boolean", description: "Return the tables, their typed columns and sample rows instead of running a query" },
        sql: { type: "string", description: "A single SELECT (or WITH … SELECT)" },
        save_as: {
          type: "string",
          description: "Save this SELECT as a view with this name (lower_case_with_underscores) for the rest of the run; returns its row count, columns and first rows. Saving again under the same name replaces it.",
        },
        limit: { type: "number", description: "Max rows to return, default 200, at most 1000" },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Other uploaded CSV files to include, by file name; each becomes a table named after the file",
        },
      },
    },
    async run({ list_tables, sql, save_as, limit, files }, ctx) {
      const { runFiles, openFileSession, describeTables, savedViews, saveView } = await import("./file-sql");
      const tables = await runFiles(ctx, Array.isArray(files) ? files : []);
      if (!tables.length) throw new Error("This run was given no CSV files. Ask the user to attach one, or name an uploaded file in files.");
      const views = await savedViews(ctx);
      if (list_tables || !sql) {
        if (!views.length) return { tables: describeTables(tables) };
        const s = await openFileSession(tables, views);
        try {
          const described = [];
          for (const v of views) {
            const r = await s.select(`select * from "${v.name}"`, 1).catch(() => null);
            described.push({ view: v.name, columns: r ? r.fields : "could not be recreated" });
          }
          return { tables: describeTables(tables), saved_views: described };
        } finally {
          s.close();
        }
      }
      if (save_as) return saveView(ctx, tables, save_as, sql);
      const session = await openFileSession(tables, views);
      try {
        const cap = Math.min(Math.max(Math.floor(Number(limit) || 200), 1), 1000);
        const r = await session.select(sql, cap + 1);
        return {
          rowCount: Math.min(r.rows.length, cap),
          ...(r.rows.length > cap ? { more: `More than ${cap} rows; aggregate, filter, or raise limit (up to 1000).` } : {}),
          rows: r.rows.slice(0, Math.min(cap, 500)),
        };
      } finally {
        session.close();
      }
    },
  },

  {
    id: "http_request",
    label: "Call an API",
    description: "Call a REST endpoint on a connected API. Credentials are attached by the platform.",
    risk: "medium",
    needs: "http",
    schema: {
      type: "object",
      properties: {
        connection: { type: "string", description: "Connection name, optional if only one is granted" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
        path: { type: "string", description: "Path appended to the connection base URL, e.g. /v1/tickets" },
        query: { type: "object", description: "Query string parameters" },
        body: { type: "object", description: "JSON request body" },
      },
      required: ["method", "path"],
    },
    async run({ connection, method, path: p, query, body }, ctx) {
      const c = connOf(ctx, "http", connection);
      const base = (c.config?.baseUrl || "").replace(/\/$/, "");
      const url = new URL(base + (p.startsWith("/") ? p : "/" + p));
      for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
      const safe = await assertSafeUrl(url.toString());
      const headers: Record<string, string> = { accept: "application/json", ...(c.config?.headers || {}) };
      const token = secretOf(c);
      if (token) {
        const scheme = c.config?.authScheme || "Bearer";
        if (scheme === "header") headers[c.config?.authHeader || "x-api-key"] = token;
        else headers["authorization"] = `${scheme} ${token}`;
      }
      if (body) headers["content-type"] = "application/json";
      const res = await fetch(url.toString(), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      let parsed: any = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep as text */
      }
      return { status: res.status, url: url.toString(), body: typeof parsed === "string" ? clip(parsed) : parsed };
    },
  },

  {
    id: "send_email",
    label: "Send an email",
    description: "Send an email from the connected mailbox.",
    risk: "medium",
    needs: "smtp",
    schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Comma separated recipients" },
        subject: { type: "string" },
        body: { type: "string", description: "Plain text or simple HTML" },
      },
      required: ["to", "subject", "body"],
    },
    async run({ to, subject, body }, ctx) {
      const c = connOf(ctx, "smtp");
      const nodemailer: any = await import("nodemailer");
      const t = (nodemailer.default ?? nodemailer).createTransport({
        host: c.config.host,
        port: Number(c.config.port || 587),
        secure: Boolean(c.config.secure),
        auth: c.config.user ? { user: c.config.user, pass: secretOf(c) } : undefined,
      });
      const info = await t.sendMail({
        from: c.config.from || c.config.user,
        to,
        subject,
        [/<[a-z][\s\S]*>/i.test(body) ? "html" : "text"]: body,
      });
      return { messageId: info.messageId, accepted: info.accepted };
    },
  },

  {
    id: "post_message",
    label: "Post to Slack",
    description: "Post a message to the connected Slack channel.",
    risk: "medium",
    needs: "slack",
    schema: {
      type: "object",
      properties: { text: { type: "string", description: "Message text, Slack markdown supported" } },
      required: ["text"],
    },
    async run({ text }, ctx) {
      const c = connOf(ctx, "slack");
      const res = await fetch(secretOf(c), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const out = await res.text();
      if (!res.ok) throw new Error(`Slack rejected the message: ${out}`);
      return { posted: true, channel: c.config?.channel || c.name };
    },
  },

  {
    id: "write_file",
    label: "Write a file",
    description:
      "Produce a downloadable file as the agent's deliverable. Formats: md, txt, csv, html, json, docx.",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Including extension, e.g. summary.md" },
        content: { type: "string", description: "File contents. For docx, plain text with blank lines between paragraphs." },
        source_document: {
          type: "string",
          description:
            "Instead of content: an uploaded CSV to copy, exactly as it is, except the rows listed in drop_rows. Use this for a corrected copy of a file.",
        },
        drop_rows: {
          type: "array",
          items: { type: "number" },
          description: "With source_document: the row numbers to leave out (data rows counted from 1, as row_no in a query's upload table).",
        },
      },
      required: ["filename"],
    },
    async run({ filename, content, source_document, drop_rows }, ctx) {
      // A corrected copy of an uploaded table is made here, row for row, rather
      // than retyped by the model, which drops and miscopies lines in long files.
      let dropped: number[] | undefined;
      let kept: number | undefined;
      if (source_document) {
        const t = await uploadedTable(ctx.orgId, source_document);
        const drop = new Set((Array.isArray(drop_rows) ? drop_rows : []).map((n: any) => Math.floor(Number(n))));
        dropped = [...drop].filter((n) => n >= 1 && n <= t.rows.length).sort((a, b) => a - b);
        const rows = t.rows.filter((_, i) => !drop.has(i + 1));
        kept = rows.length;
        content = Papa.unparse({ fields: t.cols, data: rows.map((r) => t.cols.map((c) => r[c] ?? "")) }, { newline: "\n" }) + "\n";
      } else if (content == null) {
        throw new Error("Give the file's content, or a source_document to copy.");
      }
      const safe = path.basename(filename).replace(/[^\w.\- ]+/g, "_");
      const dir = path.join(ctx.storageDir, "artifacts", ctx.orgId);
      await fs.mkdir(dir, { recursive: true });
      const target = path.join(dir, `${Date.now()}-${safe}`);
      if (safe.toLowerCase().endsWith(".docx")) {
        const d: any = await import("docx");
        const doc = new d.Document({
          sections: [
            {
              children: String(content)
                .split(/\n{2,}/)
                .map((p: string) => new d.Paragraph({ children: [new d.TextRun(p.replace(/\n/g, " "))] })),
            },
          ],
        });
        await fs.writeFile(target, await d.Packer.toBuffer(doc));
      } else {
        await fs.writeFile(target, content, "utf8");
      }
      const stat = await fs.stat(target);
      const row = await one<any>(
        `insert into documents (org_id, name, mime, path, size_bytes, uploaded_by)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [ctx.orgId, safe, "generated", target, stat.size, ctx.userId],
      );
      return {
        file: safe,
        bytes: stat.size,
        downloadUrl: `/api/documents/${row.id}`,
        ...(dropped ? { copiedFrom: source_document, rowsDropped: dropped, rowsKept: kept } : {}),
      };
    },
  },

  {
    id: "sql_execute",
    label: "Execute SQL write statement",
    description:
      "Run an INSERT, UPDATE, or DELETE query against a connected Postgres database. Requires approval gating and explicit write permissions enabled on the connection.",
    risk: "high",
    needs: "postgres",
    schema: {
      type: "object",
      properties: {
        connection: { type: "string", description: "Connection name, optional if only one is granted" },
        sql: { type: "string", description: "A single INSERT, UPDATE, or DELETE statement" },
      },
      required: ["sql"],
    },
    async run({ connection, sql }, ctx) {
      const c = connOf(ctx, "postgres", connection);
      // The Connections form saves a checkbox (true); connections made before it may hold "yes".
      if (c.config?.allowWrites !== true && c.config?.allowWrites !== "yes") {
        throw new Error(
          `Writes are turned off for the connection "${c.name}". An admin can turn on "Allow write statements" on it under Connections.`
        );
      }
      const trimmed = withoutLeadingComments(String(sql || "")).replace(/;+\s*$/, "");
      if (!trimmed) throw new Error("SQL statement cannot be empty.");
      if (trimmed.includes(";")) {
        throw new Error("Multiple SQL statements in a single execution are prohibited for security.");
      }
      if (!/^(insert\s+into|update\b|delete\s+from)\b/i.test(trimmed)) {
        throw new Error(
          "Only INSERT, UPDATE, or DELETE statements are permitted with sql_execute. Use sql_query for read-only SELECT queries."
        );
      }
      const client = new PgClient({ connectionString: secretOf(c), connectionTimeoutMillis: 15_000 });
      await client.connect();
      try {
        const r = await client.query(trimmed);
        return {
          connection: c.name,
          command: r.command,
          rowCount: r.rowCount,
          rows: (r.rows || []).slice(0, 50),
        };
      } finally {
        await client.end();
      }
    },
  },

  {
    id: "post_teams_message",
    label: "Post to Microsoft Teams",
    description: "Post an announcement, summary, or alert to a Microsoft Teams channel via incoming webhook.",
    risk: "medium",
    needs: "msteams",
    schema: {
      type: "object",
      properties: {
        connection: { type: "string", description: "Connection name, optional if only one is granted" },
        title: { type: "string", description: "Card header or message title" },
        text: { type: "string", description: "Message body in markdown or plain text" },
      },
      required: ["text"],
    },
    async run({ connection, title, text }, ctx) {
      const c = connOf(ctx, "msteams", connection);
      const webhookUrl = secretOf(c);
      const payload = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        themeColor: "464EB8",
        summary: title || "Message from Agent Studio",
        ...(title ? { title } : {}),
        text,
      };
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      const out = await res.text().catch(() => "");
      if (!res.ok) throw new Error(`Teams webhook rejected the message: ${out || `HTTP ${res.status}`}`);
      return { posted: true, channel: c.name };
    },
  },

  {
    id: "s3_upload_file",
    label: "Upload to AWS S3",
    description: "Upload a file or raw content to an AWS S3 (or S3-compatible) storage bucket with SigV4 authentication.",
    risk: "medium",
    needs: "s3",
    schema: {
      type: "object",
      properties: {
        connection: { type: "string", description: "Connection name, optional if only one is granted" },
        key: { type: "string", description: "Destination file path/key inside the bucket (e.g. reports/audit.csv)" },
        content: { type: "string", description: "File text, CSV, JSON, or markdown content to upload" },
        contentType: { type: "string", description: "MIME type, e.g. text/csv, application/json, text/plain" },
      },
      required: ["key", "content"],
    },
    async run({ connection, key, content, contentType }, ctx) {
      const c = connOf(ctx, "s3", connection);
      const { uploadToS3 } = await import("./aws-s3");
      const s3Config = {
        bucket: c.config?.bucket || "",
        region: c.config?.region || "us-east-1",
        accessKeyId: c.config?.accessKeyId || "",
        endpoint: c.config?.endpoint,
      };
      if (!s3Config.bucket) throw new Error(`S3 connection "${c.name}" is missing a bucket name.`);
      const r = await uploadToS3(s3Config, secretOf(c), key, content, contentType || "text/plain");
      if (!r.ok) throw new Error(`S3 upload failed: ${r.error}`);
      return { uploaded: true, bucket: s3Config.bucket, key, url: r.url };
    },
  },

  {
    id: "jira_create_issue",
    label: "Create Jira issue",
    description: "Create a new issue, task, or bug in Atlassian Jira.",
    risk: "medium",
    needs: "jira",
    schema: {
      type: "object",
      properties: {
        connection: { type: "string", description: "Connection name, optional if only one is granted" },
        project: { type: "string", description: "Jira Project key (e.g. PROJ). Defaults to connection configuration if omitted." },
        summary: { type: "string", description: "Issue summary or title" },
        description: { type: "string", description: "Detailed issue description" },
        issueType: { type: "string", description: "Issue type name, e.g. Task, Bug, Story (defaults to Task)" },
      },
      required: ["summary", "description"],
    },
    async run({ connection, project, summary, description, issueType }, ctx) {
      const c = connOf(ctx, "jira", connection);
      const host = (c.config?.host || "").replace(/\/$/, "");
      const projectKey = project || c.config?.project;
      if (!projectKey) throw new Error(`Specify a project key or configure a default project on the Jira connection "${c.name}".`);
      const email = c.config?.email || "";
      const auth = Buffer.from(`${email}:${secretOf(c)}`).toString("base64");
      const payload = {
        fields: {
          project: { key: projectKey },
          summary,
          issuetype: { name: issueType || "Task" },
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: description }],
              },
            ],
          },
        },
      };
      const res = await fetch(`${host}/rest/api/3/issue`, {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errs = data?.errorMessages?.join(", ") || JSON.stringify(data?.errors || `HTTP ${res.status}`);
        throw new Error(`Jira issue creation failed: ${errs}`);
      }
      return {
        id: data.id,
        key: data.key,
        url: `${host}/browse/${data.key}`,
      };
    },
  },

  {
    id: "jira_search_issues",
    label: "Search Jira issues",
    description: "Search Jira issues using JQL (Jira Query Language) to retrieve status, assignees, and summaries.",
    risk: "low",
    needs: "jira",
    schema: {
      type: "object",
      properties: {
        connection: { type: "string", description: "Connection name, optional if only one is granted" },
        jql: { type: "string", description: "JQL query string, e.g. project = FIN AND status != Done ORDER BY created DESC" },
        limit: { type: "number", description: "Maximum number of issues to return (default 20, max 50)" },
      },
      required: ["jql"],
    },
    async run({ connection, jql, limit }, ctx) {
      const c = connOf(ctx, "jira", connection);
      const host = (c.config?.host || "").replace(/\/$/, "");
      const email = c.config?.email || "";
      const auth = Buffer.from(`${email}:${secretOf(c)}`).toString("base64");
      const max = Math.min(limit || 20, 50);
      const url = `${host}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${max}&fields=summary,status,assignee,created,priority,issuetype`;
      const res = await fetch(url, {
        headers: {
          authorization: `Basic ${auth}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(20_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errs = data?.errorMessages?.join(", ") || `HTTP ${res.status}`;
        throw new Error(`Jira search failed: ${errs}`);
      }
      const issues = (data.issues || []).map((i: any) => ({
        key: i.key,
        summary: i.fields?.summary,
        status: i.fields?.status?.name,
        priority: i.fields?.priority?.name,
        type: i.fields?.issuetype?.name,
        assignee: i.fields?.assignee?.displayName || "Unassigned",
        created: i.fields?.created,
        url: `${host}/browse/${i.key}`,
      }));
      return { total: data.total, count: issues.length, issues };
    },
  },

  {
    id: "github_create_issue",
    label: "Create GitHub issue",
    description: "Create an issue in a GitHub repository with a title, markdown body, and optional labels.",
    risk: "medium",
    needs: "github",
    schema: {
      type: "object",
      properties: {
        connection: { type: "string", description: "Connection name, optional if only one is granted" },
        repo: { type: "string", description: "Target repository in 'owner/repo' format. Defaults to connection configuration if omitted." },
        title: { type: "string", description: "Issue title" },
        body: { type: "string", description: "Issue description in GitHub markdown" },
        labels: { type: "array", items: { type: "string" }, description: "Optional labels to attach" },
      },
      required: ["title", "body"],
    },
    async run({ connection, repo, title, body, labels }, ctx) {
      const c = connOf(ctx, "github", connection);
      const targetRepo = repo || c.config?.repo;
      if (!targetRepo) throw new Error(`Specify a target repo (owner/repo) or configure a default repo on GitHub connection "${c.name}".`);
      const token = secretOf(c);
      const res = await fetch(`https://api.github.com/repos/${targetRepo}/issues`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "user-agent": "Agent-Studio",
          accept: "application/vnd.github.v3+json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ title, body, labels: labels || [] }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`GitHub issue creation failed: ${data.message || `HTTP ${res.status}`}`);
      return {
        number: data.number,
        title: data.title,
        url: data.html_url,
        state: data.state,
      };
    },
  },

  {
    id: "github_read_file",
    label: "Read GitHub file",
    description: "Fetch and inspect the contents of a file or code repository from GitHub.",
    risk: "low",
    needs: "github",
    schema: {
      type: "object",
      properties: {
        connection: { type: "string", description: "Connection name, optional if only one is granted" },
        repo: { type: "string", description: "Repository in 'owner/repo' format. Defaults to connection configuration if omitted." },
        path: { type: "string", description: "Path to file in repo, e.g. src/index.ts or docs/README.md" },
        ref: { type: "string", description: "Branch, tag, or commit SHA (optional, defaults to main/default branch)" },
      },
      required: ["path"],
    },
    async run({ connection, repo, path: p, ref }, ctx) {
      const c = connOf(ctx, "github", connection);
      const targetRepo = repo || c.config?.repo;
      if (!targetRepo) throw new Error(`Specify a target repo (owner/repo) or configure a default repo on GitHub connection "${c.name}".`);
      const token = secretOf(c);
      const cleanPath = p.replace(/^\//, "");
      const url = new URL(`https://api.github.com/repos/${targetRepo}/contents/${cleanPath}`);
      if (ref) url.searchParams.set("ref", ref);
      const res = await fetch(url.toString(), {
        headers: {
          authorization: `Bearer ${token}`,
          "user-agent": "Agent-Studio",
          accept: "application/vnd.github.v3+json",
        },
        signal: AbortSignal.timeout(20_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`GitHub file read failed: ${data.message || `HTTP ${res.status}`}`);
      if (Array.isArray(data)) {
        return {
          type: "directory",
          entries: data.map((item: any) => ({ name: item.name, path: item.path, type: item.type, size: item.size })),
        };
      }
      const content = data.content && data.encoding === "base64"
        ? Buffer.from(data.content, "base64").toString("utf8")
        : data.content || "";
      return {
        name: data.name,
        path: data.path,
        size: data.size,
        content: clip(content, 20_000),
      };
    },
  },

  {
    id: "kv_get",
    label: "Read key-value store",
    description: "Retrieve a cached string value or state for a given key from connected Redis store.",
    risk: "low",
    needs: "redis",
    schema: {
      type: "object",
      properties: {
        connection: { type: "string", description: "Connection name, optional if only one is granted" },
        key: { type: "string", description: "Key name to retrieve" },
      },
      required: ["key"],
    },
    async run({ connection, key }, ctx) {
      const c = connOf(ctx, "redis", connection);
      const { executeRedis } = await import("./redis-client");
      const prefix = c.config?.keyPrefix ? `${c.config.keyPrefix}:` : "";
      const fullKey = prefix ? `${prefix}${key}` : key;
      const val = await executeRedis(
        { host: c.config?.host, port: c.config?.port, tls: Boolean(c.config?.tls) },
        secretOf(c),
        ["GET", fullKey]
      );
      return { key, found: val !== null, value: val };
    },
  },

  {
    id: "kv_set",
    label: "Write key-value store",
    description: "Store a string value or state under a key in connected Redis store, with optional expiration TTL.",
    risk: "medium",
    needs: "redis",
    schema: {
      type: "object",
      properties: {
        connection: { type: "string", description: "Connection name, optional if only one is granted" },
        key: { type: "string", description: "Key name to store" },
        value: { type: "string", description: "String value or JSON string to store" },
        ttlSeconds: { type: "number", description: "Optional expiration time in seconds" },
      },
      required: ["key", "value"],
    },
    async run({ connection, key, value, ttlSeconds }, ctx) {
      const c = connOf(ctx, "redis", connection);
      const { executeRedis } = await import("./redis-client");
      const prefix = c.config?.keyPrefix ? `${c.config.keyPrefix}:` : "";
      const fullKey = prefix ? `${prefix}${key}` : key;
      const args = ttlSeconds && ttlSeconds > 0
        ? ["SET", fullKey, String(value), "EX", String(Math.floor(ttlSeconds))]
        : ["SET", fullKey, String(value)];
      await executeRedis(
        { host: c.config?.host, port: c.config?.port, tls: Boolean(c.config?.tls) },
        secretOf(c),
        args
      );
      return { key, set: true, ttlSeconds: ttlSeconds || null };
    },
  },

  {
    id: "invoke_agent",
    label: "Delegate to another agent",
    description:
      "Invoke another published agent in this workspace to perform a delegated subtask. " +
      "The child agent executes with its own instructions, tools, and skills, returning its structured output.",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: "The exact name or identifier of the published agent to invoke (e.g. 'Journal Entry Anomaly Reviewer')",
        },
        input: {
          type: "string",
          description: "Clear instructions, context, and data for the delegated agent to process",
        },
      },
      required: ["agent", "input"],
    },
    async run({ agent, input }: { agent: string; input: string }, ctx: ToolContext) {
      if (!agent || !agent.trim()) {
        throw new Error("Specify the name of the agent to invoke.");
      }

      // 1. Locate the agent in the workspace
      const target = await one<any>(
        `select id, name, status, published_ver, draft_spec from agents
          where org_id = $1 and (lower(name) = lower($2) or id::text = $2) limit 1`,
        [ctx.orgId, agent.trim()],
      );

      if (!target) {
        const available = await q<any>(
          `select name from agents where org_id = $1 and status = 'published' order by name limit 10`,
          [ctx.orgId],
        );
        throw new Error(
          `Agent "${agent}" was not found in this workspace.` +
            (available.length ? ` Available published agents: ${available.map((a) => a.name).join(", ")}.` : ""),
        );
      }

      // 2. Prevent self-delegation recursion
      if (ctx.agentId && ctx.agentId === target.id) {
        throw new Error(`Self-delegation blocked: agent "${target.name}" cannot delegate to itself.`);
      }

      // 3. Prevent excessive delegation depth (maximum 3 levels)
      if (ctx.runId) {
        let depth = 0;
        let currId: string | null = ctx.runId;
        while (currId && depth < 5) {
          const parentRow: any = await one(`select parent_run_id from runs where id = $1`, [currId]);
          if (parentRow?.parent_run_id) {
            depth++;
            currId = parentRow.parent_run_id;
          } else {
            break;
          }
        }
        if (depth >= 3) {
          throw new Error(
            `Maximum delegation depth of 3 levels exceeded (Parent -> Child -> Grandchild). Halting to prevent runaway recursion.`,
          );
        }
      }

      // 4. Resolve spec: published version preferred, fallback to draft_spec
      let spec = target.draft_spec;
      let ver = target.published_ver;
      if (target.status === "published" && target.published_ver) {
        const verRow = await one<any>(
          `select spec from agent_versions where agent_id = $1 and version = $2`,
          [target.id, target.published_ver],
        );
        if (verRow?.spec) spec = verRow.spec;
      }

      // 5. Spawn child run via dynamic import to avoid circular dependency
      const { startRun } = await import("./orchestrator");
      const childRunId = await startRun({
        orgId: ctx.orgId,
        agentId: target.id,
        spec,
        version: ver || null,
        input: String(input || "Perform delegated task."),
        user: { id: ctx.userId, name: "Delegating Agent" },
        trigger: `delegation:${ctx.agentId || "parent"}`,
        parentRunId: ctx.runId,
        waitForCompletion: true,
      });

      // 6. Inspect child run outcome
      const childRun = await one<any>(`select * from runs where id = $1`, [childRunId]);
      if (childRun.status === "completed") {
        return {
          status: "completed",
          agent: target.name,
          version: ver,
          childRunId,
          deliverable: childRun.output || "Task completed with no output text.",
        };
      } else if (childRun.status === "awaiting_approval") {
        return {
          status: "awaiting_approval",
          agent: target.name,
          version: ver,
          childRunId,
          note: `The delegated agent "${target.name}" requested a gated action that requires human review. It is waiting in the workspace Approvals queue.`,
        };
      } else if (childRun.status === "failed") {
        throw new Error(
          `Delegated agent "${target.name}" failed: ${childRun.error || "Execution terminated unexpectedly"}`,
        );
      } else {
        return {
          status: childRun.status,
          agent: target.name,
          version: ver,
          childRunId,
          output: childRun.output || `Delegated run status: ${childRun.status}`,
        };
      }
    },
  },

  {
    id: "load_skill",
    label: "Open a skill",
    description:
      "Read one of the skills listed in your system prompt in full. The prompt carries only each skill's " +
      "one-line summary; call this to get the actual instructions before you rely on one.",
    risk: "low",
    implicit: true,
    schema: {
      type: "object",
      properties: { name: { type: "string", description: "The skill's name, exactly as listed in the prompt" } },
      required: ["name"],
    },
    async run({ name }, ctx) {
      const list = ctx.skills || [];
      const wanted = skillName(name);
      // Matched on the slug, then on a slugged label, because a model asked for
      // "Invoice Reconciliation" as readily as for "invoice-reconciliation".
      const found = list.find((s) => s.name === wanted) || list.find((s) => skillName(s.label) === wanted);
      if (!found) {
        throw new Error(
          list.length
            ? `No skill called "${name}" is attached to this agent. The ones that are: ${list.map((s) => s.name).join(", ")}.`
            : `This agent has no skills attached, so there is nothing to open.`,
        );
      }
      return { skill: found.name, description: found.description, instructions: found.instructions };
    },
  },

  {
    id: "present_result",
    label: "Present the result",
    description:
      "Present your result to the user as a dashboard (with Excel, PDF and PowerPoint downloads): headline figures, charts, " +
      "tables, findings and actions. Give any figure, chart or table that comes from the database or an uploaded file as a " +
      "`sql` SELECT — the app runs it and shows the exact result — rather than typing the numbers in. Over uploaded files, select from the " +
      "views you saved with query_files, so each query stays short. Call it once, when the work is done.",
    risk: "low",
    implicit: true,
    schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title, e.g. 'Payment run check — 7 Oct 2026'" },
        subtitle: { type: "string", description: "One line under the title: scope, period, source" },
        summary: { type: "string", description: "Two to four sentences: what was found and what matters most" },
        currency: { type: "string", description: "ISO currency code for money figures, default INR" },
        source: {
          type: "string",
          enum: ["database", "files"],
          description: "Where the sql queries run: the connected database, or the run's uploaded files (as in query_files). Default: the database when one is connected, otherwise the files",
        },
        connection: { type: "string", description: "Connection for the sql queries, optional if only one is granted" },
        document: { type: "string", description: "Database queries only: an uploaded CSV to attach to every sql query as the table `upload`" },
        kpis: {
          type: "array",
          description: "Two to six headline figures",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              sql: { type: "string", description: "SELECT returning one value (first column of the first row)" },
              value: { type: "string", description: "Only when there is no sql: the figure, numbers as plain digits" },
              format: { type: "string", enum: ["currency", "number", "integer", "percent", "text"] },
              tone: { type: "string", enum: ["good", "bad", "warn", "neutral"], description: "bad/warn for problems, good for clean results" },
              note: { type: "string", description: "A few words of context" },
            },
            required: ["label"],
          },
        },
        charts: {
          type: "array",
          description: "Up to four charts",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              kind: { type: "string", enum: ["bar", "line", "donut"], description: "bar to compare, line over time, donut for parts of a whole" },
              sql: { type: "string", description: "SELECT whose first column is the category label and each further column one series of numbers" },
              categories: { type: "array", items: { type: "string" }, description: "Only when there is no sql" },
              series: {
                type: "array",
                description: "Only when there is no sql",
                items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } } },
              },
              format: { type: "string", enum: ["currency", "number", "integer", "percent"] },
              note: { type: "string" },
            },
            required: ["title", "kind"],
          },
        },
        tables: {
          type: "array",
          description: "The detail, one table per list (e.g. Remove from this run, Held, For review)",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              sql: { type: "string", description: "SELECT returning the table's rows; column names become headings" },
              columns: {
                type: "array",
                description: "Optional headings and formats, by result column name",
                items: {
                  type: "object",
                  properties: {
                    key: { type: "string" },
                    label: { type: "string" },
                    format: { type: "string", enum: ["currency", "number", "integer", "percent", "date", "text"] },
                  },
                  required: ["key"],
                },
              },
              rows: { type: "array", items: { type: "object" }, description: "Only when there is no sql" },
              note: { type: "string" },
            },
            required: ["title"],
          },
        },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tone: { type: "string", enum: ["good", "bad", "warn", "neutral"] },
              title: { type: "string" },
              detail: { type: "string" },
            },
            required: ["title"],
          },
        },
        actions: {
          type: "array",
          description: "What someone should do next",
          items: { type: "object", properties: { text: { type: "string" }, owner: { type: "string" } }, required: ["text"] },
        },
      },
      required: ["title"],
    },
    async run(input, ctx) {
      const { normalizeDeliverable, humanize, guessFormat, CHART_CATEGORY_CAP, TABLE_ROW_CAP, formatValue } = await import("./deliverable");
      const kpis = Array.isArray(input.kpis) ? input.kpis : [];
      const charts = Array.isArray(input.charts) ? input.charts : [];
      const tables = Array.isArray(input.tables) ? input.tables : [];
      const needsSql = [...kpis, ...charts, ...tables].some((x: any) => x && typeof x.sql === "string" && x.sql.trim());

      // Figures with a query are read here, so what the user sees is what the data says.
      const problems: string[] = [];
      let session: ReadOnlySession | null = null;
      if (needsSql) {
        const hasDb = Object.values(ctx.connections).some((c) => c.kind === "postgres");
        if (input.source === "files" || (!hasDb && input.source !== "database")) {
          const { runFiles, openFileSession, savedViews } = await import("./file-sql");
          const fs_ = await openFileSession(await runFiles(ctx), await savedViews(ctx));
          session = { connectionName: "", documentName: fs_.tables.map((t) => t.file).join(", "), select: fs_.select, close: async () => fs_.close() };
        } else session = await readOnlySession(ctx, input.connection, input.document);
      }
      try {
        const run = async (label: string, sql: string, limit: number) => {
          try {
            return await session!.select(sql, limit);
          } catch (e: any) {
            problems.push(`${label}: ${e?.message || e}`);
            return null;
          }
        };
        for (const k of kpis) {
          if (!k?.sql) {
            if (typeof k?.value === "string" && /^-?\d+(\.\d+)?$/.test(k.value.trim())) k.value = Number(k.value);
            continue;
          }
          const r = await run(`Figure "${k.label}"`, k.sql, 1);
          if (r) {
            const v = r.rows[0]?.[r.fields[0]];
            k.value = v === null || v === undefined ? null : /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : String(v);
          }
        }
        for (const c of charts) {
          if (!c?.sql) continue;
          const r = await run(`Chart "${c.title}"`, c.sql, CHART_CATEGORY_CAP);
          if (r && r.fields.length >= 2) {
            c.categories = r.rows.map((row) => String(row[r.fields[0]] ?? ""));
            c.series = r.fields.slice(1).map((f) => ({ name: humanize(f), values: r.rows.map((row) => Number(row[f]) || 0) }));
            // Money is shown as money: read from the first number column's name, as tables are.
            if (!c.format || c.format === "number") {
              const g = guessFormat(r.fields[1], r.rows.map((row) => row[r.fields[1]]));
              if (g === "currency" || g === "percent") c.format = g;
            }
          } else if (r) problems.push(`Chart "${c.title}": the query needs a label column and at least one number column.`);
        }
        for (const t of tables) {
          if (!t?.sql) continue;
          const r = await run(`Table "${t.title}"`, t.sql, TABLE_ROW_CAP + 1);
          if (r) {
            if (r.rows.length > TABLE_ROW_CAP) t.truncated = r.rows.length;
            t.rows = r.rows.slice(0, TABLE_ROW_CAP);
            if (!Array.isArray(t.columns) || !t.columns.length) t.columns = r.fields.map((key) => ({ key }));
          }
        }
      } finally {
        await session?.close().catch(() => {});
      }
      if (problems.length) {
        throw new Error(`Some queries failed, so nothing was shown yet. Fix them and call present_result again:\n- ${problems.join("\n- ")}`);
      }

      const d = normalizeDeliverable({
        ...input,
        kpis,
        charts,
        tables,
        sources: [session?.connectionName, ...(session?.documentName ? session.documentName.split(", ") : [])].filter(Boolean),
      });
      const row = await one<any>(
        `insert into deliverables (org_id, run_id, agent_id, spec) values ($1, $2, $3, $4) returning id`,
        [ctx.orgId, ctx.runId ?? null, ctx.agentId ?? null, JSON.stringify(d)],
      );
      return {
        deliverable: row.id,
        shown: {
          figures: d.kpis.map((k) => `${k.label}: ${formatValue(k.value, k.format, d.currency)}`),
          charts: d.charts.map((c) => `${c.title} (${c.categories.length} points)`),
          tables: d.tables.map((t) => `${t.title}: ${t.rows.length} rows`),
        },
        note:
          // A full set of figures with nothing drawn reads as a report, not a
          // dashboard. It is shown as it is, and the agent is asked once more.
          d.charts.length === 0 && d.kpis.length >= 3 && d.tables.length > 0
            ? "Shown, but with no charts. Call present_result again with the same content plus 1–3 charts (each with a sql query) that make the pattern visible — for example value by reason or by vendor as a bar, or the split of the total as a donut. The newer one replaces this. Then write your final message."
            : "The user now sees this as a dashboard with Excel, PDF and PowerPoint downloads. Use these exact figures in your final message, and keep it short: the dashboard carries the detail.",
      };
    },
  },
];

export const toolById = (id: string) => TOOLS.find((t) => t.id === id);

/** The tools a person may grant an agent. Implicit ones are the runtime's business. */
export const SELECTABLE_TOOLS = TOOLS.filter((t) => !t.implicit);

export const defaultGate = (risk: Risk) => (risk === "low" ? "auto" : "approval");

/**
 * Anthropic tool-use schema for the tools this agent has been granted.
 *
 * @param also  Implicit tool ids the runtime is adding — load_skill when the
 *              agent has skills. A spec can never grant one of these itself.
 */
export function anthropicTools(granted: { id: string }[], also: string[] = []) {
  const ids: string[] = [];
  for (const id of [...granted.map((g) => g.id), ...also]) {
    const def = toolById(id);
    if (!def || ids.includes(id)) continue;
    if (def.implicit && !also.includes(id)) continue;
    ids.push(id);
  }
  return ids.map((id) => {
    const t = toolById(id)!;
    return { name: t.id, description: t.description, input_schema: t.schema };
  });
}
