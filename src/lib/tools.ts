import fs from "fs/promises";
import path from "path";
import { Client as PgClient } from "pg";
import Papa from "papaparse";
import { decrypt } from "./crypto";
import { q, one } from "./db";
import { skillName, type SkillRow } from "./skills";
import type { Risk } from "./types";
import { assertSafeUrl } from "./ssrf";

export type ToolContext = {
  orgId: string;
  userId: string;
  connections: Record<string, ConnRow>; // keyed by connection id
  /** Skills granted to this agent, resolved by the orchestrator. */
  skills: SkillRow[];
  storageDir: string;
  /** Model credential for this workspace, resolved by the orchestrator. */
  apiKey: string;
  model: string;
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
    async run({ query }, ctx) {
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
      if (c.config?.allowWrites !== "yes") {
        throw new Error(
          `Write execution is disabled on connection "${c.name}". Enable "Allow write statements" in Connections settings to allow mutations.`
        );
      }
      const trimmed = String(sql || "").trim().replace(/;+\s*$/, "");
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
