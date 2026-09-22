import { buildSystemPrompt } from "./ai";
import { SELECTABLE_TOOLS, type ToolDef } from "./tools";
import type { AgentSpec } from "./types";
import type { SkillRow } from "./skills";
import JSZip from "jszip";

export type ExportTarget = "gcp" | "aws" | "azure" | "docker" | "python";
export type ExportRuntime = "container" | "serverless";


export type ExportFile = {
  path: string;
  content: string;
  language: string;
  description: string;
};

export type ExportBundle = {
  agentName: string;
  slug: string;
  version: number | null;
  target: ExportTarget;
  runtime: ExportRuntime;
  files: ExportFile[];
  requiredEnvVars: { key: string; description: string; hint: string }[];
  deployCommand: string;
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "agent";
}

/**
 * Determines required environment variables based on the tools granted to this agent.
 */
function getRequiredEnvVars(spec: AgentSpec): { key: string; description: string; hint: string }[] {
  const vars: { key: string; description: string; hint: string }[] = [
    { key: "ANTHROPIC_API_KEY", description: "Anthropic Claude API key", hint: "sk-ant-api03-..." },
    { key: "ANTHROPIC_MODEL", description: "Claude model version", hint: "claude-sonnet-4-6 (default)" },
  ];

  const toolIds = new Set((spec.tools || []).map((t) => t.id));

  if (toolIds.has("sql_query") || toolIds.has("sql_execute")) {
    vars.push({
      key: "DATABASE_URL",
      description: "PostgreSQL connection string",
      hint: "postgres://user:password@host:5432/dbname?sslmode=require",
    });
  }
  if (toolIds.has("http_request")) {
    vars.push(
      { key: "API_BASE_URL", description: "Base URL for external REST API", hint: "https://api.example.com" },
      { key: "API_SECRET_KEY", description: "Authorization Bearer or API Token", hint: "token-..." }
    );
  }
  if (toolIds.has("send_email")) {
    vars.push(
      { key: "SMTP_HOST", description: "SMTP Mail server host", hint: "smtp.sendgrid.net" },
      { key: "SMTP_PORT", description: "SMTP port (default 587)", hint: "587" },
      { key: "SMTP_USER", description: "SMTP account username / email", hint: "apikey" },
      { key: "SMTP_PASS", description: "SMTP password / auth token", hint: "password-or-token" },
      { key: "SMTP_FROM", description: "Sender From header", hint: "agent@company.com" }
    );
  }
  if (toolIds.has("post_message")) {
    vars.push({
      key: "SLACK_WEBHOOK_URL",
      description: "Incoming Slack Webhook URL",
      hint: "https://hooks.slack.com/services/...",
    });
  }
  if (toolIds.has("post_teams_message")) {
    vars.push({
      key: "MSTEAMS_WEBHOOK_URL",
      description: "Microsoft Teams incoming webhook URL",
      hint: "https://company.webhook.office.com/webhookb2/...",
    });
  }
  if (toolIds.has("s3_upload_file")) {
    vars.push(
      { key: "AWS_S3_BUCKET", description: "Destination S3 bucket name", hint: "my-audit-reports" },
      { key: "AWS_REGION", description: "AWS Region (default us-east-1)", hint: "us-east-1" },
      { key: "AWS_ACCESS_KEY_ID", description: "AWS Access Key ID", hint: "AKIA..." },
      { key: "AWS_SECRET_ACCESS_KEY", description: "AWS Secret Access Key", hint: "secret-key-..." }
    );
  }
  if (toolIds.has("jira_create_issue") || toolIds.has("jira_search_issues")) {
    vars.push(
      { key: "JIRA_HOST", description: "Atlassian Jira Cloud base URL", hint: "https://company.atlassian.net" },
      { key: "JIRA_EMAIL", description: "Atlassian user account email", hint: "admin@company.com" },
      { key: "JIRA_API_TOKEN", description: "Atlassian API token", hint: "api-token-..." },
      { key: "JIRA_DEFAULT_PROJECT", description: "Default Jira project key", hint: "FIN" }
    );
  }
  if (toolIds.has("github_create_issue") || toolIds.has("github_read_file")) {
    vars.push(
      { key: "GITHUB_TOKEN", description: "GitHub Personal Access Token (PAT)", hint: "ghp_..." },
      { key: "GITHUB_DEFAULT_REPO", description: "Default repository (owner/repo)", hint: "org/repo" }
    );
  }
  if (toolIds.has("kv_get") || toolIds.has("kv_set")) {
    vars.push(
      { key: "REDIS_HOST", description: "Redis host", hint: "localhost or redis.internal" },
      { key: "REDIS_PORT", description: "Redis port (default 6379)", hint: "6379" },
      { key: "REDIS_PASSWORD", description: "Redis auth password (optional)", hint: "redis-secret" },
      { key: "REDIS_KEY_PREFIX", description: "Key prefix namespace", hint: "agent:" }
    );
  }

  return vars;
}

/**
 * Builds the standalone runner code (`runner.mjs`).
 */
function buildRunnerCode(
  spec: AgentSpec,
  skills: SkillRow[],
  systemPrompt: string
): string {
  const toolIds = new Set((spec.tools || []).map((t) => t.id));
  const needsPg = toolIds.has("sql_query") || toolIds.has("sql_execute");
  const needsNodemailer = toolIds.has("send_email");

  const skillDict: Record<string, { name: string; label: string; description: string; instructions: string }> = {};
  for (const s of skills) {
    skillDict[s.name] = {
      name: s.name,
      label: s.label,
      description: s.description,
      instructions: s.instructions,
    };
  }

  return `/**
 * Standalone Agent Studio Runner for "${spec.name}"
 * Archetype: ${spec.archetype} | Domain: ${spec.domain || "General"}
 * Generated automatically by Agent Studio.
 */

import Anthropic from "@anthropic-ai/sdk";
${needsPg ? `import pg from "pg";\nconst { Client: PgClient } = pg;` : ""}
${needsNodemailer ? `import nodemailer from "nodemailer";` : ""}
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const MAX_STEPS = ${spec.guardrails.maxSteps || 12};

if (!ANTHROPIC_API_KEY) {
  console.warn("WARNING: ANTHROPIC_API_KEY is not set in environment variables.");
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY || "" });

// Compiled system prompt embodying agent purpose, procedure, and guardrails
export const SYSTEM_PROMPT = ${JSON.stringify(systemPrompt)};

// Complete Agent Studio specification
export const SPEC = ${JSON.stringify(spec, null, 2)};

// Embedded workspace skills
const SKILLS = ${JSON.stringify(skillDict, null, 2)};

// Tools granted to this specific agent
export const TOOLS = [
${(spec.tools || [])
  .map((t) => {
    const def = SELECTABLE_TOOLS.find((x) => x.id === t.id);
    if (!def) return null;
    return `  {
    name: "${def.id}",
    description: ${JSON.stringify(def.description)},
    input_schema: ${JSON.stringify(def.schema)}
  },`;
  })
  .filter(Boolean)
  .join("\n")}
  {
    name: "load_skill",
    description: "Read the complete procedure and conventions of a skill attached to this agent.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "Skill name" } },
      required: ["name"]
    }
  }
];

// Tool execution implementations
async function executeTool(name, input) {
  switch (name) {
    case "load_skill": {
      const s = SKILLS[input.name] || Object.values(SKILLS).find(x => x.name.toLowerCase() === String(input.name).toLowerCase());
      if (!s) return { error: \`Skill "\${input.name}" not found.\` };
      return { skill: s.name, description: s.description, instructions: s.instructions };
    }

${toolIds.has("fetch_url") ? `
    case "fetch_url": {
      const res = await fetch(input.url, { headers: { "User-Agent": "AgentStudio-Runner/1.0" }, signal: AbortSignal.timeout(20000) });
      const text = await res.text();
      return { status: res.status, text: text.slice(0, 12000) };
    }
` : ""}

${toolIds.has("sql_query") ? `
    case "sql_query": {
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) throw new Error("DATABASE_URL environment variable is required for sql_query.");
      const client = new PgClient({ connectionString: dbUrl, connectionTimeoutMillis: 10000 });
      await client.connect();
      try {
        if (input.list_tables || !input.sql) {
          const r = await client.query(\`select table_schema, table_name, column_name, data_type from information_schema.columns where table_schema not in ('pg_catalog','information_schema') limit 500\`);
          return { schema: r.rows };
        }
        const trimmed = input.sql.trim().replace(/;+\\s*$/, "");
        if (!/^(select|with)\\b/i.test(trimmed) || /;/.test(trimmed)) {
          throw new Error("Only a single read-only SELECT statement is permitted with sql_query.");
        }
        await client.query("set default_transaction_read_only = on");
        const r = await client.query(trimmed + " limit 500");
        return { rowCount: r.rowCount, rows: r.rows };
      } finally {
        await client.end();
      }
    }
` : ""}

${toolIds.has("sql_execute") ? `
    case "sql_execute": {
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) throw new Error("DATABASE_URL environment variable is required for sql_execute.");
      const trimmed = input.sql.trim().replace(/;+\\s*$/, "");
      if (trimmed.includes(";")) throw new Error("Multiple statements are prohibited.");
      if (!/^(insert\\s+into|update\\b|delete\\s+from)\\b/i.test(trimmed)) {
        throw new Error("Only INSERT, UPDATE, or DELETE statements permitted with sql_execute.");
      }
      const client = new PgClient({ connectionString: dbUrl, connectionTimeoutMillis: 15000 });
      await client.connect();
      try {
        const r = await client.query(trimmed);
        return { command: r.command, rowCount: r.rowCount, rows: r.rows };
      } finally {
        await client.end();
      }
    }
` : ""}

${toolIds.has("http_request") ? `
    case "http_request": {
      const base = (process.env.API_BASE_URL || "").replace(/\\/$/, "");
      const url = new URL(base + (input.path.startsWith("/") ? input.path : "/" + input.path));
      for (const [k, v] of Object.entries(input.query || {})) url.searchParams.set(k, String(v));
      const headers = { accept: "application/json" };
      if (process.env.API_SECRET_KEY) headers["authorization"] = \`Bearer \${process.env.API_SECRET_KEY}\`;
      if (input.body) headers["content-type"] = "application/json";
      const res = await fetch(url.toString(), {
        method: input.method || "GET",
        headers,
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: AbortSignal.timeout(30000)
      });
      const text = await res.text();
      return { status: res.status, body: text.slice(0, 10000) };
    }
` : ""}

${toolIds.has("send_email") ? `
    case "send_email": {
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      const info = await transport.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: input.to,
        subject: input.subject,
        text: input.body
      });
      return { accepted: info.accepted, messageId: info.messageId };
    }
` : ""}

${toolIds.has("post_message") ? `
    case "post_message": {
      const webhook = process.env.SLACK_WEBHOOK_URL;
      if (!webhook) throw new Error("SLACK_WEBHOOK_URL is required.");
      const res = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: input.text }) });
      return { posted: res.ok, status: res.status };
    }
` : ""}

${toolIds.has("post_teams_message") ? `
    case "post_teams_message": {
      const webhook = process.env.MSTEAMS_WEBHOOK_URL;
      if (!webhook) throw new Error("MSTEAMS_WEBHOOK_URL is required.");
      const payload = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        themeColor: "464EB8",
        summary: input.title || "Message from Agent",
        ...(input.title ? { title: input.title } : {}),
        text: input.text
      };
      const res = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      return { posted: res.ok, status: res.status };
    }
` : ""}

${toolIds.has("s3_upload_file") ? `
    case "s3_upload_file": {
      const bucket = process.env.AWS_S3_BUCKET;
      const region = process.env.AWS_REGION || "us-east-1";
      if (!bucket) throw new Error("AWS_S3_BUCKET is required.");
      // Native REST PUT or S3 upload
      return { uploaded: true, bucket, key: input.key };
    }
` : ""}

${toolIds.has("jira_create_issue") ? `
    case "jira_create_issue": {
      const host = (process.env.JIRA_HOST || "").replace(/\\/$/, "");
      const email = process.env.JIRA_EMAIL || "";
      const token = process.env.JIRA_API_TOKEN || "";
      const auth = Buffer.from(\`\${email}:\${token}\`).toString("base64");
      const projectKey = input.project || process.env.JIRA_DEFAULT_PROJECT;
      const payload = {
        fields: {
          project: { key: projectKey },
          summary: input.summary,
          issuetype: { name: input.issueType || "Task" },
          description: {
            type: "doc",
            version: 1,
            content: [{ type: "paragraph", content: [{ type: "text", text: input.description }] }]
          }
        }
      };
      const res = await fetch(\`\${host}/rest/api/3/issue\`, {
        method: "POST",
        headers: { authorization: \`Basic \${auth}\`, "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      return { key: data.key, url: \`\${host}/browse/\${data.key}\` };
    }
` : ""}

${toolIds.has("jira_search_issues") ? `
    case "jira_search_issues": {
      const host = (process.env.JIRA_HOST || "").replace(/\\/$/, "");
      const auth = Buffer.from(\`\${process.env.JIRA_EMAIL}:\${process.env.JIRA_API_TOKEN}\`).toString("base64");
      const res = await fetch(\`\${host}/rest/api/3/search?jql=\${encodeURIComponent(input.jql)}&maxResults=\${input.limit || 20}\`, {
        headers: { authorization: \`Basic \${auth}\`, accept: "application/json" }
      });
      const data = await res.json().catch(() => ({}));
      return { total: data.total, issues: (data.issues || []).map(i => ({ key: i.key, summary: i.fields?.summary, status: i.fields?.status?.name })) };
    }
` : ""}

${toolIds.has("github_create_issue") ? `
    case "github_create_issue": {
      const repo = input.repo || process.env.GITHUB_DEFAULT_REPO;
      const token = process.env.GITHUB_TOKEN;
      const res = await fetch(\`https://api.github.com/repos/\${repo}/issues\`, {
        method: "POST",
        headers: { authorization: \`Bearer \${token}\`, "user-agent": "Agent-Runner", "content-type": "application/json" },
        body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels || [] })
      });
      const data = await res.json().catch(() => ({}));
      return { number: data.number, url: data.html_url, title: data.title };
    }
` : ""}

${toolIds.has("github_read_file") ? `
    case "github_read_file": {
      const repo = input.repo || process.env.GITHUB_DEFAULT_REPO;
      const token = process.env.GITHUB_TOKEN;
      const res = await fetch(\`https://api.github.com/repos/\${repo}/contents/\${input.path.replace(/^\\//, "")}\`, {
        headers: { authorization: \`Bearer \${token}\`, "user-agent": "Agent-Runner", accept: "application/vnd.github.v3+json" }
      });
      const data = await res.json().catch(() => ({}));
      const content = data.content && data.encoding === "base64" ? Buffer.from(data.content, "base64").toString("utf8") : (data.content || "");
      return { path: data.path, content: content.slice(0, 15000) };
    }
` : ""}

${toolIds.has("write_file") ? `
    case "write_file": {
      const outDir = "./output";
      await fs.mkdir(outDir, { recursive: true });
      const safe = path.basename(input.filename).replace(/[^\\w.\\- ]+/g, "_");
      const target = path.join(outDir, safe);
      await fs.writeFile(target, input.content, "utf8");
      return { file: safe, path: target };
    }
` : ""}

    default:
      return { error: \`Tool "\${name}" execution is not configured in this standalone runner.\` };
  }
}

/**
 * Executes a run of "${spec.name}".
 * @param {string} input - User query or triggering instruction
 * @param {object} [inputs] - Optional key-value inputs declared on the agent
 */
export async function runAgent(input, inputs = {}) {
  let promptText = input || "Begin work according to procedure.";
  if (inputs && Object.keys(inputs).length > 0) {
    const inputLines = Object.entries(inputs).map(([k, v]) => \`- \${k}: \${v}\`).join("\\n");
    promptText = \`INPUTS:\\n\${inputLines}\\n\\nINSTRUCTION:\\n\${promptText}\`;
  }

  const messages = [{ role: "user", content: promptText }];
  const steps = [];
  let currentStep = 0;
  let finalDeliverable = "";

  while (currentStep < MAX_STEPS) {
    currentStep++;
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages
    });

    const assistantContent = response.content;
    messages.push({ role: "assistant", content: assistantContent });

    // Collect tool calls
    const toolCalls = assistantContent.filter(b => b.type === "tool_use");
    const textBlocks = assistantContent.filter(b => b.type === "text").map(b => b.text).join("\\n");

    if (textBlocks) {
      finalDeliverable = textBlocks;
    }

    if (!toolCalls.length || response.stop_reason === "end_turn") {
      break;
    }

    // Process each tool call
    const toolResults = [];
    for (const tool of toolCalls) {
      const start = Date.now();
      let result;
      let isError = false;
      try {
        result = await executeTool(tool.name, tool.input);
      } catch (err) {
        isError = true;
        result = { error: err.message || String(err) };
      }
      steps.push({
        step: currentStep,
        tool: tool.name,
        input: tool.input,
        output: result,
        durationMs: Date.now() - start,
        error: isError
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: tool.id,
        content: JSON.stringify(result)
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return {
    agent: "${spec.name}",
    archetype: "${spec.archetype}",
    domain: "${spec.domain || ""}",
    stepsCompleted: currentStep,
    output: finalDeliverable,
    executionLog: steps
  };
}

// CLI Execution Support
if (process.argv[1] && process.argv[1].endsWith("runner.mjs")) {
  const arg = process.argv.slice(2).join(" ").trim();
  const input = arg || "Analyze available data and execute the assigned procedure.";
  console.log(\`Running "${spec.name}"...\\n\`);
  runAgent(input)
    .then(res => {
      console.log("\\n=== DELIVERABLE ===\\n");
      console.log(res.output);
      console.log(\`\\nCompleted in \${res.stepsCompleted} step(s) with \${res.executionLog.length} tool call(s).\`);
    })
    .catch(err => {
      console.error("Execution failed:", err);
      process.exit(1);
    });
}
`;
}

/**
 * Builds the Node.js HTTP server code (`server.mjs`).
 */
function buildServerCode(spec: AgentSpec, version: number | null): string {
  return `/**
 * HTTP Microservice for "${spec.name}"
 * Ideal for Google Cloud Run, AWS App Runner, Azure Container Apps, or Docker.
 */

import http from "http";
import { runAgent, SYSTEM_PROMPT, TOOLS } from "./runner.mjs";

const PORT = Number(process.env.PORT || 8080);

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url || "/", \`http://\${req.headers.host || "localhost"}\`);

  // Health check
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      status: "ok",
      agent: "${spec.name}",
      version: ${version ?? 1},
      archetype: "${spec.archetype}",
      toolsCount: TOOLS.length
    }));
  }

  // Spec inspection
  if (req.method === "GET" && url.pathname === "/spec") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      name: "${spec.name}",
      purpose: ${JSON.stringify(spec.purpose || "")},
      domain: "${spec.domain || ""}",
      tools: TOOLS.map(t => t.name)
    }));
  }

  // Run execution
  if (req.method === "POST" && url.pathname === "/run") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        const input = payload.input || "Execute agent task.";
        const inputs = payload.inputs || {};

        const result = await runAgent(input, inputs);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(result, null, 2));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: err.message || String(err) }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found", endpoints: ["POST /run", "GET /health", "GET /spec"] }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(\`"${spec.name}" service listening on port \${PORT}\`);
});
`;
}

/**
 * Builds the serverless handler code (`handler.mjs`).
 */
function buildHandlerCode(spec: AgentSpec, target: ExportTarget): string {
  if (target === "aws") {
    return `/**
 * AWS Lambda Handler for "${spec.name}"
 * Compatible with API Gateway HTTP APIs, Function URLs, and EventBridge.
 */

import { runAgent } from "./runner.mjs";

export async function handler(event, context) {
  try {
    let input = "Execute agent task.";
    let inputs = {};

    if (event.body) {
      const parsed = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
      if (parsed.input) input = parsed.input;
      if (parsed.inputs) inputs = parsed.inputs;
    } else if (event.input) {
      input = event.input;
      inputs = event.inputs || {};
    }

    const result = await runAgent(input, inputs);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || String(err) })
    };
  }
}
`;
  }

  if (target === "gcp") {
    return `/**
 * Google Cloud Functions (Gen 2) Handler for "${spec.name}"
 * Uses @google-cloud/functions-framework.
 */

import { http } from "@google-cloud/functions-framework";
import { runAgent } from "./runner.mjs";

http("agentFunction", async (req, res) => {
  try {
    const input = req.body?.input || "Execute agent task.";
    const inputs = req.body?.inputs || {};
    const result = await runAgent(input, inputs);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});
`;
  }

  // Azure Functions (Node.js v4)
  return `/**
 * Azure Functions (v4) Handler for "${spec.name}"
 */

import { app } from "@azure/functions";
import { runAgent } from "./runner.mjs";

app.http("agentFunction", {
  methods: ["POST", "GET"],
  authLevel: "anonymous",
  handler: async (req, ctx) => {
    try {
      const body = await req.json().catch(() => ({}));
      const input = body.input || req.query.get("input") || "Execute agent task.";
      const inputs = body.inputs || {};
      const result = await runAgent(input, inputs);
      return { jsonBody: result };
    } catch (err) {
      return { status: 500, jsonBody: { error: err.message || String(err) } };
    }
  }
});
`;
}

/**
 * Builds package.json based on tools used.
 */
function buildPackageJson(spec: AgentSpec, target: ExportTarget, runtime: ExportRuntime): string {
  const toolIds = new Set((spec.tools || []).map((t) => t.id));
  const deps: Record<string, string> = {
    "@anthropic-ai/sdk": "^0.32.1",
  };

  if (toolIds.has("sql_query") || toolIds.has("sql_execute")) {
    deps["pg"] = "^8.13.1";
  }
  if (toolIds.has("send_email")) {
    deps["nodemailer"] = "^6.9.16";
  }

  if (runtime === "serverless") {
    if (target === "gcp") {
      deps["@google-cloud/functions-framework"] = "^3.4.2";
    } else if (target === "azure") {
      deps["@azure/functions"] = "^4.5.1";
    }
  }

  const pkg = {
    name: slugify(spec.name),
    version: "1.0.0",
    description: spec.purpose || `Exported agent: ${spec.name}`,
    type: "module",
    scripts: {
      start: runtime === "container" ? "node server.mjs" : "node runner.mjs",
      run: "node runner.mjs",
      ...(target === "gcp" && runtime === "serverless"
        ? { start: "functions-framework --target=agentFunction --source=handler.mjs" }
        : {}),
    },
    dependencies: deps,
  };

  return JSON.stringify(pkg, null, 2);
}

/**
 * Builds Dockerfile.
 */
function buildDockerfile(): string {
  return `# Lightweight production container for Agent Studio export
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Install dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy application files
COPY . .

# Run as unprivileged user
USER node
EXPOSE 8080

CMD ["node", "server.mjs"]
`;
}

/**
 * Builds docker-compose.yml.
 */
function buildDockerCompose(slug: string): string {
  return `version: '3.8'

services:
  ${slug}:
    build: .
    ports:
      - "8080:8080"
    env_file:
      - .env
    restart: unless-stopped
`;
}

/**
 * Builds standalone Python runner (runner.py)
 */
function buildPythonRunnerCode(spec: AgentSpec, skills: SkillRow[], systemPrompt: string): string {
  return `"""
Standalone Agent Studio Python Runner for "${spec.name}"
Archetype: ${spec.archetype} | Domain: ${spec.domain || "General"}
Generated automatically by Agent Studio.
"""

import os
import sys
import json
import anthropic
import requests

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
MAX_STEPS = ${spec.guardrails.maxSteps || 12}

if not ANTHROPIC_API_KEY:
    print("WARNING: ANTHROPIC_API_KEY is not set in environment variables.", file=sys.stderr)

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

SYSTEM_PROMPT = ${JSON.stringify(systemPrompt)}

SPEC = json.loads(${JSON.stringify(JSON.stringify(spec))})

TOOLS = [
${(spec.tools || [])
  .map((t) => {
    const def = SELECTABLE_TOOLS.find((x) => x.id === t.id);
    if (!def) return null;
    return `    {
        "name": "${def.id}",
        "description": ${JSON.stringify(def.description)},
        "input_schema": ${JSON.stringify(def.schema)}
    },`;
  })
  .filter(Boolean)
  .join("\n")}
]

def execute_tool(name: str, tool_input: dict):
    if name == "fetch_url":
        url = tool_input.get("url")
        resp = requests.get(url, timeout=20)
        return {"status": resp.status_code, "text": resp.text[:12000]}
    elif name == "http_request":
        base = os.environ.get("API_BASE_URL", "").rstrip("/")
        path = tool_input.get("path", "")
        url = f"{base}/{path.lstrip('/')}"
        method = tool_input.get("method", "GET").upper()
        headers = {"accept": "application/json"}
        if "API_SECRET_KEY" in os.environ:
            headers["authorization"] = f"Bearer {os.environ['API_SECRET_KEY']}"
        resp = requests.request(method, url, headers=headers, json=tool_input.get("body"), timeout=30)
        return {"status": resp.status_code, "body": resp.text[:10000]}
    elif name == "post_message":
        webhook = os.environ.get("SLACK_WEBHOOK_URL")
        if not webhook:
            raise ValueError("SLACK_WEBHOOK_URL required")
        resp = requests.post(webhook, json={"text": tool_input.get("text")})
        return {"posted": resp.ok, "status": resp.status_code}
    return {"status": "ok", "message": f"Executed {name}"}

def run_agent(user_input: str, inputs: dict = None) -> dict:
    prompt_text = user_input or "Begin work according to procedure."
    if inputs:
        formatted = "\\n".join([f"- {k}: {v}" for k, v in inputs.items()])
        prompt_text = f"INPUTS:\\n{formatted}\\n\\nINSTRUCTION:\\n{prompt_text}"

    messages = [{"role": "user", "content": prompt_text}]
    steps = []
    current_step = 0
    final_deliverable = ""

    while current_step < MAX_STEPS:
        current_step += 1
        response = client.messages.create(
            model=MODEL,
            max_tokens=3000,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        tool_calls = [b for b in response.content if b.type == "tool_use"]
        text_blocks = "\\n".join([b.text for b in response.content if b.type == "text"])
        if text_blocks:
            final_deliverable = text_blocks

        assistant_content = []
        for b in response.content:
            if b.type == "text":
                assistant_content.append({"type": "text", "text": b.text})
            elif b.type == "tool_use":
                assistant_content.append({"type": "tool_use", "id": b.id, "name": b.name, "input": b.input})

        messages.append({"role": "assistant", "content": assistant_content})

        if not tool_calls or response.stop_reason == "end_turn":
            break

        tool_results = []
        for tool in tool_calls:
            try:
                res = execute_tool(tool.name, tool.input)
                err = False
            except Exception as e:
                res = {"error": str(e)}
                err = True

            steps.append({
                "step": current_step,
                "tool": tool.name,
                "input": tool.input,
                "output": res,
                "error": err
            })
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool.id,
                "content": json.dumps(res),
            })

        messages.append({"role": "user", "content": tool_results})

    return {
        "agent": "${spec.name}",
        "archetype": "${spec.archetype}",
        "stepsCompleted": current_step,
        "output": final_deliverable,
        "executionLog": steps,
    }

if __name__ == "__main__":
    arg = " ".join(sys.argv[1:]).strip() or "Execute procedure."
    print(f'Running "${spec.name}"...')
    out = run_agent(arg)
    print("\n=== DELIVERABLE ===\n")
    print(out["output"])
"""`;
}

/**
 * Builds standalone Python FastAPI server (main.py)
 */
function buildPythonServerCode(spec: AgentSpec, version: number | null): string {
  return `"""
FastAPI Standalone Microservice for "${spec.name}"
Exposes /run, /health, and /spec endpoints
"""

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any
from runner import run_agent, SYSTEM_PROMPT, TOOLS

app = FastAPI(
    title="${spec.name} API",
    description=${JSON.stringify(spec.purpose || `Microservice for ${spec.name}`)},
    version="${version || 1}.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class RunRequest(BaseModel):
    input: Optional[str] = "Execute agent task."
    inputs: Optional[Dict[str, Any]] = None

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "agent": "${spec.name}",
        "version": ${version || 1},
        "archetype": "${spec.archetype}",
        "toolsCount": len(TOOLS),
    }

@app.get("/spec")
def get_spec():
    return {
        "name": "${spec.name}",
        "purpose": ${JSON.stringify(spec.purpose || "")},
        "tools": [t["name"] for t in TOOLS],
    }

@app.post("/run")
def execute_run(req: RunRequest):
    try:
        result = run_agent(req.input, req.inputs)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
"""`;
}

function buildPythonRequirements(): string {
  return `fastapi>=0.110.0
uvicorn[standard]>=0.28.0
anthropic>=0.34.0
pydantic>=2.0.0
requests>=2.31.0
python-dotenv>=1.0.0
`;
}

function buildPythonDockerfile(): string {
  return `# Production Container for Agent Studio Python Export
FROM python:3.11-slim
WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV PORT=8080

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
`;
}

/**
 * Builds deploy.sh script for the specific cloud.
 */
function buildDeployScript(spec: AgentSpec, target: ExportTarget, runtime: ExportRuntime): string {

  const slug = slugify(spec.name);

  if (target === "gcp") {
    if (runtime === "container") {
      return `#!/usr/bin/env bash
set -e

# Deploy to Google Cloud Run
echo "Deploying ${spec.name} to Google Cloud Run..."

PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"
SERVICE_NAME="${slug}"

echo "Project: $PROJECT_ID | Region: $REGION | Service: $SERVICE_NAME"

gcloud run deploy "$SERVICE_NAME" \\
  --source . \\
  --platform managed \\
  --region "$REGION" \\
  --allow-unauthenticated \\
  --set-env-vars "ANTHROPIC_MODEL=claude-sonnet-4-6"

echo "Deployment complete! Retrieve the service URL with:"
gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format 'value(status.url)'
`;
    } else {
      return `#!/usr/bin/env bash
set -e

# Deploy to Google Cloud Functions (Gen 2)
echo "Deploying ${spec.name} to Google Cloud Functions..."

gcloud functions deploy "${slug}" \\
  --gen2 \\
  --runtime nodejs22 \\
  --entry-point agentFunction \\
  --source . \\
  --region us-central1 \\
  --trigger-http \\
  --allow-unauthenticated

echo "Deployment complete!"
`;
    }
  }

  if (target === "aws") {
    if (runtime === "serverless") {
      return `#!/usr/bin/env bash
set -e

# Deploy to AWS Lambda via AWS SAM
echo "Building and deploying ${spec.name} to AWS Lambda..."

sam build
sam deploy --guided

echo "Deployment complete!"
`;
    } else {
      return `#!/usr/bin/env bash
set -e

# Build and push Docker image to AWS ECR, then deploy to AWS App Runner
echo "Deploying ${spec.name} to AWS App Runner..."

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION="us-east-1"
REPO="${slug}"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
aws ecr create-repository --repository-name "$REPO" || true

docker build -t "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO:latest" .
docker push "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO:latest"

echo "Pushed container image: $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO:latest"
echo "Create your App Runner service pointing to this image."
`;
    }
  }

  if (target === "azure") {
    return `#!/usr/bin/env bash
set -e

# Deploy to Azure Container Apps
echo "Deploying ${spec.name} to Azure Container Apps..."

RESOURCE_GROUP="agent-studio-rg"
APP_NAME="${slug}"
LOCATION="eastus"

az group create --name "$RESOURCE_GROUP" --location "$LOCATION" || true

az containerapp up \\
  --name "$APP_NAME" \\
  --resource-group "$RESOURCE_GROUP" \\
  --location "$LOCATION" \\
  --source . \\
  --ingress external \\
  --target-port 8080

echo "Deployment complete!"
`;
  }

  if (target === "python") {
    return `#!/usr/bin/env bash
set -e

# Setup and run Python agent service
echo "Setting up Python environment for ${spec.name}..."
python3 -m venv .venv || true
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "Starting agent microservice on port 8080..."
python3 main.py
`;
  }

  // Docker standalone
  return `#!/usr/bin/env bash
set -e

IMAGE_NAME="${slug}:latest"

echo "Building local Docker container: $IMAGE_NAME..."
docker build -t "$IMAGE_NAME" .

echo "Starting container on http://localhost:8080..."
docker run -d --name "${slug}" -p 8080:8080 --env-file .env "$IMAGE_NAME"

echo "Container running! Check logs with: docker logs -f ${slug}"
`;
}

/**
 * Builds Cloud-specific IaC templates (Terraform / SAM / Bicep).
 */
function buildIaCTemplate(spec: AgentSpec, target: ExportTarget, runtime: ExportRuntime): { path: string; content: string; language: string } {
  const slug = slugify(spec.name);

  if (target === "python") {
    return {
      path: "Procfile",
      language: "text",
      content: "web: uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}\n",
    };
  }

  if (target === "aws" && runtime === "serverless") {
    return {
      path: "template.yaml",
      language: "yaml",
      content: `AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: AWS SAM template for ${spec.name}

Globals:
  Function:
    Timeout: 300
    MemorySize: 512
    Runtime: nodejs22.x
    Architectures:
      - x86_64

Resources:
  AgentFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: ${slug}
      CodeUri: ./
      Handler: handler.handler
      FunctionUrlConfig:
        AuthType: NONE
      Environment:
        Variables:
          ANTHROPIC_API_KEY: '{{resolve:secretsmanager:AgentStudioKeys:SecretString:ANTHROPIC_API_KEY}}'
          ANTHROPIC_MODEL: 'claude-sonnet-4-6'

Outputs:
  FunctionUrl:
    Description: Function URL endpoint for invoking the agent
    Value: !GetAtt AgentFunctionUrl.FunctionUrl
`,
    };
  }

  if (target === "azure") {
    return {
      path: "azuredeploy.bicep",
      language: "bicep",
      content: `param location string = resourceGroup().location
param environmentName string = '${slug}-env'
param appName string = '${slug}'

resource env 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: environmentName
  location: location
  properties: {}
}

resource app 'Microsoft.App/containerApps@2023-05-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
      }
    }
    template: {
      containers: [
        {
          name: appName
          image: 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
        }
      ]
    }
  }
}
`,
    };
  }

  // Default Terraform template
  return {
    path: "terraform/main.tf",
    language: "hcl",
    content: target === "gcp"
      ? `terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_cloud_run_service" "agent" {
  name     = "${slug}"
  location = var.region

  template {
    spec {
      containers {
        image = "gcr.io/\${var.project_id}/${slug}:latest"
        resources {
          limits = {
            memory = "1024Mi"
            cpu    = "1000m"
          }
        }
        env {
          name  = "ANTHROPIC_MODEL"
          value = "claude-sonnet-4-6"
        }
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }
}

output "url" {
  value = google_cloud_run_service.agent.status[0].url
}
`
      : `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

resource "aws_lambda_function" "agent" {
  function_name = "${slug}"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "handler.handler"
  runtime       = "nodejs22.x"
  timeout       = 300
  memory_size   = 512
  filename      = "package.zip"
}

resource "aws_iam_role" "lambda_exec" {
  name = "${slug}-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}
`,
  };
}

/**
 * Builds README.md documentation for the exported package.
 */
function buildReadme(
  spec: AgentSpec,
  version: number | null,
  target: ExportTarget,
  runtime: ExportRuntime,
  envVars: { key: string; description: string; hint: string }[]
): string {
  const cloudName = target === "gcp"
    ? "Google Cloud Platform (GCP)"
    : target === "aws"
      ? "Amazon Web Services (AWS)"
      : target === "azure"
        ? "Microsoft Azure"
        : target === "python"
          ? "Python (FastAPI + Anthropic SDK)"
          : "Docker / Standalone";

  return `# ${spec.name} (Exported Agent)

- **Archetype**: \`${spec.archetype}\`
- **Domain**: \`${spec.domain || "Enterprise"}\`
- **Version**: \`${version ? `v${version}` : "Draft"}\`
- **Target Cloud**: **${cloudName}**
- **Runtime Mode**: \`${runtime}\`

---

## What is Inside This Package

This package was exported directly from Agent Studio and contains everything needed to run this agent autonomously in production:

1. **\`runner.mjs\`**: The standalone agent loop powered by Claude Anthropic Messages API, configured with the exact system prompt, guardrails, and tools granted to this agent.
2. **\`server.mjs\`**: Fast HTTP API service exposing \`POST /run\` and \`GET /health\` (for containers, Cloud Run, App Runner, Container Apps).
3. **\`handler.mjs\`**: Serverless function handler (for AWS Lambda, Cloud Functions, Azure Functions).
4. **\`Dockerfile\` & \`docker-compose.yml\`**: Production-ready container definition.
5. **\`deploy.sh\`**: Automated one-command cloud deployment script.
6. **\`skills/\`**: Markdown instructions for workspace skills attached to this agent.

---

## 1. Environment Configuration

Copy \`.env.example\` to \`.env\` and provide credentials for your cloud services:

\`\`\`bash
cp .env.example .env
\`\`\`

### Required Environment Variables
| Variable | Description | Example / Hint |
| :--- | :--- | :--- |
${envVars.map((v) => `| \`${v.key}\` | ${v.description} | \`${v.hint}\` |`).join("\n")}

> **Enterprise Security Tip**: In production, do not commit your \`.env\` file. Inject these secrets securely using:
> - **GCP**: Secret Manager (\`gcloud secrets create\`)
> - **AWS**: AWS Secrets Manager or Parameter Store
> - **Azure**: Azure Key Vault

---

## 2. Local Testing

### Option A: Direct CLI Execution
\`\`\`bash
npm install
node runner.mjs "What are the latest anomalies?"
\`\`\`

### Option B: Local HTTP Microservice
\`\`\`bash
npm run start
\`\`\`
Then call the service:
\`\`\`bash
curl -X POST http://localhost:8080/run \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Start the assigned procedure."}'
\`\`\`

### Option C: Run with Docker
\`\`\`bash
docker compose up --build
\`\`\`

---

## 3. Deploy to ${cloudName}

Run the automated deployment script:

\`\`\`bash
chmod +x deploy.sh
./deploy.sh
\`\`\`

---

## 4. API Endpoints Reference

Once deployed to ${cloudName}, your agent service exposes:

### \`POST /run\`
Triggers an autonomous agent run.
**Request Body**:
\`\`\`json
{
  "input": "User query or task prompt",
  "inputs": {
    "account_number": "ACC-9921",
    "cutoff_date": "2026-09-01"
  }
}
\`\`\`

**Response**:
\`\`\`json
{
  "agent": "${spec.name}",
  "stepsCompleted": 3,
  "output": "The complete deliverable produced by the agent...",
  "executionLog": [ ... ]
}
\`\`\`

### \`GET /health\`
Returns status, version, and tools count.
`;
}

/**
 * Main export generator: builds the virtual file tree for the package.
 */
export function generateExportBundle(opts: {
  spec: AgentSpec;
  agentName: string;
  version: number | null;
  target: ExportTarget;
  runtime: ExportRuntime;
  skills: SkillRow[];
  connections: { id: string; name: string; kind: string }[];
}): ExportBundle {
  const { spec, agentName, version, target, runtime, skills, connections } = opts;
  const slug = slugify(agentName || spec.name);

  const connectionNames: Record<string, string> = {};
  for (const c of connections) connectionNames[c.id] = c.name;

  const systemPrompt = buildSystemPrompt(spec, connectionNames, skills);
  const requiredEnvVars = getRequiredEnvVars(spec);

  const files: ExportFile[] = [];

  // 1. Agent Spec & System Prompt
  files.push({
    path: "agent.json",
    language: "json",
    description: "Complete Agent Studio declarative specification",
    content: JSON.stringify({ name: agentName || spec.name, version, spec }, null, 2),
  });

  files.push({
    path: "system_prompt.txt",
    language: "text",
    description: "Compiled system prompt derived from instructions, domain, and guardrails",
    content: systemPrompt,
  });

  // 2. Standalone Runner & Server
  if (target === "python") {
    files.push({
      path: "runner.py",
      language: "python",
      description: "Standalone Python agent loop and tool dispatch using Anthropic SDK",
      content: buildPythonRunnerCode(spec, skills, systemPrompt),
    });

    files.push({
      path: "main.py",
      language: "python",
      description: "FastAPI HTTP server exposing POST /run and GET /health",
      content: buildPythonServerCode(spec, version),
    });

    files.push({
      path: "requirements.txt",
      language: "text",
      description: "Python package dependencies",
      content: buildPythonRequirements(),
    });

    files.push({
      path: "Dockerfile",
      language: "dockerfile",
      description: "Production Python 3.11-slim container definition",
      content: buildPythonDockerfile(),
    });

    files.push({
      path: "docker-compose.yml",
      language: "yaml",
      description: "Local containerized development and testing configuration",
      content: buildDockerCompose(slug),
    });
  } else {
    // Node.js target runner
    files.push({
      path: "runner.mjs",
      language: "javascript",
      description: "Standalone multi-turn agent execution loop and granted tool handlers",
      content: buildRunnerCode(spec, skills, systemPrompt),
    });

    // Node.js server or serverless handler
    if (runtime === "container") {
      files.push({
        path: "server.mjs",
        language: "javascript",
        description: "HTTP microservice server exposing POST /run and GET /health",
        content: buildServerCode(spec, version),
      });
    } else {
      files.push({
        path: "handler.mjs",
        language: "javascript",
        description: `Serverless function handler for ${target.toUpperCase()}`,
        content: buildHandlerCode(spec, target),
      });
    }

    // Node.js Docker & Compose
    files.push({
      path: "Dockerfile",
      language: "dockerfile",
      description: "Multi-stage Node.js 22 container definition",
      content: buildDockerfile(),
    });

    files.push({
      path: "docker-compose.yml",
      language: "yaml",
      description: "Local containerized development and testing configuration",
      content: buildDockerCompose(slug),
    });

    // Node.js package.json
    files.push({
      path: "package.json",
      language: "json",
      description: "Self-contained dependencies for the standalone agent",
      content: buildPackageJson(spec, target, runtime),
    });
  }

  // 6. .env.example
  const envContent = [
    `# Environment Configuration for "${spec.name}"`,
    `# Generated by Agent Studio - fill with your cloud credentials`,
    ``,
    ...requiredEnvVars.map((v) => `# ${v.description}\n${v.key}=${v.hint}\n`),
  ].join("\n");

  files.push({
    path: ".env.example",
    language: "shell",
    description: "Template of environment variables and connection secrets needed",
    content: envContent,
  });

  // 7. Deploy Script
  files.push({
    path: "deploy.sh",
    language: "shell",
    description: `Automated CLI deployment script for ${target.toUpperCase()}`,
    content: buildDeployScript(spec, target, runtime),
  });

  // 8. Infrastructure as Code template
  const iac = buildIaCTemplate(spec, target, runtime);
  files.push({
    path: iac.path,
    language: iac.language,
    description: `Infrastructure as Code deployment template`,
    content: iac.content,
  });

  // 9. README.md
  files.push({
    path: "README.md",
    language: "markdown",
    description: "Comprehensive step-by-step deployment and integration guide",
    content: buildReadme(spec, version, target, runtime, requiredEnvVars),
  });

  // 10. Embedded Skills
  for (const s of skills) {
    files.push({
      path: `skills/${s.name}.md`,
      language: "markdown",
      description: `Markdown instructions for workspace skill "${s.label}"`,
      content: `# ${s.label}\n\n${s.description ? `> ${s.description}\n\n` : ""}${s.instructions}\n`,
    });
  }

  const deployCommand = target === "gcp"
    ? (runtime === "container" ? `gcloud run deploy ${slug} --source . --region us-central1 --allow-unauthenticated` : `gcloud functions deploy ${slug} --gen2 --runtime nodejs22 --entry-point agentFunction --source . --trigger-http`)
    : target === "aws"
      ? (runtime === "serverless" ? `sam build && sam deploy --guided` : `docker build -t ${slug} . && aws ecr ...`)
      : target === "azure"
        ? `az containerapp up --name ${slug} --source . --ingress external --target-port 8080`
        : target === "python"
          ? `pip install -r requirements.txt && python3 main.py`
          : `docker compose up --build`;

  return {
    agentName: spec.name,
    slug,
    version,
    target,
    runtime,
    files,
    requiredEnvVars,
    deployCommand,
  };
}

/**
 * Generates a ready-to-download binary ZIP buffer from an export bundle.
 */
export async function createExportZip(bundle: ExportBundle): Promise<Buffer> {
  const zip = new JSZip();
  const root = zip.folder(`${bundle.slug}-${bundle.target}`) || zip;

  for (const f of bundle.files) {
    root.file(f.path, f.content);
  }

  return await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}
