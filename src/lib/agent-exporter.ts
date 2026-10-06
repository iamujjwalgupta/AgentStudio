import crypto from "crypto";
import JSZip from "jszip";
import { buildSystemPrompt, MODEL } from "./ai";
import { SELECTABLE_TOOLS } from "./tools";
import type { AgentSpec, Gate } from "./types";
import type { SkillRow } from "./skills";

/**
 * Turns an agent into a package that runs on its own, outside Agent Studio:
 * the same instructions, skills and actions, with the same approval rule —
 * an action that asks first in Agent Studio does not run by itself here
 * either. It comes back to the caller as a held action, and runs only once
 * someone approves it (POST /approve). Actions that depend on this workspace
 * (its documents, its other agents) are left out and listed as such.
 *
 * The generated code is plain text. Static parts are written with String.raw
 * and never use template literals themselves, so nothing in them is read as
 * an interpolation here; values are joined in with JSON.stringify.
 */

export type ExportTarget = "gcp" | "aws" | "azure" | "docker" | "python";
export type ExportRuntime = "container" | "serverless";

export type ExportFile = {
  path: string;
  content: string;
  language: string;
  description: string;
};

export type ExportEnvVar = { key: string; description: string; hint: string; required: boolean };

export type ExportAction = {
  id: string;
  label: string;
  gate: Gate;
  /** False when the action only works inside Agent Studio and is left out of the package. */
  works: boolean;
  note: string;
  env: string[];
};

export type ExportBundle = {
  agentName: string;
  slug: string;
  version: number | null;
  target: ExportTarget;
  runtime: ExportRuntime;
  files: ExportFile[];
  requiredEnvVars: ExportEnvVar[];
  deployCommand: string;
  actions: ExportAction[];
  skills: { label: string; included: boolean }[];
  /** What the agent has in Agent Studio that the package does not bring along. */
  notCarried: string[];
  /** For calling the agent through Agent Studio itself rather than the package. */
  call: {
    inputs: { key: string; label: string; required: boolean }[];
    rateLimitRpm: number;
    dlp: boolean;
  };
};

const js = String.raw;
const py = String.raw;

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent"
  );
}

/** Runtime choice only means something where a platform offers both. */
export function runtimeFor(target: ExportTarget, runtime: ExportRuntime): ExportRuntime {
  return target === "gcp" || target === "aws" ? runtime : "container";
}

// ---- actions ------------------------------------------------------------------------

type Support = {
  works: boolean;
  note: string;
  env: string[];
  node?: Record<string, string>;
  python?: string[];
};

const PG = { node: { pg: "^8.13.1" }, python: ["psycopg[binary]>=3.1"] };

const SUPPORT: Record<string, Support> = {
  web_search: { works: true, note: "Uses the same Anthropic key as the agent.", env: [] },
  fetch_url: { works: true, note: "", env: [] },
  sql_query: { works: true, note: "Read-only, against one PostgreSQL database.", env: ["DATABASE_URL"], ...PG },
  sql_execute: { works: true, note: "Against one PostgreSQL database.", env: ["DATABASE_URL"], ...PG },
  http_request: { works: true, note: "Against one API, set by its base URL.", env: ["API_BASE_URL", "API_SECRET_KEY"] },
  send_email: {
    works: true,
    note: "Through your SMTP server.",
    env: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"],
    node: { nodemailer: "^6.9.16" },
  },
  post_message: { works: true, note: "Through a Slack incoming webhook.", env: ["SLACK_WEBHOOK_URL"] },
  post_teams_message: { works: true, note: "Through a Teams incoming webhook.", env: ["MSTEAMS_WEBHOOK_URL"] },
  s3_upload_file: {
    works: true,
    note: "To one S3 or S3-compatible bucket.",
    env: ["AWS_S3_BUCKET", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_S3_ENDPOINT"],
    python: ["boto3>=1.34"],
  },
  jira_create_issue: {
    works: true,
    note: "In one Jira site.",
    env: ["JIRA_HOST", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_DEFAULT_PROJECT"],
  },
  jira_search_issues: { works: true, note: "In one Jira site.", env: ["JIRA_HOST", "JIRA_EMAIL", "JIRA_API_TOKEN"] },
  github_create_issue: { works: true, note: "With one GitHub token.", env: ["GITHUB_TOKEN", "GITHUB_DEFAULT_REPO"] },
  github_read_file: { works: true, note: "With one GitHub token.", env: ["GITHUB_TOKEN", "GITHUB_DEFAULT_REPO"] },
  write_file: {
    works: true,
    note: "Into an output folder beside the service, as text. Container disks are temporary.",
    env: [],
  },
  kv_get: { works: true, note: "In one Redis store.", env: ["REDIS_URL", "REDIS_KEY_PREFIX"], python: ["redis>=5.0"] },
  kv_set: { works: true, note: "In one Redis store.", env: ["REDIS_URL", "REDIS_KEY_PREFIX"], python: ["redis>=5.0"] },
  read_document: {
    works: false,
    note: "Reads documents uploaded to this workspace, which stay in Agent Studio.",
    env: [],
  },
  invoke_agent: {
    works: false,
    note: "Hands work to other agents in this workspace, which are not part of the package.",
    env: [],
  },
};

const UNKNOWN: Support = { works: false, note: "Only available inside Agent Studio.", env: [] };

function exportActions(spec: AgentSpec): ExportAction[] {
  return (spec.tools || []).map((t) => {
    const def = SELECTABLE_TOOLS.find((d) => d.id === t.id);
    const s = SUPPORT[t.id] ?? UNKNOWN;
    return {
      id: t.id,
      label: def?.label ?? t.id,
      gate: t.gate === "approval" ? "approval" : "auto",
      works: Boolean(def) && s.works,
      note: s.note,
      env: s.env,
    };
  });
}

/** Tool definitions for the model, without the Agent Studio "connection" argument: the package has one of each. */
function toolDefinitions(actions: ExportAction[], hasSkills: boolean) {
  const out: { name: string; description: string; input_schema: any }[] = [];
  for (const a of actions) {
    if (!a.works) continue;
    const def = SELECTABLE_TOOLS.find((d) => d.id === a.id)!;
    const schema = JSON.parse(JSON.stringify(def.schema));
    // Agent Studio-only arguments: the package has one connection of each kind,
    // and no uploaded documents to query or copy.
    if (schema.properties) {
      for (const k of ["connection", "document", "source_document", "drop_rows"]) delete schema.properties[k];
    }
    if (Array.isArray(schema.required)) schema.required = schema.required.filter((r: string) => r !== "connection");
    out.push({ name: def.id, description: def.description, input_schema: schema });
  }
  if (hasSkills) {
    out.push({
      name: "load_skill",
      description: "Read the full instructions of one of your skills before doing the work it covers.",
      input_schema: {
        type: "object",
        properties: { name: { type: "string", description: "The skill's name" } },
        required: ["name"],
      },
    });
  }
  return out;
}

// ---- settings ---------------------------------------------------------------------------

const ENV: Record<string, { description: string; hint: string; required: boolean }> = {
  ANTHROPIC_API_KEY: { description: "Anthropic API key the agent runs on", hint: "sk-ant-...", required: true },
  ANTHROPIC_MODEL: { description: "Model to use", hint: MODEL, required: false },
  AGENT_API_TOKEN: {
    description: "Callers must send it as Authorization: Bearer <token>. Calls are refused while it is empty.",
    hint: "a long random string",
    required: true,
  },
  APPROVE_ALL_ACTIONS: {
    description: "true lets actions that need approval run without asking. Leave it off unless nobody needs to check them.",
    hint: "false",
    required: false,
  },
  DATABASE_URL: { description: "PostgreSQL connection string", hint: "postgres://user:password@host:5432/dbname", required: true },
  API_BASE_URL: { description: "Base URL of the API the agent calls", hint: "https://api.example.com", required: true },
  API_SECRET_KEY: { description: "Sent to that API as a Bearer token", hint: "token", required: false },
  SMTP_HOST: { description: "SMTP server", hint: "smtp.sendgrid.net", required: true },
  SMTP_PORT: { description: "SMTP port (465 for SSL, otherwise STARTTLS)", hint: "587", required: false },
  SMTP_USER: { description: "SMTP user name", hint: "apikey", required: true },
  SMTP_PASS: { description: "SMTP password or token", hint: "password", required: true },
  SMTP_FROM: { description: "From address (defaults to SMTP_USER)", hint: "agent@company.com", required: false },
  SLACK_WEBHOOK_URL: { description: "Slack incoming webhook", hint: "https://hooks.slack.com/services/...", required: true },
  MSTEAMS_WEBHOOK_URL: { description: "Teams incoming webhook", hint: "https://company.webhook.office.com/...", required: true },
  AWS_S3_BUCKET: { description: "Bucket to upload to", hint: "my-reports", required: true },
  AWS_REGION: { description: "Bucket region", hint: "us-east-1", required: false },
  AWS_ACCESS_KEY_ID: { description: "AWS access key (not needed where the platform provides a role)", hint: "AKIA...", required: true },
  AWS_SECRET_ACCESS_KEY: { description: "AWS secret key", hint: "secret", required: true },
  AWS_S3_ENDPOINT: { description: "Only for S3-compatible storage (R2, MinIO)", hint: "https://<account>.r2.cloudflarestorage.com", required: false },
  JIRA_HOST: { description: "Jira site", hint: "https://company.atlassian.net", required: true },
  JIRA_EMAIL: { description: "Jira account email", hint: "you@company.com", required: true },
  JIRA_API_TOKEN: { description: "Jira API token", hint: "token", required: true },
  JIRA_DEFAULT_PROJECT: { description: "Project key when the agent names none", hint: "FIN", required: false },
  GITHUB_TOKEN: { description: "GitHub token", hint: "ghp_...", required: true },
  GITHUB_DEFAULT_REPO: { description: "Repository when the agent names none", hint: "owner/repo", required: false },
  REDIS_URL: { description: "Redis URL (rediss:// for TLS)", hint: "redis://:password@host:6379/0", required: true },
  REDIS_KEY_PREFIX: { description: "Prefix for every key", hint: "agent", required: false },
};

function envVars(actions: ExportAction[]): ExportEnvVar[] {
  const keys = ["ANTHROPIC_API_KEY", "AGENT_API_TOKEN", "ANTHROPIC_MODEL"];
  if (actions.some((a) => a.works && a.gate === "approval")) keys.push("APPROVE_ALL_ACTIONS");
  for (const a of actions) if (a.works) for (const k of a.env) if (!keys.includes(k)) keys.push(k);
  return keys.map((key) => ({ key, ...ENV[key] }));
}

function envExample(name: string, vars: ExportEnvVar[]): string {
  const token = crypto.randomBytes(24).toString("hex");
  const lines = [
    `# Settings for "${name}". Copy to .env and fill in; never commit .env.`,
    `# Lines starting with # are optional.`,
    ``,
  ];
  for (const v of vars) {
    lines.push(`# ${v.description}${v.required ? "" : ` (optional, e.g. ${v.hint})`}`);
    if (v.key === "AGENT_API_TOKEN") lines.push(`${v.key}=${token}`);
    else if (v.required) lines.push(`${v.key}=`);
    else lines.push(`# ${v.key}=${v.hint}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Things the agent has in Agent Studio that do not come with the package, said plainly. */
function notCarried(spec: AgentSpec, actions: ExportAction[]): string[] {
  const out: string[] = [];
  if (actions.some((a) => a.works && a.gate === "approval"))
    out.push("The Approvals inbox: held actions come back in the response, and you approve them with POST /approve.");
  out.push("Run history, the audit trail and usage limits.");
  if (spec.guardrails?.dlpEnabled) out.push("Masking of personal data (DLP) on inputs and answers.");
  if (spec.guardrails?.rateLimitRpm) out.push(`The limit of ${spec.guardrails.rateLimitRpm} calls a minute.`);
  if (spec.trigger?.type === "schedule")
    out.push("Its schedule: have a scheduler (Cloud Scheduler, EventBridge, cron) call POST /run.");
  if (spec.swarm?.enabled) out.push("Its team of agents: the package runs this agent alone.");
  for (const a of actions) if (!a.works) out.push(`${a.label}: ${a.note}`);
  if ((spec.sources || []).length || actions.some((a) => a.works && a.env.length))
    out.push("This workspace's connections: the package uses its own settings (.env) instead.");
  return out;
}

// ---- Node.js ------------------------------------------------------------------------

const NODE_ACTIONS: Record<string, string> = {
  web_search: js`
  async web_search(input, ctx) {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [{ role: "user", content: "Search the web and answer factually with source URLs. Question: " + input.query }]
    });
    countUsage(ctx, res.usage);
    const answer = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const sources = new Set();
    for (const b of res.content) {
      for (const c of b.citations || []) if (c.url) sources.add(c.url);
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url) sources.add(r.url);
    }
    return { answer: answer.slice(0, 8000), sources: Array.from(sources).slice(0, 12) };
  },`,
  fetch_url: js`
  async fetch_url(input) {
    const url = String(input.url || "");
    if (!/^https?:\/\//i.test(url)) throw new Error("Give an absolute http(s) URL.");
    const res = await fetch(url, { headers: { "user-agent": "AgentStudio-Export/1.0" }, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    return { status: res.status, text: text.slice(0, 12000) };
  },`,
  sql_query: js`
  async sql_query(input) {
    const client = new pg.Client({ connectionString: need("DATABASE_URL"), connectionTimeoutMillis: 10000 });
    await client.connect();
    try {
      await client.query("begin read only");
      if (input.list_tables || !input.sql) {
        const r = await client.query("select table_schema, table_name, column_name, data_type from information_schema.columns where table_schema not in ('pg_catalog', 'information_schema') order by table_schema, table_name, ordinal_position limit 800");
        return { schema: r.rows };
      }
      const sql = String(input.sql).trim().replace(/;+\s*$/, "");
      if (!/^(select|with)\b/i.test(sql) || sql.includes(";")) throw new Error("Only a single SELECT statement is allowed.");
      const limit = Math.min(Math.max(Number(input.limit) || 200, 1), 500);
      const r = await client.query("select * from (" + sql + ") as result limit " + limit);
      return { rowCount: r.rowCount, rows: r.rows };
    } finally {
      await client.query("rollback").catch(() => {});
      await client.end();
    }
  },`,
  sql_execute: js`
  async sql_execute(input) {
    const sql = String(input.sql || "").trim().replace(/;+\s*$/, "");
    if (sql.includes(";")) throw new Error("One statement at a time.");
    if (!/^(insert\s+into|update|delete\s+from)\b/i.test(sql)) throw new Error("Only INSERT, UPDATE or DELETE is allowed.");
    const client = new pg.Client({ connectionString: need("DATABASE_URL"), connectionTimeoutMillis: 15000 });
    await client.connect();
    try {
      const r = await client.query(sql);
      return { command: r.command, rowCount: r.rowCount };
    } finally {
      await client.end();
    }
  },`,
  http_request: js`
  async http_request(input) {
    const base = need("API_BASE_URL").replace(/\/+$/, "");
    const p = String(input.path || "");
    const url = new URL(base + (p.startsWith("/") ? p : "/" + p));
    for (const [k, v] of Object.entries(input.query || {})) url.searchParams.set(k, String(v));
    const headers = { accept: "application/json" };
    if (process.env.API_SECRET_KEY) headers.authorization = "Bearer " + process.env.API_SECRET_KEY;
    if (input.body) headers["content-type"] = "application/json";
    const res = await fetch(url, {
      method: input.method || "GET",
      headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: AbortSignal.timeout(30000)
    });
    const text = await res.text();
    return { status: res.status, body: text.slice(0, 10000) };
  },`,
  send_email: js`
  async send_email(input) {
    const port = Number(process.env.SMTP_PORT || 587);
    const transport = nodemailer.createTransport({
      host: need("SMTP_HOST"),
      port,
      secure: port === 465,
      auth: { user: need("SMTP_USER"), pass: need("SMTP_PASS") }
    });
    const body = String(input.body || "");
    const html = /<\/?[a-z][^>]*>/i.test(body);
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: input.to,
      subject: input.subject,
      ...(html ? { html: body } : { text: body })
    });
    return { sent: true, accepted: info.accepted, messageId: info.messageId };
  },`,
  post_message: js`
  async post_message(input) {
    const res = await fetch(need("SLACK_WEBHOOK_URL"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: input.text })
    });
    if (!res.ok) throw new Error("Slack refused the message (" + res.status + "): " + (await res.text()).slice(0, 300));
    return { posted: true };
  },`,
  post_teams_message: js`
  async post_teams_message(input) {
    const card = {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      summary: input.title || "Message from agent",
      ...(input.title ? { title: input.title } : {}),
      text: input.text
    };
    const res = await fetch(need("MSTEAMS_WEBHOOK_URL"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(card)
    });
    if (!res.ok) throw new Error("Teams refused the message (" + res.status + "): " + (await res.text()).slice(0, 300));
    return { posted: true };
  },`,
  s3_upload_file: js`
  async s3_upload_file(input) {
    // A signed PUT (AWS Signature Version 4), so no AWS SDK is needed.
    const bucket = need("AWS_S3_BUCKET");
    const region = process.env.AWS_REGION || "us-east-1";
    const keyId = need("AWS_ACCESS_KEY_ID");
    const secret = need("AWS_SECRET_ACCESS_KEY");
    const key = String(input.key || "").replace(/^\/+/, "");
    if (!key) throw new Error("Give the file's key (its path in the bucket).");
    const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
    let origin, objectPath;
    if (process.env.AWS_S3_ENDPOINT) {
      const e = new URL(/^https?:/.test(process.env.AWS_S3_ENDPOINT) ? process.env.AWS_S3_ENDPOINT : "https://" + process.env.AWS_S3_ENDPOINT);
      origin = e.protocol + "//" + e.host;
      objectPath = e.pathname.replace(/\/+$/, "") + "/" + enc(bucket) + "/" + key.split("/").map(enc).join("/");
    } else {
      origin = "https://" + bucket + (region === "us-east-1" ? ".s3.amazonaws.com" : ".s3." + region + ".amazonaws.com");
      objectPath = "/" + key.split("/").map(enc).join("/");
    }
    const body = Buffer.from(String(input.content ?? ""), "utf8");
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const day = amzDate.slice(0, 8);
    const hash = (d) => crypto.createHash("sha256").update(d).digest("hex");
    const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
    const headers = {
      "content-type": input.contentType || "text/plain; charset=utf-8",
      host: new URL(origin).host,
      "x-amz-content-sha256": hash(body),
      "x-amz-date": amzDate
    };
    if (process.env.AWS_SESSION_TOKEN) headers["x-amz-security-token"] = process.env.AWS_SESSION_TOKEN;
    const names = Object.keys(headers).sort();
    const canonical = ["PUT", objectPath, "", names.map((n) => n + ":" + String(headers[n]).trim() + "\n").join(""), names.join(";"), headers["x-amz-content-sha256"]].join("\n");
    const scope = day + "/" + region + "/s3/aws4_request";
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hash(canonical)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac("AWS4" + secret, day), region), "s3"), "aws4_request");
    const signature = crypto.createHmac("sha256", signingKey).update(toSign).digest("hex");
    const sent = { ...headers };
    delete sent.host;
    sent.authorization = "AWS4-HMAC-SHA256 Credential=" + keyId + "/" + scope + ", SignedHeaders=" + names.join(";") + ", Signature=" + signature;
    const res = await fetch(origin + objectPath, { method: "PUT", headers: sent, body, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error("S3 upload failed (" + res.status + "): " + (await res.text()).slice(0, 400));
    return { uploaded: true, bucket, key, bytes: body.length };
  },`,
  jira_create_issue: js`
  async jira_create_issue(input) {
    const host = need("JIRA_HOST").replace(/\/+$/, "");
    const project = input.project || need("JIRA_DEFAULT_PROJECT");
    const res = await fetch(host + "/rest/api/3/issue", {
      method: "POST",
      headers: { authorization: jiraAuth(), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        fields: {
          project: { key: project },
          summary: input.summary,
          issuetype: { name: input.issueType || "Task" },
          description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: String(input.description || "") }] }] }
        }
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("Jira refused the issue (" + res.status + "): " + JSON.stringify(data.errors || data.errorMessages || data).slice(0, 400));
    return { key: data.key, url: host + "/browse/" + data.key };
  },`,
  jira_search_issues: js`
  async jira_search_issues(input) {
    const host = need("JIRA_HOST").replace(/\/+$/, "");
    const max = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
    const res = await fetch(host + "/rest/api/3/search?jql=" + encodeURIComponent(input.jql) + "&maxResults=" + max + "&fields=summary,status,assignee,created,priority,issuetype", {
      headers: { authorization: jiraAuth(), accept: "application/json" }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("Jira search failed (" + res.status + "): " + JSON.stringify(data.errorMessages || data).slice(0, 400));
    return {
      total: data.total,
      issues: (data.issues || []).map((i) => ({
        key: i.key,
        summary: i.fields?.summary,
        status: i.fields?.status?.name,
        assignee: i.fields?.assignee?.displayName || null,
        type: i.fields?.issuetype?.name,
        created: i.fields?.created
      }))
    };
  },`,
  github_create_issue: js`
  async github_create_issue(input) {
    const repo = input.repo || need("GITHUB_DEFAULT_REPO");
    const res = await fetch("https://api.github.com/repos/" + repo + "/issues", {
      method: "POST",
      headers: { authorization: "Bearer " + need("GITHUB_TOKEN"), "user-agent": "AgentStudio-Export", accept: "application/vnd.github+json", "content-type": "application/json" },
      body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels || [] })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("GitHub refused the issue (" + res.status + "): " + (data.message || ""));
    return { number: data.number, url: data.html_url };
  },`,
  github_read_file: js`
  async github_read_file(input) {
    const repo = input.repo || need("GITHUB_DEFAULT_REPO");
    const url = new URL("https://api.github.com/repos/" + repo + "/contents/" + String(input.path || "").replace(/^\/+/, ""));
    if (input.ref) url.searchParams.set("ref", input.ref);
    const res = await fetch(url, { headers: { authorization: "Bearer " + need("GITHUB_TOKEN"), "user-agent": "AgentStudio-Export", accept: "application/vnd.github+json" } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("GitHub could not read the file (" + res.status + "): " + (data.message || ""));
    if (Array.isArray(data)) return { path: input.path, directory: data.map((f) => ({ name: f.name, type: f.type })) };
    const content = data.encoding === "base64" ? Buffer.from(data.content || "", "base64").toString("utf8") : String(data.content || "");
    return { path: data.path, content: content.slice(0, 15000) };
  },`,
  write_file: js`
  async write_file(input) {
    const dir = process.env.OUTPUT_DIR || "./output";
    await fs.mkdir(dir, { recursive: true });
    const name = path.basename(String(input.filename || "output.txt")).replace(/[^\w.\- ]+/g, "_");
    const content = String(input.content ?? "");
    await fs.writeFile(path.join(dir, name), content, "utf8");
    return { file: name, folder: dir, bytes: Buffer.byteLength(content) };
  },`,
  kv_get: js`
  async kv_get(input) {
    const value = await redis(["GET", kvKey(input.key)]);
    return { key: input.key, found: value !== null, value };
  },`,
  kv_set: js`
  async kv_set(input) {
    const ttl = Math.floor(Number(input.ttlSeconds) || 0);
    const args = ["SET", kvKey(input.key), String(input.value ?? "")];
    if (ttl > 0) args.push("EX", String(ttl));
    await redis(args);
    return { key: input.key, set: true, ttlSeconds: ttl || null };
  },`,
};

const NODE_JIRA = js`
function jiraAuth() {
  return "Basic " + Buffer.from(need("JIRA_EMAIL") + ":" + need("JIRA_API_TOKEN")).toString("base64");
}
`;

const NODE_REDIS = js`
function kvKey(key) {
  const prefix = process.env.REDIS_KEY_PREFIX;
  return prefix ? prefix + ":" + key : String(key);
}

/** One Redis command over a short-lived connection (RESP protocol), with AUTH and SELECT from REDIS_URL. */
function redis(command) {
  const u = new URL(need("REDIS_URL"));
  const secure = u.protocol === "rediss:";
  const port = Number(u.port || 6379);
  const commands = [];
  if (u.password) commands.push(u.username ? ["AUTH", decodeURIComponent(u.username), decodeURIComponent(u.password)] : ["AUTH", decodeURIComponent(u.password)]);
  const db = u.pathname.replace(/^\//, "");
  if (db) commands.push(["SELECT", db]);
  commands.push(command);
  const encode = (args) => "*" + args.length + "\r\n" + args.map((a) => "$" + Buffer.byteLength(String(a)) + "\r\n" + a + "\r\n").join("");
  const parse = (buf) => {
    const end = buf.indexOf("\r\n");
    if (end < 0) return null;
    const type = String.fromCharCode(buf[0]);
    const line = buf.subarray(1, end).toString("utf8");
    if (type === "-") return { value: new Error(line), used: end + 2 };
    if (type === ":") return { value: Number(line), used: end + 2 };
    if (type === "$") {
      const len = Number(line);
      if (len < 0) return { value: null, used: end + 2 };
      if (buf.length < end + 2 + len + 2) return null;
      return { value: buf.subarray(end + 2, end + 2 + len).toString("utf8"), used: end + 2 + len + 2 };
    }
    return { value: line, used: end + 2 };
  };
  return new Promise((resolve, reject) => {
    const socket = secure ? tls.connect({ host: u.hostname, port, servername: u.hostname }) : net.connect({ host: u.hostname, port });
    let buf = Buffer.alloc(0);
    const replies = [];
    socket.setTimeout(10000, () => { socket.destroy(); reject(new Error("Redis did not answer in time.")); });
    socket.on(secure ? "secureConnect" : "connect", () => socket.write(commands.map(encode).join("")));
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let r;
      while ((r = parse(buf))) {
        buf = buf.subarray(r.used);
        replies.push(r.value);
        if (replies.length === commands.length) {
          socket.end();
          const failed = replies.find((x) => x instanceof Error);
          return failed ? reject(failed) : resolve(replies[replies.length - 1]);
        }
      }
    });
  });
}
`;

const NODE_CORE = js`
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

function need(key) {
  const value = process.env[key];
  if (!value) throw new Error(key + " is not set. Add it to the environment (see .env.example).");
  return value;
}

function countUsage(ctx, usage) {
  if (!ctx || !usage) return;
  ctx.usage.inputTokens += usage.input_tokens || 0;
  ctx.usage.outputTokens += usage.output_tokens || 0;
}

function loadSkill(input) {
  const wanted = String((input && input.name) || "").toLowerCase();
  const skill = SKILLS[input && input.name] || Object.values(SKILLS).find((s) => s.name.toLowerCase() === wanted || s.label.toLowerCase() === wanted);
  if (!skill) return { error: "No skill called " + JSON.stringify(input && input.name) + ". Available: " + Object.keys(SKILLS).join(", ") };
  return { skill: skill.label, instructions: skill.instructions };
}

const HELD = {
  status: "held_for_approval",
  message: "Not done: this action needs a person's approval, and the exact request has been passed to them. Do not repeat it. Finish the rest of the work, and say in your answer what is waiting for approval."
};

/** Carries out one action without asking. Used for automatic actions, and for held ones once a person approves. */
export async function performAction(name, input, ctx) {
  if (!ACTIONS[name] || !RUN[name]) throw new Error(JSON.stringify(name) + " is not an action this agent can take.");
  return RUN[name](input || {}, ctx || { usage: { inputTokens: 0, outputTokens: 0 } });
}

/** Performs an action a run held for approval, after a person has checked it. Only held kinds of action are accepted. */
export async function approveAction(held) {
  const name = held && held.action;
  if (!ACTIONS[name] || !ACTIONS[name].approval) throw Object.assign(new Error("Only actions that need approval can be approved here."), { status: 400 });
  const result = await performAction(name, held.input || {});
  return { action: name, label: ACTIONS[name].label, performed: true, result };
}

/** True when the Authorization header carries AGENT_API_TOKEN. With no token set, nothing is authorised. */
export function authorised(header) {
  const token = process.env.AGENT_API_TOKEN || "";
  if (!token) return false;
  const given = Buffer.from(String(header || "").replace(/^Bearer\s+/i, "").trim());
  const wanted = Buffer.from(token);
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
}

/**
 * One run: the model works through its procedure, calling actions. Automatic
 * actions run; actions that need approval are held and returned in
 * heldActions, unless APPROVE_ALL_ACTIONS is true.
 */
export async function runAgent(input, inputs) {
  const started = Date.now();
  let prompt = String(input || "").trim() || "Begin the work described in your procedure.";
  const pairs = Object.entries(inputs || {});
  if (pairs.length) prompt = "INPUTS:\n" + pairs.map(([k, v]) => "- " + k + ": " + v).join("\n") + "\n\nINSTRUCTION:\n" + prompt;

  const ctx = { usage: { inputTokens: 0, outputTokens: 0 } };
  const messages = [{ role: "user", content: prompt }];
  const steps = [];
  const heldActions = [];
  let output = "";
  let calls = 0;
  let stoppedAtLimit = false;

  for (let turn = 0; turn < MAX_STEPS + 2; turn++) {
    const res = await anthropic.messages.create({ model: MODEL, max_tokens: 4000, system: SYSTEM_PROMPT, ...(TOOLS.length ? { tools: TOOLS } : {}), messages });
    countUsage(ctx, res.usage);
    messages.push({ role: "assistant", content: res.content });
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (text) output = text;
    const uses = res.content.filter((b) => b.type === "tool_use");
    if (!uses.length) break;

    const results = [];
    for (const use of uses) {
      const t0 = Date.now();
      let result;
      let status = "done";
      if (calls >= MAX_STEPS) {
        stoppedAtLimit = true;
        status = "skipped";
        result = { error: "Step limit reached. Do not call any more tools; write your final answer with what you have." };
      } else {
        calls++;
        const action = ACTIONS[use.name];
        if (use.name === "load_skill") {
          result = loadSkill(use.input);
        } else if (action && action.approval && !APPROVE_ALL) {
          heldActions.push({ id: use.id, action: use.name, label: action.label, input: use.input });
          result = HELD;
          status = "held";
        } else {
          try {
            result = await performAction(use.name, use.input, ctx);
          } catch (err) {
            result = { error: (err && err.message) || String(err) };
            status = "failed";
          }
        }
      }
      steps.push({ action: use.name, input: use.input, status, output: result, durationMs: Date.now() - t0 });
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result).slice(0, 30000), ...(status === "failed" ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }

  return {
    agent: AGENT.name,
    version: AGENT.version,
    status: heldActions.length ? "needs_approval" : stoppedAtLimit ? "stopped_at_step_limit" : "completed",
    output,
    heldActions,
    steps,
    usage: { model: MODEL, ...ctx.usage },
    durationMs: Date.now() - started
  };
}
`;

const NODE_CLI = js`
// node runner.mjs "your question"
if (process.argv[1] && /runner\.mjs$/.test(process.argv[1])) {
  const question = process.argv.slice(2).join(" ");
  console.log("Running " + JSON.stringify(AGENT.name) + "...\n");
  runAgent(question)
    .then((r) => {
      console.log(r.output || "(no answer)");
      console.log("\n" + r.steps.length + " step(s). Status: " + r.status);
      for (const h of r.heldActions) console.log("\nWaiting for approval: " + h.label + "\n" + JSON.stringify(h.input, null, 2));
      if (r.heldActions.length) console.log("\nNothing above was carried out. Start the service and POST an approved one to /approve.");
    })
    .catch((err) => {
      console.error("Run failed:", (err && err.message) || err);
      process.exit(1);
    });
}
`;

type Built = {
  spec: AgentSpec;
  name: string;
  version: number | null;
  systemPrompt: string;
  skills: SkillRow[];
  actions: ExportAction[];
};

function commentSafe(s: string) {
  return s.replace(/\*\//g, "* /").replace(/[\r\n]+/g, " ");
}

function versionLabel(version: number | null) {
  return version ? `version ${version}` : "unpublished draft";
}

function skillDict(skills: SkillRow[]) {
  const out: Record<string, { name: string; label: string; instructions: string }> = {};
  for (const s of skills) out[s.name] = { name: s.name, label: s.label, instructions: s.instructions };
  return out;
}

function actionMeta(actions: ExportAction[]) {
  const out: Record<string, { label: string; approval: boolean }> = {};
  for (const a of actions) if (a.works) out[a.id] = { label: a.label, approval: a.gate === "approval" };
  return out;
}

function buildNodeRunner(b: Built): string {
  const working = b.actions.filter((a) => a.works);
  const ids = new Set(working.map((a) => a.id));
  const has = (...x: string[]) => x.some((i) => ids.has(i));
  const imports = [
    `import Anthropic from "@anthropic-ai/sdk";`,
    `import crypto from "crypto";`,
    has("sql_query", "sql_execute") ? `import pg from "pg";` : "",
    has("send_email") ? `import nodemailer from "nodemailer";` : "",
    has("write_file") ? `import fs from "fs/promises";\nimport path from "path";` : "",
    has("kv_get", "kv_set") ? `import net from "net";\nimport tls from "tls";` : "",
  ].filter(Boolean);

  return [
    `/**`,
    ` * ${commentSafe(b.name)}: exported from Agent Studio (${versionLabel(b.version)}).`,
    ` * The agent's instructions, skills and actions, runnable on their own. Actions`,
    ` * that need approval in Agent Studio are held here too: they come back in`,
    ` * heldActions and run only when approved (see README.md).`,
    ` */`,
    ``,
    ...imports,
    ``,
    `// Settings from a local .env file when there is one (Node 20.12+); platforms set them directly.`,
    `if (typeof process.loadEnvFile === "function") {`,
    `  try { process.loadEnvFile(); } catch { /* no .env file */ }`,
    `}`,
    ``,
    `export const AGENT = ${JSON.stringify({ name: b.name, version: b.version })};`,
    `export const MODEL = process.env.ANTHROPIC_MODEL || ${JSON.stringify(MODEL)};`,
    `const MAX_STEPS = ${Number(b.spec.guardrails?.maxSteps) || 12};`,
    `const APPROVE_ALL = process.env.APPROVE_ALL_ACTIONS === "true";`,
    ``,
    `export const SYSTEM_PROMPT = ${JSON.stringify(b.systemPrompt)};`,
    ``,
    `const SKILLS = ${JSON.stringify(skillDict(b.skills), null, 2)};`,
    ``,
    `// The actions this agent may take, and whether each waits for a person's approval.`,
    `export const ACTIONS = ${JSON.stringify(actionMeta(b.actions), null, 2)};`,
    ``,
    `export const TOOLS = ${JSON.stringify(toolDefinitions(b.actions, b.skills.length > 0), null, 2)};`,
    NODE_CORE,
    has("jira_create_issue", "jira_search_issues") ? NODE_JIRA : "",
    has("kv_get", "kv_set") ? NODE_REDIS : "",
    `const RUN = {${working.map((a) => NODE_ACTIONS[a.id]).join("\n")}\n};`,
    NODE_CLI,
  ].join("\n");
}

const NODE_SERVER = js`
import http from "http";
import { AGENT, runAgent, approveAction, authorised } from "./runner.mjs";

const PORT = Number(process.env.PORT || 8080);

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 1000000) { reject(new Error("Body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url || "/", "http://localhost");
  if (req.method === "GET" && (pathname === "/" || pathname === "/health")) {
    return send(res, 200, { status: "ok", agent: AGENT.name, version: AGENT.version });
  }
  if (req.method !== "POST" || (pathname !== "/run" && pathname !== "/approve")) {
    return send(res, 404, { error: "Not found", endpoints: ["POST /run", "POST /approve", "GET /health"] });
  }
  if (!authorised(req.headers.authorization)) {
    return send(res, 401, { error: "Send Authorization: Bearer <AGENT_API_TOKEN>." });
  }
  let body;
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    return send(res, 400, { error: "The body must be JSON." });
  }
  try {
    if (pathname === "/approve") return send(res, 200, await approveAction(body));
    return send(res, 200, await runAgent(body.input, body.inputs));
  } catch (err) {
    return send(res, (err && err.status) || 500, { error: (err && err.message) || String(err) });
  }
}).listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify(AGENT.name) + " listening on port " + PORT);
  if (!process.env.AGENT_API_TOKEN) console.warn("AGENT_API_TOKEN is not set: every call to /run and /approve will be refused.");
});
`;

const LAMBDA_HANDLER = js`
import { AGENT, runAgent, approveAction, authorised } from "./runner.mjs";

const reply = (statusCode, body) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/**
 * Called through the function URL (checked against AGENT_API_TOKEN), or
 * directly by AWS (EventBridge, Step Functions), where IAM decides who may.
 * Body: { "input": "...", "inputs": {} } to run, or { "approve": { "action", "input" } }.
 */
export async function handler(event) {
  const viaHttp = Boolean(event && event.requestContext);
  let body = event || {};
  if (viaHttp) {
    if (event.requestContext.http && event.requestContext.http.method === "GET") return reply(200, { status: "ok", agent: AGENT.name, version: AGENT.version });
    const headers = event.headers || {};
    if (!authorised(headers.authorization || headers.Authorization)) return reply(401, { error: "Send Authorization: Bearer <AGENT_API_TOKEN>." });
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body;
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return reply(400, { error: "The body must be JSON." });
    }
  }
  try {
    if (body.approve) return reply(200, await approveAction(body.approve));
    return reply(200, await runAgent(body.input, body.inputs));
  } catch (err) {
    return reply((err && err.status) || 500, { error: (err && err.message) || String(err) });
  }
}
`;

const GCF_HANDLER = js`
import * as functions from "@google-cloud/functions-framework";
import { AGENT, runAgent, approveAction, authorised } from "./runner.mjs";

// Body: { "input": "...", "inputs": {} } to run, or { "approve": { "action", "input" } }.
functions.http("agentFunction", async (req, res) => {
  if (req.method === "GET") return res.json({ status: "ok", agent: AGENT.name, version: AGENT.version });
  if (!authorised(req.get("authorization"))) return res.status(401).json({ error: "Send Authorization: Bearer <AGENT_API_TOKEN>." });
  try {
    const body = req.body || {};
    if (body.approve) return res.json(await approveAction(body.approve));
    res.json(await runAgent(body.input, body.inputs));
  } catch (err) {
    res.status((err && err.status) || 500).json({ error: (err && err.message) || String(err) });
  }
});
`;

function buildPackageJson(slug: string, b: Built, target: ExportTarget, runtime: ExportRuntime): string {
  const deps: Record<string, string> = { "@anthropic-ai/sdk": "^0.32.1" };
  for (const a of b.actions) if (a.works) Object.assign(deps, SUPPORT[a.id]?.node ?? {});
  const gcf = target === "gcp" && runtime === "serverless";
  if (gcf) deps["@google-cloud/functions-framework"] = "^3.4.2";
  const pkg: any = {
    name: slug,
    version: String(b.version ?? 0) + ".0.0",
    private: true,
    description: b.spec.purpose || `Exported agent: ${b.name}`,
    type: "module",
    engines: { node: ">=20.12" },
    scripts: {
      start: gcf ? "functions-framework --target=agentFunction" : "node server.mjs",
      ask: "node runner.mjs",
    },
    dependencies: deps,
  };
  if (gcf) pkg.main = "handler.mjs";
  return JSON.stringify(pkg, null, 2) + "\n";
}

const NODE_DOCKERFILE = `FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 OUTPUT_DIR=/tmp/output

COPY package.json ./
RUN npm install --omit=dev

COPY . .
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
`;

// ---- Python ------------------------------------------------------------------------------

const PY_ACTIONS: Record<string, string> = {
  web_search: py`
def web_search(inp, ctx):
    res = client.messages.create(
        model=MODEL,
        max_tokens=1500,
        tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 4}],
        messages=[{"role": "user", "content": "Search the web and answer factually with source URLs. Question: " + str(inp.get("query", ""))}],
    )
    count_usage(ctx, res.usage)
    answer = "\n".join(b.text for b in res.content if b.type == "text")
    sources = []
    for b in res.content:
        for c in getattr(b, "citations", None) or []:
            url = getattr(c, "url", None)
            if url and url not in sources:
                sources.append(url)
        if b.type == "web_search_tool_result" and isinstance(getattr(b, "content", None), list):
            for r in b.content:
                url = getattr(r, "url", None)
                if url and url not in sources:
                    sources.append(url)
    return {"answer": answer[:8000], "sources": sources[:12]}
`,
  fetch_url: py`
def fetch_url(inp, ctx):
    url = str(inp.get("url", ""))
    if not re.match(r"^https?://", url, re.I):
        raise ValueError("Give an absolute http(s) URL.")
    res = requests.get(url, headers={"user-agent": "AgentStudio-Export/1.0"}, timeout=20)
    return {"status": res.status_code, "text": res.text[:12000]}
`,
  sql_query: py`
def sql_query(inp, ctx):
    with psycopg.connect(need("DATABASE_URL"), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            if inp.get("list_tables") or not inp.get("sql"):
                cur.execute(
                    "select table_schema, table_name, column_name, data_type from information_schema.columns "
                    "where table_schema not in ('pg_catalog', 'information_schema') "
                    "order by table_schema, table_name, ordinal_position limit 800"
                )
                return {"schema": cur.fetchall()}
            sql = re.sub(r";+\s*$", "", str(inp["sql"]).strip())
            if not re.match(r"^(select|with)\b", sql, re.I) or ";" in sql:
                raise ValueError("Only a single SELECT statement is allowed.")
            limit = min(max(int(inp.get("limit") or 200), 1), 500)
            cur.execute("select * from (" + sql + ") as result limit " + str(limit))
            rows = cur.fetchall()
            return {"rowCount": len(rows), "rows": rows}
`,
  sql_execute: py`
def sql_execute(inp, ctx):
    sql = re.sub(r";+\s*$", "", str(inp.get("sql", "")).strip())
    if ";" in sql:
        raise ValueError("One statement at a time.")
    if not re.match(r"^(insert\s+into|update|delete\s+from)\b", sql, re.I):
        raise ValueError("Only INSERT, UPDATE or DELETE is allowed.")
    with psycopg.connect(need("DATABASE_URL"), connect_timeout=15) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            return {"rowCount": cur.rowcount}
`,
  http_request: py`
def http_request(inp, ctx):
    base = need("API_BASE_URL").rstrip("/")
    path = str(inp.get("path", ""))
    url = base + (path if path.startswith("/") else "/" + path)
    headers = {"accept": "application/json"}
    if os.environ.get("API_SECRET_KEY"):
        headers["authorization"] = "Bearer " + os.environ["API_SECRET_KEY"]
    res = requests.request(
        str(inp.get("method") or "GET").upper(), url, headers=headers,
        params=inp.get("query") or None, json=inp.get("body"), timeout=30,
    )
    return {"status": res.status_code, "body": res.text[:10000]}
`,
  send_email: py`
def send_email(inp, ctx):
    port = int(os.environ.get("SMTP_PORT") or 587)
    msg = EmailMessage()
    msg["From"] = os.environ.get("SMTP_FROM") or need("SMTP_USER")
    msg["To"] = str(inp.get("to", ""))
    msg["Subject"] = str(inp.get("subject", ""))
    body = str(inp.get("body", ""))
    msg.set_content(body, subtype="html" if re.search(r"</?[a-z][^>]*>", body, re.I) else "plain")
    if port == 465:
        server = smtplib.SMTP_SSL(need("SMTP_HOST"), port, timeout=30)
    else:
        server = smtplib.SMTP(need("SMTP_HOST"), port, timeout=30)
        server.starttls()
    with server:
        server.login(need("SMTP_USER"), need("SMTP_PASS"))
        refused = server.send_message(msg)
    return {"sent": True, "refused": list(refused.keys())}
`,
  post_message: py`
def post_message(inp, ctx):
    res = requests.post(need("SLACK_WEBHOOK_URL"), json={"text": inp.get("text", "")}, timeout=20)
    if not res.ok:
        raise RuntimeError(f"Slack refused the message ({res.status_code}): {res.text[:300]}")
    return {"posted": True}
`,
  post_teams_message: py`
def post_teams_message(inp, ctx):
    card = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "summary": inp.get("title") or "Message from agent",
        "text": inp.get("text", ""),
    }
    if inp.get("title"):
        card["title"] = inp["title"]
    res = requests.post(need("MSTEAMS_WEBHOOK_URL"), json=card, timeout=20)
    if not res.ok:
        raise RuntimeError(f"Teams refused the message ({res.status_code}): {res.text[:300]}")
    return {"posted": True}
`,
  s3_upload_file: py`
def s3_upload_file(inp, ctx):
    bucket = need("AWS_S3_BUCKET")
    key = str(inp.get("key", "")).lstrip("/")
    if not key:
        raise ValueError("Give the file's key (its path in the bucket).")
    s3 = boto3.client(
        "s3",
        region_name=os.environ.get("AWS_REGION") or "us-east-1",
        endpoint_url=os.environ.get("AWS_S3_ENDPOINT") or None,
    )
    body = str(inp.get("content", "")).encode("utf-8")
    s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType=inp.get("contentType") or "text/plain; charset=utf-8")
    return {"uploaded": True, "bucket": bucket, "key": key, "bytes": len(body)}
`,
  jira_create_issue: py`
def jira_create_issue(inp, ctx):
    host = need("JIRA_HOST").rstrip("/")
    fields = {
        "project": {"key": inp.get("project") or need("JIRA_DEFAULT_PROJECT")},
        "summary": inp.get("summary", ""),
        "issuetype": {"name": inp.get("issueType") or "Task"},
        "description": {"type": "doc", "version": 1, "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": str(inp.get("description", ""))}]}
        ]},
    }
    res = requests.post(host + "/rest/api/3/issue", json={"fields": fields}, auth=jira_auth(), timeout=30)
    if not res.ok:
        raise RuntimeError(f"Jira refused the issue ({res.status_code}): {res.text[:400]}")
    key = res.json().get("key")
    return {"key": key, "url": f"{host}/browse/{key}"}
`,
  jira_search_issues: py`
def jira_search_issues(inp, ctx):
    host = need("JIRA_HOST").rstrip("/")
    limit = min(max(int(inp.get("limit") or 20), 1), 50)
    res = requests.get(
        host + "/rest/api/3/search",
        params={"jql": inp.get("jql", ""), "maxResults": limit, "fields": "summary,status,assignee,created,priority,issuetype"},
        auth=jira_auth(), timeout=30,
    )
    if not res.ok:
        raise RuntimeError(f"Jira search failed ({res.status_code}): {res.text[:400]}")
    data = res.json()
    issues = []
    for i in data.get("issues", []):
        f = i.get("fields") or {}
        issues.append({
            "key": i.get("key"),
            "summary": f.get("summary"),
            "status": (f.get("status") or {}).get("name"),
            "assignee": (f.get("assignee") or {}).get("displayName"),
            "type": (f.get("issuetype") or {}).get("name"),
            "created": f.get("created"),
        })
    return {"total": data.get("total"), "issues": issues}
`,
  github_create_issue: py`
def github_create_issue(inp, ctx):
    repo = inp.get("repo") or need("GITHUB_DEFAULT_REPO")
    res = requests.post(
        f"https://api.github.com/repos/{repo}/issues",
        headers=github_headers(),
        json={"title": inp.get("title", ""), "body": inp.get("body", ""), "labels": inp.get("labels") or []},
        timeout=30,
    )
    if not res.ok:
        raise RuntimeError(f"GitHub refused the issue ({res.status_code}): {res.text[:300]}")
    data = res.json()
    return {"number": data.get("number"), "url": data.get("html_url")}
`,
  github_read_file: py`
def github_read_file(inp, ctx):
    repo = inp.get("repo") or need("GITHUB_DEFAULT_REPO")
    path = str(inp.get("path", "")).lstrip("/")
    params = {"ref": inp["ref"]} if inp.get("ref") else None
    res = requests.get(f"https://api.github.com/repos/{repo}/contents/{path}", headers=github_headers(), params=params, timeout=30)
    if not res.ok:
        raise RuntimeError(f"GitHub could not read the file ({res.status_code}): {res.text[:300]}")
    data = res.json()
    if isinstance(data, list):
        return {"path": path, "directory": [{"name": f.get("name"), "type": f.get("type")} for f in data]}
    content = data.get("content") or ""
    if data.get("encoding") == "base64":
        content = base64.b64decode(content).decode("utf-8", errors="replace")
    return {"path": data.get("path"), "content": content[:15000]}
`,
  write_file: py`
def write_file(inp, ctx):
    folder = Path(os.environ.get("OUTPUT_DIR") or "output")
    folder.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^\w.\- ]+", "_", Path(str(inp.get("filename") or "output.txt")).name)
    content = str(inp.get("content", ""))
    (folder / name).write_text(content, encoding="utf-8")
    return {"file": name, "folder": str(folder), "bytes": len(content.encode("utf-8"))}
`,
  kv_get: py`
def kv_get(inp, ctx):
    value = kv_client().get(kv_key(inp.get("key", "")))
    return {"key": inp.get("key"), "found": value is not None, "value": value}
`,
  kv_set: py`
def kv_set(inp, ctx):
    ttl = int(inp.get("ttlSeconds") or 0)
    kv_client().set(kv_key(inp.get("key", "")), str(inp.get("value", "")), ex=ttl if ttl > 0 else None)
    return {"key": inp.get("key"), "set": True, "ttlSeconds": ttl or None}
`,
};

const PY_JIRA = py`
def jira_auth():
    return (need("JIRA_EMAIL"), need("JIRA_API_TOKEN"))
`;

const PY_GITHUB = py`
def github_headers():
    return {"authorization": "Bearer " + need("GITHUB_TOKEN"), "user-agent": "AgentStudio-Export", "accept": "application/vnd.github+json"}
`;

const PY_REDIS = py`
def kv_client():
    return redis.from_url(need("REDIS_URL"), decode_responses=True, socket_timeout=10)


def kv_key(key):
    prefix = os.environ.get("REDIS_KEY_PREFIX")
    return f"{prefix}:{key}" if prefix else str(key)
`;

const PY_CORE = py`
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

HELD = {
    "status": "held_for_approval",
    "message": "Not done: this action needs a person's approval, and the exact request has been passed to them. "
               "Do not repeat it. Finish the rest of the work, and say in your answer what is waiting for approval.",
}


def need(key):
    value = os.environ.get(key)
    if not value:
        raise RuntimeError(f"{key} is not set. Add it to the environment (see .env.example).")
    return value


def count_usage(ctx, usage):
    if ctx is not None and usage is not None:
        ctx["inputTokens"] += getattr(usage, "input_tokens", 0) or 0
        ctx["outputTokens"] += getattr(usage, "output_tokens", 0) or 0


def load_skill(inp):
    wanted = str((inp or {}).get("name", ""))
    skill = SKILLS.get(wanted) or next(
        (s for s in SKILLS.values() if wanted.lower() in (s["name"].lower(), s["label"].lower())), None
    )
    if not skill:
        return {"error": f"No skill called {wanted!r}. Available: {', '.join(SKILLS)}"}
    return {"skill": skill["label"], "instructions": skill["instructions"]}
`;

const PY_RUN = py`

def perform_action(name, inp, ctx=None):
    """Carries out one action without asking: automatic ones, and held ones once a person approves."""
    if name not in ACTIONS or name not in RUN:
        raise ValueError(f"{name!r} is not an action this agent can take.")
    return RUN[name](inp or {}, ctx if ctx is not None else {"inputTokens": 0, "outputTokens": 0})


def approve_action(held):
    """Performs an action a run held for approval, after a person has checked it."""
    name = (held or {}).get("action")
    if name not in ACTIONS or not ACTIONS[name]["approval"]:
        raise ValueError("Only actions that need approval can be approved here.")
    result = perform_action(name, held.get("input") or {})
    return {"action": name, "label": ACTIONS[name]["label"], "performed": True, "result": result}


def run_agent(user_input=None, inputs=None):
    """One run. Automatic actions run; actions that need approval come back in heldActions."""
    started = time.time()
    prompt = str(user_input or "").strip() or "Begin the work described in your procedure."
    if inputs:
        lines = "\n".join(f"- {k}: {v}" for k, v in inputs.items())
        prompt = f"INPUTS:\n{lines}\n\nINSTRUCTION:\n{prompt}"

    ctx = {"inputTokens": 0, "outputTokens": 0}
    messages = [{"role": "user", "content": prompt}]
    steps, held = [], []
    output = ""
    calls = 0
    stopped_at_limit = False

    for _ in range(MAX_STEPS + 2):
        res = client.messages.create(
            model=MODEL, max_tokens=4000, system=SYSTEM_PROMPT, messages=messages, **({"tools": TOOLS} if TOOLS else {})
        )
        count_usage(ctx, res.usage)
        content = []
        for b in res.content:
            if b.type == "text":
                content.append({"type": "text", "text": b.text})
            elif b.type == "tool_use":
                content.append({"type": "tool_use", "id": b.id, "name": b.name, "input": b.input})
        messages.append({"role": "assistant", "content": content})
        text = "\n".join(b.text for b in res.content if b.type == "text").strip()
        if text:
            output = text
        uses = [b for b in res.content if b.type == "tool_use"]
        if not uses:
            break

        results = []
        for use in uses:
            t0 = time.time()
            status = "done"
            if calls >= MAX_STEPS:
                stopped_at_limit = True
                status = "skipped"
                result = {"error": "Step limit reached. Do not call any more tools; write your final answer with what you have."}
            else:
                calls += 1
                action = ACTIONS.get(use.name)
                if use.name == "load_skill":
                    result = load_skill(use.input)
                elif action and action["approval"] and not APPROVE_ALL:
                    held.append({"id": use.id, "action": use.name, "label": action["label"], "input": use.input})
                    result = HELD
                    status = "held"
                else:
                    try:
                        result = perform_action(use.name, use.input, ctx)
                    except Exception as err:  # the model is told, and decides what to do next
                        result = {"error": str(err)}
                        status = "failed"
            steps.append({"action": use.name, "input": use.input, "status": status, "output": result,
                          "durationMs": int((time.time() - t0) * 1000)})
            block = {"type": "tool_result", "tool_use_id": use.id, "content": json.dumps(result, default=str)[:30000]}
            if status == "failed":
                block["is_error"] = True
            results.append(block)
        messages.append({"role": "user", "content": results})

    return json.loads(json.dumps({
        "agent": AGENT["name"],
        "version": AGENT["version"],
        "status": "needs_approval" if held else ("stopped_at_step_limit" if stopped_at_limit else "completed"),
        "output": output,
        "heldActions": held,
        "steps": steps,
        "usage": {"model": MODEL, **ctx},
        "durationMs": int((time.time() - started) * 1000),
    }, default=str))


if __name__ == "__main__":
    print(f'Running "{AGENT["name"]}"...\n')
    out = run_agent(" ".join(sys.argv[1:]))
    print(out["output"] or "(no answer)")
    print(f'\n{len(out["steps"])} step(s). Status: {out["status"]}')
    for h in out["heldActions"]:
        print(f'\nWaiting for approval: {h["label"]}\n{json.dumps(h["input"], indent=2)}')
    if out["heldActions"]:
        print("\nNothing above was carried out. Start the service and POST an approved one to /approve.")
`;

/** A Python expression for a JSON value: json.loads of a string literal, so no JSON-vs-Python syntax gaps. */
function pyValue(v: unknown) {
  return `json.loads(${JSON.stringify(JSON.stringify(v))})`;
}

function buildPythonRunner(b: Built): string {
  const working = b.actions.filter((a) => a.works);
  const ids = new Set(working.map((a) => a.id));
  const has = (...x: string[]) => x.some((i) => ids.has(i));
  const imports = [
    "import base64",
    "import json",
    "import os",
    "import re",
    "import sys",
    "import time",
    "from pathlib import Path",
    has("send_email") ? "import smtplib\nfrom email.message import EmailMessage" : "",
    "",
    "import anthropic",
    "import requests",
    has("sql_query", "sql_execute") ? "import psycopg\nfrom psycopg.rows import dict_row" : "",
    has("s3_upload_file") ? "import boto3" : "",
    has("kv_get", "kv_set") ? "import redis" : "",
  ].filter((l) => l !== "");

  return [
    `"""`,
    `${b.name.replace(/"""/g, "'''")}: exported from Agent Studio (${versionLabel(b.version)}).`,
    `The agent's instructions, skills and actions, runnable on their own. Actions that`,
    `need approval in Agent Studio are held here too: they come back in heldActions and`,
    `run only when approved (see README.md).`,
    `"""`,
    ``,
    ...imports,
    ``,
    `try:  # settings from a local .env file when there is one; platforms set them directly`,
    `    from dotenv import load_dotenv`,
    `    load_dotenv()`,
    `except ImportError:`,
    `    pass`,
    ``,
    `AGENT = ${pyValue({ name: b.name, version: b.version })}`,
    `MODEL = os.environ.get("ANTHROPIC_MODEL") or ${JSON.stringify(MODEL)}`,
    `MAX_STEPS = ${Number(b.spec.guardrails?.maxSteps) || 12}`,
    `APPROVE_ALL = os.environ.get("APPROVE_ALL_ACTIONS", "").lower() == "true"`,
    ``,
    `SYSTEM_PROMPT = ${pyValue(b.systemPrompt)}`,
    `SKILLS = ${pyValue(skillDict(b.skills))}`,
    `# The actions this agent may take, and whether each waits for a person's approval.`,
    `ACTIONS = ${pyValue(actionMeta(b.actions))}`,
    `TOOLS = ${pyValue(toolDefinitions(b.actions, b.skills.length > 0))}`,
    PY_CORE,
    has("jira_create_issue", "jira_search_issues") ? PY_JIRA : "",
    has("github_create_issue", "github_read_file") ? PY_GITHUB : "",
    has("kv_get", "kv_set") ? PY_REDIS : "",
    ...working.map((a) => PY_ACTIONS[a.id] + "\n"),
    `RUN = {${working.map((a) => `\n    ${JSON.stringify(a.id)}: ${a.id},`).join("")}\n}`,
    PY_RUN,
  ].join("\n");
}

const PY_SERVER = py`"""HTTP service for the agent: POST /run, POST /approve, GET /health."""

import hmac
import os
from typing import Any, Dict, Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from runner import AGENT, approve_action, run_agent

app = FastAPI(title=AGENT["name"], version=str(AGENT["version"] or 0))


def check_token(authorization):
    token = os.environ.get("AGENT_API_TOKEN", "")
    given = (authorization or "").strip()
    if given.lower().startswith("bearer "):
        given = given[7:].strip()
    if not token or not hmac.compare_digest(given.encode(), token.encode()):
        raise HTTPException(status_code=401, detail="Send Authorization: Bearer <AGENT_API_TOKEN>.")


class RunRequest(BaseModel):
    input: Optional[str] = None
    inputs: Optional[Dict[str, Any]] = None


class ApproveRequest(BaseModel):
    action: str
    input: Dict[str, Any] = {}


@app.get("/health")
def health():
    return {"status": "ok", "agent": AGENT["name"], "version": AGENT["version"]}


@app.post("/run")
def run(req: RunRequest, authorization: Optional[str] = Header(default=None)):
    check_token(authorization)
    try:
        return run_agent(req.input, req.inputs)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


@app.post("/approve")
def approve(req: ApproveRequest, authorization: Optional[str] = Header(default=None)):
    check_token(authorization)
    try:
        return approve_action({"action": req.action, "input": req.input})
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


if __name__ == "__main__":
    import uvicorn

    if not os.environ.get("AGENT_API_TOKEN"):
        print("AGENT_API_TOKEN is not set: every call to /run and /approve will be refused.")
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
`;

function buildPythonRequirements(b: Built): string {
  const reqs = [
    "anthropic>=0.49.0",
    "requests>=2.31.0",
    "fastapi>=0.110.0",
    "uvicorn[standard]>=0.28.0",
    "pydantic>=2.0.0",
    "python-dotenv>=1.0.0",
  ];
  for (const a of b.actions) if (a.works) for (const r of SUPPORT[a.id]?.python ?? []) if (!reqs.includes(r)) reqs.push(r);
  return reqs.join("\n") + "\n";
}

const PY_DOCKERFILE = `FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PORT=8080 OUTPUT_DIR=/tmp/output

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
USER nobody
EXPOSE 8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port $PORT"]
`;

// ---- deploying ------------------------------------------------------------------------------

/** Every deploy script starts by checking .env has what the agent cannot run without. */
function envCheck(vars: ExportEnvVar[]): string {
  const keys = vars.filter((v) => v.required).map((v) => v.key);
  return `if [ ! -f .env ]; then
  echo "Copy .env.example to .env and fill it in first."
  exit 1
fi
for KEY in ${keys.join(" ")}; do
  if ! grep -q "^$KEY=." .env; then
    echo "$KEY is empty in .env. Fill it in first."
    exit 1
  fi
done
`;
}

/** Cloud Run and Cloud Functions take settings as a YAML file; this builds one from .env. */
const GCP_ENV_FILE = `ENV_FILE=$(mktemp)
while IFS= read -r LINE || [ -n "$LINE" ]; do
  case "$LINE" in ''|'#'*) continue ;; esac
  KEY=$(printf '%s' "$LINE" | cut -d= -f1)
  VALUE=$(printf '%s' "$LINE" | cut -d= -f2- | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
  [ "$KEY" = "PORT" ] && continue
  printf '%s: "%s"\\n' "$KEY" "$VALUE" >> "$ENV_FILE"
done < .env
`;

function buildDeploy(slug: string, target: ExportTarget, runtime: ExportRuntime, vars: ExportEnvVar[], usesS3: boolean) {
  // SAM asks for the settings itself, so a Lambda deploy does not read .env.
  const lambda = target === "aws" && runtime === "serverless";
  const head = `#!/usr/bin/env bash
# Deploys this agent.${lambda ? "" : " Reads its settings from .env (copied from .env.example)."}
set -euo pipefail
cd "$(dirname "$0")"

${lambda ? "" : envCheck(vars)}`;

  if (target === "gcp") {
    const cmd =
      runtime === "container"
        ? `gcloud run deploy "${slug}" --source . --region "$REGION" --allow-unauthenticated --timeout 900 --env-vars-file "$ENV_FILE"`
        : `gcloud functions deploy "${slug}" --gen2 --runtime nodejs22 --entry-point agentFunction --source . --region "$REGION" --trigger-http --allow-unauthenticated --timeout 540 --env-vars-file "$ENV_FILE"`;
    return {
      script: `${head}
REGION="\${REGION:-us-central1}"
${GCP_ENV_FILE}
# Public URL; every call must still carry AGENT_API_TOKEN.
${cmd}
rm -f "$ENV_FILE"
`,
      command: cmd.replace(` --env-vars-file "$ENV_FILE"`, " --env-vars-file env.yaml").replace(/"\$REGION"/g, "us-central1"),
    };
  }

  if (target === "aws" && runtime === "serverless") {
    return {
      script: `${head}
# SAM asks for each setting (from template.yaml) on the first deploy and remembers them.
sam build
rm -f .aws-sam/build/AgentFunction/.env
sam deploy --guided
${usesS3 ? `echo "S3 uploads use the function's own role (granted in template.yaml), not access keys."\n` : ""}`,
      command: "sam build && sam deploy --guided",
    };
  }

  if (target === "aws") {
    return {
      script: `${head}
REGION="$(aws configure get region || echo us-east-1)"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
IMAGE="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/${slug}:latest"

aws ecr describe-repositories --repository-names "${slug}" --region "$REGION" >/dev/null 2>&1 || \\
  aws ecr create-repository --repository-name "${slug}" --region "$REGION" >/dev/null
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
docker build --platform linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"

echo ""
echo "Image pushed: $IMAGE"
echo "Create an App Runner service from it (port 8080) and add the settings from .env"
echo "as environment variables, keeping the secret ones in Secrets Manager."
`,
      command: "./deploy.sh  (pushes the image to ECR for App Runner)",
    };
  }

  if (target === "azure") {
    return {
      script: `${head}
RESOURCE_GROUP="${slug}-rg"
LOCATION="eastus"

# Settings from .env become the app's environment variables.
set --
while IFS= read -r LINE || [ -n "$LINE" ]; do
  case "$LINE" in ''|'#'*) continue ;; esac
  set -- "$@" "$LINE"
done < .env

az group create --name "$RESOURCE_GROUP" --location "$LOCATION" >/dev/null
az containerapp up \\
  --name "${slug}" \\
  --resource-group "$RESOURCE_GROUP" \\
  --location "$LOCATION" \\
  --source . \\
  --ingress external \\
  --target-port 8080 \\
  --env-vars "$@"
`,
      command: `az containerapp up --name ${slug} --source . --ingress external --target-port 8080`,
    };
  }

  if (target === "python") {
    return {
      script: `${head}
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python3 main.py
`,
      command: "pip install -r requirements.txt && python3 main.py",
    };
  }

  return {
    script: `${head}
docker build -t "${slug}" .
docker rm -f "${slug}" >/dev/null 2>&1 || true
docker run -d --name "${slug}" -p 8080:8080 --env-file .env "${slug}"
echo "Running on http://localhost:8080. Logs: docker logs -f ${slug}"
`,
    command: "docker compose up --build",
  };
}

const LAMBDA_RESERVED = new Set(["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]);

function pascal(key: string) {
  return key
    .toLowerCase()
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

/** AWS SAM template: one function with a URL, each setting a deploy-time parameter. */
function buildSamTemplate(slug: string, name: string, vars: ExportEnvVar[], usesS3: boolean): string {
  const params = vars.filter((v) => !LAMBDA_RESERVED.has(v.key));
  const secret = /KEY|TOKEN|PASS|SECRET|URL$/;
  return `AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Description: ${JSON.stringify(name + " (exported from Agent Studio)")}

Parameters:
${params
  .map(
    (v) => `  ${pascal(v.key)}:
    Type: String
    Description: ${JSON.stringify(v.description)}${v.required ? "" : `\n    Default: ""`}${secret.test(v.key) ? "\n    NoEcho: true" : ""}`,
  )
  .join("\n")}

Resources:
  AgentFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: ${slug}
      CodeUri: ./
      Handler: handler.handler
      Runtime: nodejs22.x
      Timeout: 900
      MemorySize: 512
      FunctionUrlConfig:
        AuthType: NONE
      Environment:
        Variables:
${params.map((v) => `          ${v.key}: !Ref ${pascal(v.key)}`).join("\n")}${
    usesS3
      ? `
      Policies:
        - S3WritePolicy:
            BucketName: !Ref AwsS3Bucket`
      : ""
  }

Outputs:
  FunctionUrl:
    Description: Call POST on this URL with Authorization Bearer AGENT_API_TOKEN
    Value: !GetAtt AgentFunctionUrl.FunctionUrl
`;
}

// ---- README ---------------------------------------------------------------------------------

const PLATFORM: Record<string, string> = {
  "gcp:container": "Google Cloud Run",
  "gcp:serverless": "Google Cloud Functions",
  "aws:container": "AWS App Runner",
  "aws:serverless": "AWS Lambda",
  "azure:container": "Azure Container Apps",
  "docker:container": "Docker",
  "python:container": "Python (FastAPI)",
};

function buildReadme(
  b: Built,
  target: ExportTarget,
  runtime: ExportRuntime,
  vars: ExportEnvVar[],
  deployCommand: string,
  carried: string[],
): string {
  const platform = PLATFORM[`${target}:${runtime}`];
  const node = target !== "python";
  const working = b.actions.filter((a) => a.works);
  const held = working.filter((a) => a.gate === "approval");
  const lambda = target === "aws" && runtime === "serverless";
  const gcf = target === "gcp" && runtime === "serverless";
  const fence = "```";
  const runUrl = lambda || gcf ? "<function URL>" : "http://localhost:8080/run";
  const approveUrl = lambda || gcf ? "<function URL>" : "http://localhost:8080/approve";

  const actionRows = b.actions.length
    ? b.actions
        .map(
          (a) =>
            `| ${a.label} | ${a.works ? (a.gate === "approval" ? "Waits for approval" : "Runs by itself") : "Not in this package"} | ${a.note || "—"} |`,
        )
        .join("\n")
    : "| (none) | | This agent only reads its instructions and answers. |";

  return `# ${b.name}

Exported from Agent Studio: ${versionLabel(b.version)}, packaged for **${platform}**.
${b.spec.purpose ? `\n${b.spec.purpose}\n` : ""}
This is the agent on its own: its instructions (\`system_prompt.txt\`), skills and
actions, and a small service to call it. It runs on your Anthropic key.

## What it can do

| Action | Here | Notes |
| :--- | :--- | :--- |
${actionRows}
${
  held.length
    ? `
## Approvals

In Agent Studio a person approves ${held.map((a) => a.label.toLowerCase()).join(", ")} before it happens.
The package keeps that rule. When the agent reaches one of these actions it is **not carried
out**: the run finishes with \`"status": "needs_approval"\` and the exact request in
\`heldActions\`. After someone has checked it, send it back to carry it out:

${fence}bash
curl -X POST ${approveUrl} \\
  -H "Authorization: Bearer $AGENT_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '${lambda || gcf ? `{"approve": {"action": "${held[0].id}", "input": { ... }}}` : `{"action": "${held[0].id}", "input": { ... }}`}'
${fence}

Only actions that need approval are accepted there. To let them run without asking,
set \`APPROVE_ALL_ACTIONS=true\`. Nobody will check them first.
`
    : ""
}
## Settings

Copy \`.env.example\` to \`.env\` and fill it in. \`AGENT_API_TOKEN\` is already filled with a
random value made for this download; callers send it as \`Authorization: Bearer <token>\`, and
while it is empty every call is refused. Keep \`.env\` out of version control and out of images
(\`.dockerignore\` and \`.gcloudignore\` already leave it out).

| Setting | Needed | What it is |
| :--- | :--- | :--- |
${vars.map((v) => `| \`${v.key}\` | ${v.required ? "Yes" : "No"} | ${v.description} |`).join("\n")}

## Try it on your computer

${fence}bash
${node ? "npm install" : "pip install -r requirements.txt"}
${node ? `node runner.mjs "What should I look at first?"` : `python runner.py "What should I look at first?"`}
${fence}

Or start the service${lambda || gcf ? " (the same code the function uses)" : ""} and call it:

${fence}bash
${node ? (gcf ? "npm start" : "node server.mjs") : "python main.py"}

curl -X POST ${lambda || gcf ? (gcf ? "http://localhost:8080" : "http://localhost:8080/run") : runUrl} \\
  -H "Authorization: Bearer $AGENT_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "What should I look at first?", "inputs": {}}'
${fence}

The answer:

${fence}json
{
  "status": "completed | needs_approval | stopped_at_step_limit",
  "output": "The agent's answer",
  "heldActions": [{ "action": "...", "label": "...", "input": {} }],
  "steps": [{ "action": "...", "status": "done | held | failed | skipped", "output": {} }],
  "usage": { "model": "...", "inputTokens": 0, "outputTokens": 0 }
}
${fence}

## Deploy to ${platform}

${fence}bash
chmod +x deploy.sh && ./deploy.sh
${fence}

That runs: \`${deployCommand}\`.
${
  lambda
    ? "\nSAM asks for each setting on the first deploy. The function URL is public, so every call must carry `AGENT_API_TOKEN`; direct invocations from AWS (EventBridge, Step Functions) are allowed by IAM instead.\n"
    : ""
}${
  target === "aws" && runtime === "container"
    ? "\nThe script pushes the image to Amazon ECR. Create the App Runner service from that image in the console (port 8080) and add the settings there.\n"
    : ""
}${gcf ? "\nThe function answers at its URL (no /run path): POST a run, or `{\"approve\": {...}}` to approve.\n" : ""}
## What stays in Agent Studio

${carried.map((c) => `- ${c}`).join("\n")}
`;
}

// ---- the bundle -----------------------------------------------------------------------------

/** Rewrites the approval rule in the system prompt for a runtime where nobody is watching live. */
function exportPrompt(spec: AgentSpec, connectionNames: Record<string, string>, skills: SkillRow[], actions: ExportAction[]) {
  const working = new Set(actions.filter((a) => a.works).map((a) => a.id));
  const runnable: AgentSpec = { ...spec, tools: (spec.tools || []).filter((t) => working.has(t.id)) };
  return buildSystemPrompt(runnable, connectionNames, skills)
    .replace(/operating inside Agent Studio/, "exported from Agent Studio")
    .replace(
      /Call them normally; a person will review the exact payload\./,
      "Call them normally; they are held until a person approves the exact request, so say in your answer what is waiting.",
    );
}

export function generateExportBundle(opts: {
  spec: AgentSpec;
  agentName: string;
  version: number | null;
  target: ExportTarget;
  runtime: ExportRuntime;
  skills: SkillRow[];
  /** True when the skill instructions were withheld (only admins export skill content). */
  skillsWithheld?: boolean;
  connections: { id: string; name: string; kind: string }[];
}): ExportBundle {
  const { spec, version, target, skills } = opts;
  const runtime = runtimeFor(target, opts.runtime);
  const name = opts.agentName || spec.name || "Agent";
  const slug = slugify(name);

  const connectionNames: Record<string, string> = {};
  for (const c of opts.connections) connectionNames[c.id] = c.name;

  const actions = exportActions(spec);
  const systemPrompt = exportPrompt(spec, connectionNames, skills, actions);
  const vars = envVars(actions);
  const b: Built = { spec, name, version, systemPrompt, skills, actions };
  const usesS3 = actions.some((a) => a.works && a.id === "s3_upload_file");
  const carried = notCarried(spec, actions);
  const deploy = buildDeploy(slug, target, runtime, vars, usesS3);

  const files: ExportFile[] = [];
  const add = (path: string, language: string, description: string, content: string) =>
    files.push({ path, language, description, content });

  add("README.md", "markdown", "What the package does, its settings, and how to run and deploy it", buildReadme(b, target, runtime, vars, deploy.command, carried));

  if (target === "python") {
    add("runner.py", "python", "The agent: its instructions, actions and the approval rule", buildPythonRunner(b));
    add("main.py", "python", "HTTP service: POST /run, POST /approve, GET /health", PY_SERVER);
    add("requirements.txt", "text", "Python packages", buildPythonRequirements(b));
    add("Dockerfile", "dockerfile", "Container image", PY_DOCKERFILE);
    add("Procfile", "text", "Start command for Heroku-style platforms", "web: uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}\n");
  } else {
    add("runner.mjs", "javascript", "The agent: its instructions, actions and the approval rule", buildNodeRunner(b));
    add("server.mjs", "javascript", "HTTP service: POST /run, POST /approve, GET /health", NODE_SERVER.trimStart());
    if (target === "aws" && runtime === "serverless")
      add("handler.mjs", "javascript", "AWS Lambda entry point", LAMBDA_HANDLER.trimStart());
    if (target === "gcp" && runtime === "serverless")
      add("handler.mjs", "javascript", "Cloud Functions entry point", GCF_HANDLER.trimStart());
    add("package.json", "json", "Node.js packages", buildPackageJson(slug, b, target, runtime));
    add("Dockerfile", "dockerfile", "Container image", NODE_DOCKERFILE);
  }
  if (target === "aws" && runtime === "serverless")
    add("template.yaml", "yaml", "AWS SAM template: the function, its URL and settings", buildSamTemplate(slug, name, vars, usesS3));

  add(
    "docker-compose.yml",
    "yaml",
    "Run the container locally",
    `services:\n  ${slug}:\n    build: .\n    ports:\n      - "8080:8080"\n    env_file:\n      - .env\n    restart: unless-stopped\n`,
  );
  add(".env.example", "shell", "The settings it needs; copy to .env", envExample(name, vars));
  add("deploy.sh", "shell", `Deploys to ${PLATFORM[`${target}:${runtime}`]}`, deploy.script);
  add("system_prompt.txt", "text", "The instructions the agent runs with", systemPrompt + "\n");
  add("agent.json", "json", "The agent's definition in Agent Studio", JSON.stringify({ name, version, spec }, null, 2) + "\n");
  for (const s of skills) {
    add(`skills/${s.name}.md`, "markdown", `Skill: ${s.label}`, `# ${s.label}\n\n${s.description ? `> ${s.description}\n\n` : ""}${s.instructions}\n`);
  }
  const ignore = ".env\nnode_modules/\n.venv/\n__pycache__/\noutput/\n.aws-sam/\n";
  add(".gitignore", "text", "Keeps settings and build output out of version control", ignore);
  add(".dockerignore", "text", "Keeps settings out of the container image", ignore + ".git/\n");
  if (target === "gcp") add(".gcloudignore", "text", "Keeps settings out of the upload to Google Cloud", ignore + ".git/\n");

  return {
    agentName: name,
    slug,
    version,
    target,
    runtime,
    files,
    requiredEnvVars: vars,
    deployCommand: deploy.command,
    actions,
    skills: skills.map((s) => ({ label: s.label, included: !opts.skillsWithheld })),
    notCarried: carried,
    call: {
      inputs: (spec.inputs || []).map((i) => ({ key: i.key, label: i.label, required: Boolean(i.required) })),
      rateLimitRpm: spec.guardrails?.rateLimitRpm || 60,
      dlp: Boolean(spec.guardrails?.dlpEnabled),
    },
  };
}

/** The bundle as a zip, everything inside one folder named for the agent and platform. */
export async function createExportZip(bundle: ExportBundle): Promise<Buffer> {
  const zip = new JSZip();
  const root = zip.folder(`${bundle.slug}-${bundle.target}`) || zip;
  for (const f of bundle.files) {
    root.file(f.path, f.content, f.path.endsWith(".sh") ? { unixPermissions: 0o100755 } : undefined);
  }
  return zip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression: "DEFLATE", compressionOptions: { level: 9 } });
}
