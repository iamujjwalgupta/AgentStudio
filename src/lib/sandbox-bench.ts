import { one, q } from "./db";
import { decrypt } from "./crypto";
import { modelAccess } from "./ai";
import { SELECTABLE_TOOLS } from "./tools";
import { anthropicUsage, assertWithinLimits, geminiUsage, recordUsage } from "./metering";
import { parseAdkAgent, ADK_TEMPLATES } from "./adk-parser";
import { parseLangChainAgent, LANGCHAIN_TEMPLATES } from "./langchain-parser";
import { parseFoundryAgent, FOUNDRY_TEMPLATES } from "./foundry-parser";
import { parseOpenAIAgent, OPENAI_TEMPLATES } from "./openai-parser";
import type { AgentSpec } from "./types";

/**
 * The Sandbox: bring in an agent written for another framework, see what was
 * understood, test how it reasons against a real model, and add it to Agent
 * Studio as a draft.
 *
 * Tests never touch real systems. When the agent calls one of its tools the
 * test pauses and the tester supplies the result — a suggested sample, their
 * own data, or an error — so every result in a test is known to be made up.
 */

export type Framework = "adk" | "langchain" | "openai" | "foundry";
export const FRAMEWORK_LABEL: Record<Framework, string> = {
  adk: "Google ADK",
  langchain: "LangChain / LangGraph",
  openai: "OpenAI Agents / Swarm",
  foundry: "Palantir Foundry AIP",
};

/** Which framework a piece of code was written for, from what it imports and calls. */
export function detectFramework(code: string): Framework {
  const c = code || "";
  if (/google\.adk|@google\/adk|google_adk/i.test(c)) return "adk";
  if (/langgraph|langchain|create_react_agent|StateGraph|AgentExecutor/i.test(c)) return "langchain";
  if (/\bfrom\s+swarm\b|import\s+swarm|\bSwarm\s*\(|openai[-_. ]agents|from\s+agents\s+import|transfer_to_|handoffs?\s*[=:]|^\s*import\s+openai\b|^\s*from\s+openai\s+import|\bOpenAI\s*\(|beta\.assistants/im.test(c)) return "openai";
  if (/foundry|palantir|@osdk|ActionType|AipAgent|ontology/i.test(c)) return "foundry";
  // JSON exports carry a hint of where they came from.
  if (/"framework"\s*:\s*"(langchain|langgraph)"/i.test(c)) return "langchain";
  if (/"framework"\s*:\s*"(openai|swarm)"/i.test(c)) return "openai";
  if (/"framework"\s*:\s*"foundry"/i.test(c)) return "foundry";
  return "adk";
}

export type ImportedTool = { name: string; description: string; parameters: Record<string, any> };
export type ImportedAgent = {
  framework: Framework;
  frameworkLabel: string;
  language: string;
  name: string;
  model: string;
  instruction: string;
  steps: string[];
  tools: ImportedTool[];
  /** Other agents or graph nodes this one works with, which are not imported. */
  related: { kind: string; names: string[] } | null;
  spec: AgentSpec;
};

export function parseAny(code: string, framework?: Framework | "auto", language?: string): ImportedAgent {
  const fw: Framework = !framework || framework === "auto" ? detectFramework(code) : framework;
  const lang = language as any;
  const p: any =
    fw === "langchain" ? parseLangChainAgent(code, lang)
    : fw === "foundry" ? parseFoundryAgent(code, lang)
    : fw === "openai" ? parseOpenAIAgent(code, lang === "typescript" ? undefined : lang)
    : parseAdkAgent(code, lang);
  const related =
    p.subAgents?.length ? { kind: "sub-agents", names: p.subAgents }
    : p.handoffs?.length ? { kind: "hand-offs", names: p.handoffs }
    : p.graphNodes?.length ? { kind: "graph steps", names: p.graphNodes }
    : p.ontologyObjects?.length ? { kind: "ontology objects", names: p.ontologyObjects }
    : null;
  // Some parsers fall back to a tool's name, or a stock name, when the agent has none.
  const toolNames = new Set((p.tools || []).map((t: any) => String(t.name)));
  const rawName = String(p.name || p.spec?.name || "").trim();
  const stock = /^(google adk agent|langchain react agent|openai agent|openai swarm agent|foundry agent|foundry aip agent|imported agent)$/i;
  // A code identifier ("order_support", "RerouteShipment") reads better as words.
  const words = (n: string) =>
    /^[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)+$|^[A-Z][a-z0-9]+([A-Z][a-z0-9]+)+$/.test(n)
      ? n.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/^./, (c) => c.toUpperCase())
      : n;
  const name = !rawName || toolNames.has(rawName) || stock.test(rawName) ? "" : words(rawName);
  return {
    framework: fw,
    frameworkLabel: FRAMEWORK_LABEL[fw],
    language: p.language,
    name,
    model: p.model || "",
    instruction: p.instruction || "",
    steps: p.steps?.length ? p.steps : p.spec?.steps || [],
    tools: (p.tools || []).map((t: any) => ({
      name: String(t.name),
      description: String(t.description || ""),
      parameters: t.parameters && typeof t.parameters === "object" ? t.parameters : { type: "object", properties: {} },
    })),
    related,
    spec: p.spec,
  };
}

// ---- tools --------------------------------------------------------------------------

export type CatalogTool = { id: string; label: string; description: string; risk: string; needs: string | null };
export const toolCatalog = (): CatalogTool[] =>
  SELECTABLE_TOOLS.map((t) => ({ id: t.id, label: t.label, description: t.description, risk: t.risk, needs: t.needs ?? null }));

/**
 * The Agent Studio action an imported tool most likely corresponds to, or none.
 * Nothing is matched by default: a tool with no clear counterpart is left out
 * until someone chooses one, rather than quietly becoming a generic web request.
 */
export function suggestTool(t: ImportedTool): { id: string | null; match: "same" | "likely" | "none" } {
  const raw = `${t.name} ${t.description}`.toLowerCase();
  const same = SELECTABLE_TOOLS.find((s) => s.id.toLowerCase() === t.name.toLowerCase());
  if (same) return { id: same.id, match: "same" };
  const has = (id: string) => SELECTABLE_TOOLS.some((s) => s.id === id);
  const rules: [RegExp, string][] = [
    [/web[_ ]?search|search[_ ]the[_ ]web|google[_ ]search|bing/, "web_search"],
    [/\bsql\b|(query|search).*(database|\bdb\b|table|ledger)|general_ledger|journal[_ ]entr/, "sql_query"],
    [/slack/, "post_message"],
    [/teams/, "post_teams_message"],
    [/e-?mail|smtp|send_mail/, "send_email"],
    [/jira|ticket/, "jira_create_issue"],
    [/github[_ ]?(issue|comment|review)|(create|open|file|raise)[_ ](a[_ ])?(github[_ ])?issue|pr[_ ]review/, "github_create_issue"],
    [/s3|upload.*(file|memo|report)|bucket/, "s3_upload_file"],
    [/read.*(document|pdf|file)|parse.*(document|pdf|file)|extract.*(pdf|document)/, "read_document"],
    [/write.*file|save.*file|generate.*(file|report|csv|xlsx|pdf)/, "write_file"],
    [/\bhttp\b|api[_ ]call|rest api|webhook/, "http_request"],
  ];
  for (const [re, id] of rules) if (re.test(raw) && has(id)) return { id, match: "likely" };
  return { id: null, match: "none" };
}

/** Connection kinds this workspace already has, to say which tools are ready. */
export async function connectedKinds(orgId: string): Promise<string[]> {
  const rows = await q<any>(`select distinct kind from connections where org_id = $1`, [orgId]);
  return rows.map((r) => r.kind);
}

// ---- examples ----------------------------------------------------------------------

const EXAMPLE_PROMPTS: Record<string, string[]> = {
  "order-support": ["Customer CUST-4471 says order ORD-2026-8819 arrived damaged and wants a full refund.", "What would you need from me before issuing a refund?"],
  "forensic-audit": ["Review last week's journal entries over $10,000 and flag anything unusual.", "Write a short risk memo on entries posted at the weekend."],
  "devops-triage": ["auth-service p99 latency jumped to 4s in the last 10 minutes. Triage it.", "Who should be told, and what would you post?"],
  "data-pipeline": ["Last night's vendor feed loaded 40% fewer rows than usual. Investigate.", "Is today's transaction feed safe to publish?"],
  "customer-support-react": ["My invoice INV-2231 charged me twice. Can you fix it?", "How do I change the billing email on my account?"],
  "financial-research-graph": ["Summarise the key risks for a mid-cap logistics company this quarter.", "Compare revenue growth of our top three competitors."],
  "sql-analyst-react": ["Which five customers had the highest overdue balance last month?", "How many invoices were paid late in Q3, by region?"],
  "supply-chain-mitigation": ["Port of Rotterdam is closed for 72 hours. Which shipments are at risk?", "Propose alternative routes for shipment SHP-1042."],
  "clinical-compliance": ["Site 12 enrolled a patient outside the age criteria. What do we do?", "Check protocol deviations reported this week."],
  "fleet-maintenance": ["Aircraft N421AX reported a hydraulic pressure warning on landing.", "Which aircraft are due an A-check in the next 7 days?"],
  "tiered-support-swarm": ["I was charged for a plan I cancelled last month.", "The mobile app crashes when I upload a receipt."],
  "security-code-reviewer": ["Review this change: a new endpoint that builds SQL from query-string parameters.", "What would you check first in a login-flow PR?"],
};

export function allExamples() {
  const tag = (fw: Framework, list: any[]) =>
    list.map((t) => ({ id: t.id, title: t.title, blurb: t.blurb, language: t.language, code: t.code, framework: fw, frameworkLabel: FRAMEWORK_LABEL[fw], prompts: EXAMPLE_PROMPTS[t.id] ?? [] }));
  return [...tag("adk", ADK_TEMPLATES), ...tag("langchain", LANGCHAIN_TEMPLATES), ...tag("openai", OPENAI_TEMPLATES), ...tag("foundry", FOUNDRY_TEMPLATES)];
}

// ---- models -------------------------------------------------------------------------

export type Engine = "anthropic" | "gemini";
export type EngineInfo = { id: Engine; label: string; model: string };

async function geminiKey(orgId: string) {
  const row = await one<any>(`select config, secret_enc from connections where org_id = $1 and kind = 'gemini' limit 1`, [orgId]);
  const key = row?.secret_enc ? decrypt(row.secret_enc) : process.env.GEMINI_API_KEY || "";
  return key ? { key, model: row?.config?.model?.trim() || "gemini-2.5-flash" } : null;
}

/** The models this workspace can test with — only those it has a key for. */
export async function availableEngines(orgId: string): Promise<EngineInfo[]> {
  const out: EngineInfo[] = [];
  try {
    const a = await modelAccess(orgId);
    out.push({ id: "anthropic", label: "Claude", model: a.model });
  } catch {
    /* no Anthropic key */
  }
  const g = await geminiKey(orgId);
  if (g) out.push({ id: "gemini", label: "Gemini", model: g.model });
  return out;
}

// ---- one step of a test -------------------------------------------------------------

export type ToolCall = { id: string; name: string; args: any };
export type Turn =
  | { role: "user"; text: string }
  | { role: "agent"; text?: string; calls?: ToolCall[]; engine?: Engine; raw?: any }
  | { role: "tools"; results: { id: string; name: string; output: any }[] };

export type StepResult = { text: string; calls: (ToolCall & { sample: any })[]; engine: Engine; model: string; raw: any };

function systemPrompt(agent: { name: string; instruction: string; steps: string[]; purpose?: string }) {
  return [
    `You are "${agent.name}".`,
    agent.purpose ? `Purpose: ${agent.purpose}` : "",
    agent.instruction ? `Instructions:\n${agent.instruction}` : "",
    agent.steps.length ? `Procedure:\n${agent.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "",
    "Use your tools when you need information or need to act, rather than guessing.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const objectSchema = (p: any) => (p && p.type === "object" ? p : { type: "object", properties: p?.properties || {}, required: p?.required || [] });
const geminiType = (t: any) => {
  const u = String(t || "string").toUpperCase();
  return ["STRING", "NUMBER", "INTEGER", "BOOLEAN", "ARRAY", "OBJECT"].includes(u) ? u : "STRING";
};

/**
 * Sends the conversation so far to the model once, and returns what it said and
 * any tools it wants to call, each with a suggested sample result. The caller
 * supplies the results and calls again.
 */
export async function benchStep(opts: {
  orgId: string;
  userId?: string;
  engine: Engine;
  agent: { name: string; instruction: string; steps: string[]; purpose?: string };
  tools: ImportedTool[];
  transcript: Turn[];
}): Promise<StepResult> {
  const { orgId, userId, engine, agent, tools, transcript } = opts;
  const system = systemPrompt(agent);

  if (engine === "anthropic") {
    const { apiKey, model } = await modelAccess(orgId);
    const messages: any[] = [];
    for (const t of transcript) {
      if (t.role === "user") messages.push({ role: "user", content: t.text });
      else if (t.role === "agent") {
        const blocks =
          t.engine === "anthropic" && Array.isArray(t.raw)
            ? t.raw
            : [
                ...(t.text ? [{ type: "text", text: t.text }] : []),
                ...(t.calls || []).map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.args ?? {} })),
              ];
        if (blocks.length) messages.push({ role: "assistant", content: blocks });
      } else {
        messages.push({
          role: "user",
          content: t.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: typeof r.output === "string" ? r.output : JSON.stringify(r.output) })),
        });
      }
    }
    await assertWithinLimits(orgId, "anthropic");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system,
        messages,
        tools: tools.length ? tools.map((t) => ({ name: t.name, description: t.description || t.name, input_schema: objectSchema(t.parameters) })) : undefined,
      }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json().catch(() => ({}));
    await recordUsage({ orgId, feature: "sandbox", userId }, "anthropic", model, anthropicUsage(data));
    if (!res.ok) throw new Error(data?.error?.message || `Claude returned HTTP ${res.status}`);
    const content = data.content || [];
    return {
      engine,
      model,
      raw: content,
      text: content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim(),
      calls: content.filter((b: any) => b.type === "tool_use").map((b: any) => ({ id: b.id, name: b.name, args: b.input ?? {}, sample: sampleResult(b.name, b.input ?? {}) })),
    };
  }

  const g = await geminiKey(orgId);
  if (!g) throw new Error("No Gemini key is set up. Add one under Connections.");
  const contents: any[] = [];
  for (const t of transcript) {
    if (t.role === "user") contents.push({ role: "user", parts: [{ text: t.text }] });
    else if (t.role === "agent") {
      const parts =
        t.engine === "gemini" && Array.isArray(t.raw)
          ? t.raw
          : [...(t.text ? [{ text: t.text }] : []), ...(t.calls || []).map((c) => ({ functionCall: { name: c.name, args: c.args ?? {} } }))];
      if (parts.length) contents.push({ role: "model", parts });
    } else {
      contents.push({ role: "user", parts: t.results.map((r) => ({ functionResponse: { name: r.name, response: { result: r.output } } })) });
    }
  }
  const functionDeclarations = tools.map((t) => {
    const s = objectSchema(t.parameters);
    return {
      name: t.name,
      description: t.description || t.name,
      parameters: {
        type: "OBJECT",
        properties: Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]: [string, any]) => [k, { type: geminiType(v?.type), description: v?.description || k }])),
        required: Array.isArray(s.required) ? s.required : [],
      },
    };
  });
  await assertWithinLimits(orgId, "gemini");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(g.model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": g.key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents,
      tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
    }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => ({}));
  await recordUsage({ orgId, feature: "sandbox", userId }, "gemini", g.model, geminiUsage(data));
  if (!res.ok) throw new Error(data?.error?.message || `Gemini returned HTTP ${res.status}`);
  const parts = data.candidates?.[0]?.content?.parts || [];
  return {
    engine,
    model: g.model,
    raw: parts,
    text: parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("\n").trim(),
    calls: parts
      .filter((p: any) => p.functionCall)
      .map((p: any, i: number) => ({ id: `g${Date.now().toString(36)}${i}`, name: p.functionCall.name, args: p.functionCall.args ?? {}, sample: sampleResult(p.functionCall.name, p.functionCall.args ?? {}) })),
  };
}

// ---- suggested results ---------------------------------------------------------------

/**
 * A plausible result for a tool call, offered as a starting point. It is shown
 * to the tester, labelled as sample data, and only used if they send it.
 */
export function sampleResult(toolName: string, input: any): any {
  const t = toolName.toLowerCase();
  const i = input && typeof input === "object" ? input : {};
  if (/refund|payment|payout|transfer_funds/.test(t)) {
    return { status: "authorised", refund_reference: "RF-482913", order_id: i.order_id || "ORD-2026-8819", amount: i.amount ?? 249.0, currency: "USD" };
  }
  if (/order|customer|account/.test(t)) {
    return {
      customer_id: i.customer_id || "CUST-4471",
      order_id: i.order_id || "ORD-2026-8819",
      items: [{ sku: "SKU-992", name: "Enterprise hardware hub", quantity: 1, amount: 249.0, delivery_status: "Delivered — damaged" }],
      eligible_for_refund: true,
    };
  }
  if (/ledger|transaction|sql|query|journal/.test(t)) {
    return {
      rows: [
        { entry_id: "JE-88210", account: "9910-SUSPENSE", amount: 45000.0, posted_by: "svc-admin", date: "2026-09-06" },
        { entry_id: "JE-88219", account: "6020-EXPENSE", amount: 15000.0, posted_by: "j.doe", date: "2026-09-08" },
      ],
      row_count: 2,
    };
  }
  if (/log|metric|inspect|health|latency/.test(t)) {
    return { service: i.service || i.serviceName || "auth-service", p99_latency_ms: 4120, error_rate_percent: 14.8, top_error: "Connection pool exhausted (50 of 50 in use)" };
  }
  if (/slack|teams|notify|alert|message|email/.test(t)) {
    return { delivered: true, channel: i.channel || "#ops-alerts", sent_at: new Date().toISOString() };
  }
  if (/upload|s3|storage|save|write/.test(t)) {
    return { saved: true, location: `s3://reports/${i.filename || "report.md"}`, size_bytes: 3420 };
  }
  if (/ticket|jira|issue/.test(t)) return { created: true, key: "OPS-1042", url: "https://example.atlassian.net/browse/OPS-1042" };
  return { ok: true, note: `Replace this with what ${toolName} would really return.`, received: i };
}
