import fs from "fs/promises";
import path from "path";
import { Client as PgClient } from "pg";
import Papa from "papaparse";
import { decrypt } from "./crypto";
import { q, one } from "./db";
import type { Risk } from "./types";

export type ToolContext = {
  orgId: string;
  userId: string;
  connections: Record<string, ConnRow>; // keyed by connection id
  storageDir: string;
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
  needs?: "postgres" | "http" | "smtp" | "slack";
  schema: Record<string, any>;
  run: (input: any, ctx: ToolContext) => Promise<any>;
};

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

function connOf(ctx: ToolContext, kind: string, id?: string): ConnRow {
  const list = Object.values(ctx.connections).filter((c) => c.kind === kind);
  const found = id ? list.find((c) => c.id === id || c.name === id) : list[0];
  if (!found) throw new Error(`No ${kind} connection is available to this agent. Add one under Connections and grant it to the agent.`);
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
  const raw = await fs.readFile(filePath, "utf8");
  if (ext === ".csv" || ext === ".tsv") {
    const parsed = Papa.parse(raw.trim(), { header: true, skipEmptyLines: true });
    const rows = parsed.data as any[];
    const cols = parsed.meta.fields || [];
    const head = rows.slice(0, 200);
    return [
      `Columns: ${cols.join(", ")}`,
      `Rows: ${rows.length} (showing first ${head.length})`,
      JSON.stringify(head),
    ].join("\n");
  }
  return raw;
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
    async run({ query }) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY || "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
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
      if (!/^https?:\/\//i.test(url)) throw new Error("URL must start with http:// or https://");
      const res = await fetch(url, {
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
      },
    },
    async run({ connection, sql, list_tables, limit }, ctx) {
      const c = connOf(ctx, "postgres", connection);
      const client = new PgClient({ connectionString: secretOf(c), connectionTimeoutMillis: 10_000 });
      await client.connect();
      try {
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
          return { connection: c.name, schema: byTable };
        }
        const trimmed = sql.trim().replace(/;+\s*$/, "");
        if (!/^(select|with)\b/i.test(trimmed) || /;/.test(trimmed)) {
          throw new Error("Only a single read-only SELECT (or WITH … SELECT) statement is permitted.");
        }
        const capped = /\blimit\b/i.test(trimmed) ? trimmed : `${trimmed} limit ${Math.min(limit || 200, 1000)}`;
        await client.query("set default_transaction_read_only = on");
        const r = await client.query(capped);
        return { connection: c.name, rowCount: r.rowCount, rows: r.rows.slice(0, 500) };
      } finally {
        await client.end();
      }
    },
  },

  {
    id: "read_document",
    label: "Read an uploaded document",
    description:
      "Read a file the user uploaded — CSV, PDF, DOCX or plain text. Call with no name to list what is available.",
    risk: "low",
    schema: {
      type: "object",
      properties: { name: { type: "string", description: "File name or id. Omit to list available documents." } },
    },
    async run({ name }, ctx) {
      const docs = await q<any>(
        `select id, name, mime, path, size_bytes from documents where org_id = $1 order by created_at desc limit 100`,
        [ctx.orgId],
      );
      if (!name) return { documents: docs.map((d) => ({ id: d.id, name: d.name, size: d.size_bytes })) };
      const doc = docs.find((d) => d.id === name || d.name === name || d.name.toLowerCase() === String(name).toLowerCase());
      if (!doc) throw new Error(`No document named "${name}". Available: ${docs.map((d) => d.name).join(", ") || "none"}`);
      const text = await parseDocument(doc.path, doc.name);
      return { name: doc.name, characters: text.length, content: clip(text, 20000) };
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
      },
      required: ["filename", "content"],
    },
    async run({ filename, content }, ctx) {
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
      return { file: safe, bytes: stat.size, downloadUrl: `/api/documents/${row.id}` };
    },
  },
];

export const toolById = (id: string) => TOOLS.find((t) => t.id === id);

export const defaultGate = (risk: Risk) => (risk === "low" ? "auto" : "approval");

/** Anthropic tool-use schema for the tools this agent has been granted. */
export function anthropicTools(granted: { id: string }[]) {
  return granted
    .map((g) => toolById(g.id))
    .filter(Boolean)
    .map((t) => ({
      name: t!.id,
      description: t!.description,
      input_schema: t!.schema,
    }));
}
