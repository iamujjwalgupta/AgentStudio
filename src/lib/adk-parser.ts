import { emptySpec, type AgentSpec, type Archetype } from "./types";
import { SELECTABLE_TOOLS } from "./tools";

export type AdkTool = {
  name: string;
  description: string;
  parameters: Record<string, any>;
  returnType?: string;
  isCustom?: boolean;
};

export type ParsedAdkAgent = {
  name: string;
  model: string;
  instruction: string;
  steps: string[];
  tools: AdkTool[];
  subAgents: string[];
  archetype: Archetype;
  language: "python" | "typescript" | "json";
  rawSource: string;
  spec: AgentSpec;
};

/**
 * Curated Google ADK templates for immediate experimentation.
 */
export const ADK_TEMPLATES = [
  {
    id: "order-support",
    title: "Customer Order & Refund Support",
    language: "python" as const,
    blurb: "Google ADK agent with order lookup and refund authorization tools.",
    code: `from google.adk import Agent
from google.adk.tools import tool

@tool
def lookup_customer_orders(customer_id: str) -> dict:
    """Fetch order history, shipping tracking numbers, and delivery status."""
    return {"status": "success", "orders": []}

@tool
def process_order_refund(order_id: str, reason: str, amount: float) -> dict:
    """Issue a store credit or credit card refund for an eligible return item."""
    return {"refund_id": "RF-1029", "status": "approved"}

agent = Agent(
    name="Customer Order & Refund Assistant",
    model="gemini-2.5-flash",
    instruction="""You are an autonomous customer support agent for retail orders.
    1. Identify the customer identifier or order reference from the inquiry.
    2. Query order history using lookup_customer_orders to verify purchase details and fulfillment status.
    3. If an item is damaged or delayed beyond warranty, calculate the refund amount.
    4. Call process_order_refund to authorize compensation.
    5. Draft a courteous confirmation email summarizing the resolution.""",
    tools=[lookup_customer_orders, process_order_refund]
)
`,
  },
  {
    id: "forensic-audit",
    title: "Financial Portfolio Forensic Analyst",
    language: "python" as const,
    blurb: "Multi-step analyst agent that checks ledger anomalies and generates risk memos.",
    code: `from google.adk import Agent
from google.adk.tools import tool

@tool
def query_ledger_transactions(account_code: str, min_amount: float = 10000.0) -> list:
    """Query general ledger journal transactions exceeding the materiality threshold."""
    return [{"entry_id": "JE-9011", "amount": 45000.0, "risk": "round_number"}]

@tool
def upload_audit_memo(filename: str, report_markdown: str) -> str:
    """Upload finalized forensic report to secure cloud storage."""
    return "s3://finance-audit-vault/reports/" + filename

agent = Agent(
    name="Financial Portfolio Forensic Auditor",
    model="gemini-2.5-pro",
    instruction="""You are a forensic accounting specialist reviewing journal postings for period close.
    1. Scan general ledger postings using query_ledger_transactions for entries >= $10,000.
    2. Screen for high-risk anomalies: weekend bookings, round sums, or unapproved manual overrides.
    3. Formulate objective verification questions for any entries with risk scores >= 3.
    4. Compile an executive audit memorandum formatted in clean Markdown.
    5. Save the report to secure cloud storage using upload_audit_memo.""",
    tools=[query_ledger_transactions, upload_audit_memo]
)
`,
  },
  {
    id: "devops-triage",
    title: "DevOps Incident Triager & Alerter",
    language: "typescript" as const,
    blurb: "TypeScript Google ADK agent that inspects alerts and notifies on-call channels.",
    code: `import { Agent, tool } from "@google/adk";

const inspectServiceLogs = tool({
  name: "inspect_service_logs",
  description: "Retrieve error rate metrics and stack traces for a degraded microservice",
  parameters: {
    serviceName: { type: "string", description: "Name of the target service" },
    windowMinutes: { type: "number", description: "Lookback window in minutes" }
  }
});

const notifyIncidentChannel = tool({
  name: "notify_incident_channel",
  description: "Send high-priority alert card to the DevOps Teams or Slack channel",
  parameters: {
    severity: { type: "string", enum: ["P1", "P2", "P3"] },
    summary: { type: "string" }
  }
});

export const devopsAgent = new Agent({
  name: "DevOps Incident Sentinel",
  model: "gemini-2.5-flash",
  instruction: \`You are an automated DevOps reliability sentinel.
1. When an alert arrives, identify the affected microservice and incident timeframe.
2. Query error rates and anomalous stack traces using inspect_service_logs.
3. Diagnose the root cause: database connection pool exhaustion, memory leak, or dependency timeout.
4. Broadcast a structured incident brief to on-call engineers using notify_incident_channel.\`,
  tools: [inspectServiceLogs, notifyIncidentChannel]
});
`,
  },
  {
    id: "data-pipeline",
    title: "Data Pipeline Sentinel",
    language: "json" as const,
    blurb: "Declarative JSON Google ADK agent specification for data pipeline monitoring.",
    code: `{
  "name": "Data Pipeline Reliability Sentinel",
  "model": "gemini-2.5-flash",
  "instruction": "You are an automated data pipeline and ETL monitoring sentinel.\\n1. Check status of incoming ETL ingestion batches using check_pipeline_health.\\n2. Query dead letter queues and anomaly logs with query_dead_letter_queue.\\n3. If error rates exceed 5%, trigger alert cards via notify_incident_channel.\\n4. Post summary report to cloud audit storage.",
  "tools": [
    {
      "name": "check_pipeline_health",
      "description": "Inspect Kafka topics, batch consumer lag, and ingestion throughput",
      "parameters": {
        "pipeline_id": { "type": "string", "description": "Unique ETL pipeline identifier" }
      }
    },
    {
      "name": "query_dead_letter_queue",
      "description": "Fetch failed records from dead letter queue for root cause analysis",
      "parameters": {
        "limit": { "type": "number", "description": "Maximum records to inspect" }
      }
    }
  ]
}
`,
  },
];

/**
 * Decompiles freeform instruction text into ordered procedural steps.
 */
function extractSteps(instruction: string): string[] {
  const lines = instruction.split("\n").map((l) => l.trim()).filter(Boolean);
  const numberedSteps: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(\d+[\.\)]|\-|\*)\s+(.*)$/);
    if (match && match[2].length > 10) {
      numberedSteps.push(match[2].trim());
    }
  }

  if (numberedSteps.length >= 2) {
    return numberedSteps.slice(0, 8);
  }

  // Fallback: split on sentence boundaries
  const sentences = instruction
    .replace(/[\n\r]+/g, " ")
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15 && !/^(you are|your role)/i.test(s));

  return sentences.length > 0 ? sentences.slice(0, 6) : ["Follow instructions according to assigned goals."];
}

/**
 * Infers archetype from instructions, name, and tools.
 */
function inferArchetype(name: string, instruction: string, tools: AdkTool[]): Archetype {
  const text = `${name} ${instruction} ${tools.map((t) => t.name).join(" ")}`.toLowerCase();
  if (/sentinel|watch|alert|monitor|detect|guard|incident|security|anomaly/i.test(text)) {
    return "sentinel";
  }
  if (/operator|process|refund|execute|transfer|reconcil|action|run|provision/i.test(text)) {
    return "operator";
  }
  if (/author|draft|write|email|document|memo|newsletter|summarize/i.test(text)) {
    return "author";
  }
  return "analyst";
}

/**
 * Parses Python Google ADK source code.
 */
function parsePythonAdk(code: string): {
  name: string;
  model: string;
  instruction: string;
  tools: AdkTool[];
  subAgents: string[];
  originalSpec?: AgentSpec;
} {
  // Check for embedded SPEC
  let originalSpec: AgentSpec | undefined;
  const specMatch = code.match(/SPEC\s*=\s*json\.loads\(\s*(["'][\s\S]*?["'])\s*\)/);
  if (specMatch) {
    try {
      const decoded = JSON.parse(specMatch[1]);
      originalSpec = typeof decoded === "string" ? JSON.parse(decoded) : decoded;
    } catch {
      /* ignore */
    }
  }

  // 1. Agent Name
  const runnerTitleMatch = code.match(/Standalone Agent Studio (?:Python )?Runner for ["']([^"']+)["']/i);
  const nameMatch = code.match(/name\s*=\s*["']([^"']+)["']/i);
  const agentKeyMatch = code.match(/agent\s*=\s*["']([^"']+)["']/i);
  const name = originalSpec?.name || (runnerTitleMatch ? runnerTitleMatch[1].trim() : nameMatch ? nameMatch[1].trim() : agentKeyMatch ? agentKeyMatch[1].trim() : "Google ADK Agent");

  // 2. Model
  const modelMatch = code.match(/model\s*=\s*["']([^"']+)["']/i);
  const model = modelMatch ? modelMatch[1].trim() : "gemini-2.5-flash";

  // 3. Instruction
  let instruction = "";
  const systemPromptTriple = code.match(/SYSTEM_PROMPT\s*=\s*"""([\s\S]*?)"""/);
  const systemPromptSingle = code.match(/SYSTEM_PROMPT\s*=\s*["']([\s\S]*?)["']/);
  const tripleSingle = code.match(/instruction\s*=\s*'''([\s\S]*?)'''/);
  const tripleDouble = code.match(/instruction\s*=\s*"""([\s\S]*?)"""/);
  const singleLine = code.match(/instruction\s*=\s*["']([^"']+)["']/);

  if (originalSpec?.brief) instruction = originalSpec.brief;
  else if (originalSpec?.purpose) instruction = originalSpec.purpose;
  else if (systemPromptTriple) instruction = systemPromptTriple[1].trim();
  else if (systemPromptSingle) instruction = systemPromptSingle[1].trim();
  else if (tripleDouble) instruction = tripleDouble[1].trim();
  else if (tripleSingle) instruction = tripleSingle[1].trim();
  else if (singleLine) instruction = singleLine[1].trim();
  else instruction = "Execute tasks according to Google ADK specification.";

  // 4. Tools via @tool def ...
  const tools: AdkTool[] = [];
  if (originalSpec?.tools?.length) {
    for (const t of originalSpec.tools) {
      const def = SELECTABLE_TOOLS.find((st) => st.id === t.id);
      tools.push({
        name: t.id,
        description: def?.description || `Tool ${t.id}`,
        parameters: def?.schema || { type: "object", properties: {}, required: [] },
        isCustom: !def,
      });
    }
  }

  const toolRegex = /@tool(?:\([^\)]*\))?\s+def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)(?:\s*->\s*([a-zA-Z0-9_\[\], ]+))?:(?:\s*"""([\s\S]*?)"""|\s*'''([\s\S]*?)''')?/g;
  let match;

  while ((match = toolRegex.exec(code)) !== null) {
    const fnName = match[1];
    const rawParams = match[2];
    const returnType = match[3] || "any";
    const docstring = (match[4] || match[5] || "").trim();

    const properties: Record<string, any> = {};
    const required: string[] = [];

    if (rawParams.trim()) {
      const paramParts = rawParams.split(",");
      for (const p of paramParts) {
        const cleaned = p.trim();
        if (!cleaned || cleaned === "self" || cleaned === "cls") continue;
        const [paramNamePart, defaultVal] = cleaned.split("=");
        const [pName, pType] = paramNamePart.split(":").map((x) => x.trim());
        if (pName) {
          properties[pName] = {
            type: pType?.toLowerCase().includes("int") || pType?.toLowerCase().includes("float") ? "number" : pType?.toLowerCase().includes("bool") ? "boolean" : "string",
            description: `Parameter ${pName}`,
          };
          if (!defaultVal) required.push(pName);
        }
      }
    }

    if (!tools.some((t) => t.name === fnName)) {
      tools.push({
        name: fnName,
        description: docstring || `Execute ${fnName}`,
        parameters: { type: "object", properties, required },
        returnType,
        isCustom: true,
      });
    }
  }

  // 5. Tools listed in tools=[...]
  const toolsListMatch = code.match(/tools\s*=\s*\[([^\]]*)\]/);
  if (toolsListMatch) {
    const listNames = toolsListMatch[1].split(",").map((x) => x.trim()).filter(Boolean);
    for (const item of listNames) {
      if (!tools.some((t) => t.name === item)) {
        tools.push({
          name: item,
          description: `Google ADK tool "${item}"`,
          parameters: { type: "object", properties: {}, required: [] },
          isCustom: true,
        });
      }
    }
  }

  // 6. Sub-agents / Workflows
  const subAgents: string[] = [];
  const subAgentsMatch = code.match(/sub_agents\s*=\s*\[([^\]]*)\]/i);
  if (subAgentsMatch) {
    subAgents.push(...subAgentsMatch[1].split(",").map((s) => s.trim()).filter(Boolean));
  }

  return { name, model, instruction, tools, subAgents, originalSpec };
}

/**
 * Parses TypeScript / JavaScript Google ADK source code.
 */
function parseTypeScriptAdk(code: string): {
  name: string;
  model: string;
  instruction: string;
  tools: AdkTool[];
  subAgents: string[];
  originalSpec?: AgentSpec;
} {
  // Check for embedded SPEC
  let originalSpec: AgentSpec | undefined;
  const specMatch = code.match(/(?:export\s+)?const\s+SPEC\s*=\s*(\{[\s\S]*?\n\s*\});/);
  if (specMatch) {
    try {
      originalSpec = JSON.parse(specMatch[1]);
    } catch {
      /* ignore */
    }
  }

  // Check for agent runner comment or declaration
  const runnerTitleMatch = code.match(/Standalone Agent Studio Runner for ["']([^"']+)["']/i);
  const returnAgentMatch = code.match(/agent\s*:\s*["']([^"']+)["']/i);
  const adkAgentNameMatch = code.match(/(?:new\s+Agent|createReactAgent|Agent)\s*\(\s*\{[\s\S]*?name\s*:\s*["']([^"']+)["']/i);
  const topNameMatch = code.match(/^[ \t]*name\s*:\s*["']([^"']+)["']/im);

  const name =
    originalSpec?.name ||
    (runnerTitleMatch ? runnerTitleMatch[1].trim() : returnAgentMatch ? returnAgentMatch[1].trim() : adkAgentNameMatch ? adkAgentNameMatch[1].trim() : topNameMatch ? topNameMatch[1].trim() : "Google ADK Agent");

  const modelMatch = code.match(/model\s*:\s*["']([^"']+)["']/i);
  const model = modelMatch ? modelMatch[1].trim() : "gemini-2.5-flash";

  let instruction = "";
  const systemPromptMatch = code.match(/SYSTEM_PROMPT\s*=\s*(["'`])([\s\S]*?)\1;/);
  const backtickMatch = code.match(/instruction\s*:\s*`([\s\S]*?)`/);
  const quoteMatch = code.match(/instruction\s*:\s*["']([^"']+)["']/);

  if (originalSpec?.brief) instruction = originalSpec.brief;
  else if (originalSpec?.purpose) instruction = originalSpec.purpose;
  else if (systemPromptMatch) instruction = systemPromptMatch[2].trim();
  else if (backtickMatch) instruction = backtickMatch[1].trim();
  else if (quoteMatch) instruction = quoteMatch[1].trim();
  else instruction = "Execute tasks according to Google ADK specification.";

  const tools: AdkTool[] = [];
  if (originalSpec?.tools?.length) {
    for (const t of originalSpec.tools) {
      const def = SELECTABLE_TOOLS.find((st) => st.id === t.id);
      tools.push({
        name: t.id,
        description: def?.description || `Tool ${t.id}`,
        parameters: def?.schema || { type: "object", properties: {}, required: [] },
        isCustom: !def,
      });
    }
  }

  // Parse tool({ name: "...", description: "...", parameters: { ... } })
  const toolBlockRegex = /tool\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  let tMatch;
  while ((tMatch = toolBlockRegex.exec(code)) !== null) {
    const body = tMatch[1];
    const n = body.match(/name\s*:\s*["']([^"']+)["']/);
    const d = body.match(/description\s*:\s*["']([^"']+)["']/);
    if (n && !tools.some((t) => t.name === n[1])) {
      tools.push({
        name: n[1],
        description: d ? d[1] : `Tool ${n[1]}`,
        parameters: { type: "object", properties: {}, required: [] },
        isCustom: true,
      });
    }
  }

  // Parse tools array in runner: export const TOOLS = [ { name: "...", description: "..." } ]
  const toolsArrayMatch = code.match(/export\s+const\s+TOOLS\s*=\s*\[([\s\S]*?)\];/);
  if (toolsArrayMatch) {
    const arrayBody = toolsArrayMatch[1];
    const itemRegex = /name\s*:\s*["']([^"']+)["'][\s\S]*?description\s*:\s*["']([^"']+)["']/g;
    let im: RegExpExecArray | null;
    while ((im = itemRegex.exec(arrayBody)) !== null) {
      const toolName = im[1];
      const toolDesc = im[2];
      if (toolName !== "load_skill" && !tools.some((t) => t.name === toolName)) {
        tools.push({
          name: toolName,
          description: toolDesc,
          parameters: { type: "object", properties: {}, required: [] },
          isCustom: !SELECTABLE_TOOLS.some((st) => st.id === toolName),
        });
      }
    }
  }

  const subAgents: string[] = [];
  const subMatch = code.match(/subAgents\s*:\s*\[([^\]]*)\]/i);
  if (subMatch) {
    subAgents.push(...subMatch[1].split(",").map((s) => s.trim()).filter(Boolean));
  }

  return { name, model, instruction, tools, subAgents, originalSpec };
}

/**
 * Parses JSON Google ADK configuration or Agent Studio exported agent.json.
 */
function parseJsonAdk(code: string): {
  name: string;
  model: string;
  instruction: string;
  tools: AdkTool[];
  subAgents: string[];
  originalSpec?: AgentSpec;
} {
  let clean = code.trim();
  // Strip markdown code fences if present (e.g. ```json ... ```)
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }

  let parsed: any;
  try {
    parsed = JSON.parse(clean);
  } catch (err: any) {
    // If standard JSON.parse fails, try forgiving cleanups (trailing commas, single quotes)
    try {
      const relaxed = clean
        .replace(/,\s*([\]}])/g, "$1") // remove trailing commas
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"'); // single to double quotes
      parsed = JSON.parse(relaxed);
    } catch {
      throw new Error(`Invalid JSON syntax: ${err.message}. Ensure valid JSON structure.`);
    }
  }

  // Detect Agent Studio spec bundle
  const originalSpec: AgentSpec | undefined =
    parsed.spec && typeof parsed.spec === "object" && (parsed.spec.tools || parsed.spec.steps || parsed.spec.brief)
      ? parsed.spec
      : parsed.tools && (parsed.steps || parsed.purpose || parsed.brief || parsed.archetype)
      ? parsed
      : undefined;

  const name =
    originalSpec?.name ||
    parsed.name ||
    parsed.agent_name ||
    parsed.agentName ||
    "Google ADK Agent";

  const model = parsed.model || parsed.model_name || parsed.modelName || "gemini-2.5-flash";

  const instruction =
    originalSpec?.brief ||
    (originalSpec as any)?.instructions ||
    originalSpec?.purpose ||
    parsed.instruction ||
    parsed.system_instruction ||
    parsed.instructions ||
    parsed.systemInstruction ||
    "";

  // Parse tools
  const rawTools = originalSpec?.tools || parsed.tools || parsed.tools_list || parsed.functions || [];
  const tools: AdkTool[] = Array.isArray(rawTools)
    ? rawTools.map((t: any) => {
        const toolId = typeof t === "string" ? t : t.id || t.name || t.function?.name || "custom_tool";
        const def = SELECTABLE_TOOLS.find((st) => st.id === toolId);
        return {
          name: toolId,
          description:
            def?.description ||
            t.description ||
            t.function?.description ||
            (typeof t === "string" ? `Execute ${t}` : "Custom ADK Tool"),
          parameters:
            def?.schema ||
            t.parameters ||
            t.input_schema ||
            t.function?.parameters || { type: "object", properties: {}, required: [] },
          isCustom: !def,
        };
      })
    : [];

  const subAgents: string[] = Array.isArray(parsed.sub_agents || parsed.subAgents)
    ? (parsed.sub_agents || parsed.subAgents).map((s: any) => (typeof s === "string" ? s : s.name))
    : [];

  return { name, model, instruction, tools, subAgents, originalSpec };
}

/**
 * Maps ADK tools to native Agent Studio selectable tools where matching,
 * or registers them as approval-gated actions.
 */
function mapToStudioTools(
  adkTools: AdkTool[],
  originalSpec?: AgentSpec
): { id: string; gate: "auto" | "approval" }[] {
  const result: { id: string; gate: "auto" | "approval" }[] = [];

  for (const t of adkTools) {
    const raw = t.name.toLowerCase();

    // Look for direct match in SELECTABLE_TOOLS
    const direct = SELECTABLE_TOOLS.find((st) => st.id === raw || st.id.toLowerCase() === raw);
    if (direct) {
      const origGate = originalSpec?.tools?.find((x: any) => (x.id || x.name) === direct.id)?.gate;
      result.push({ id: direct.id, gate: origGate || (direct.risk === "low" ? "auto" : "approval") });
      continue;
    }

    // Heuristic matching
    if (/order.*refund|refund|payment|transfer/i.test(raw)) {
      result.push({ id: "http_request", gate: "approval" });
    } else if (/ledger|sql|database|query_.*transaction/i.test(raw)) {
      result.push({ id: "sql_query", gate: "auto" });
    } else if (/upload.*memo|s3|storage/i.test(raw)) {
      result.push({ id: "s3_upload_file", gate: "approval" });
    } else if (/log|inspect|metric/i.test(raw)) {
      result.push({ id: "http_request", gate: "auto" });
    } else if (/slack/i.test(raw)) {
      result.push({ id: "post_message", gate: "approval" });
    } else if (/teams|alert_channel|notify/i.test(raw)) {
      result.push({ id: "post_teams_message", gate: "approval" });
    } else if (/jira|ticket|issue/i.test(raw)) {
      result.push({ id: "jira_create_issue", gate: "approval" });
    } else if (/github/i.test(raw)) {
      result.push({ id: "github_create_issue", gate: "approval" });
    } else if (/document|pdf|read_file|parse_file/i.test(raw)) {
      result.push({ id: "read_document", gate: "auto" });
    } else if (/write_file|generate_file|save_file/i.test(raw)) {
      result.push({ id: "write_file", gate: "auto" });
    } else {
      // Default custom tool mapped to API request
      result.push({ id: "http_request", gate: "approval" });
    }
  }

  // Ensure at least one tool
  if (!result.length) {
    result.push({ id: "web_search", gate: "auto" });
  }

  // Deduplicate
  const seen = new Set<string>();
  return result.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * Parses and transpiles any Google ADK agent definition into an Agent Studio spec.
 */
export function parseAdkAgent(rawSource: string, forcedLanguage?: "python" | "typescript" | "json"): ParsedAdkAgent {
  let language: "python" | "typescript" | "json" = forcedLanguage || "python";
  const trimmed = rawSource.trim();

  // If forced language is json, but content is visibly Python or TypeScript code, detect actual language
  if (language === "json" && !trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith("```json")) {
    if (/\b(def\s+|from\s+google|import\s+google|@tool)\b/.test(rawSource)) {
      language = "python";
    } else if (/\b(import\s+.*from|const\s+|let\s+|export\s+|new\s+Agent|tool\s*\()\b/.test(rawSource)) {
      language = "typescript";
    }
  } else if (!forcedLanguage) {
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      language = "json";
    } else if (/\b(import\s+.*from\s+["']@google\/adk|export\s+const|const\s+.*=\s*tool|new\s+Agent)/.test(rawSource)) {
      language = "typescript";
    } else {
      language = "python";
    }
  }

  let parsedData: {
    name: string;
    model: string;
    instruction: string;
    tools: AdkTool[];
    subAgents: string[];
    originalSpec?: AgentSpec;
  };

  try {
    if (language === "json") {
      parsedData = parseJsonAdk(rawSource);
    } else if (language === "typescript") {
      parsedData = parseTypeScriptAdk(rawSource);
    } else {
      parsedData = parsePythonAdk(rawSource);
    }
  } catch (err: any) {
    // Graceful fallback: If JSON parsing failed and code is visibly Python or TS, parse accordingly
    if (language === "json") {
      try {
        if (/\b(def\s+|from\s+|import\s+google|@tool)\b/.test(rawSource)) {
          parsedData = parsePythonAdk(rawSource);
          language = "python";
        } else if (/\b(const\s+|export\s+|new\s+Agent|tool\s*\()\b/.test(rawSource)) {
          parsedData = parseTypeScriptAdk(rawSource);
          language = "typescript";
        } else {
          throw err;
        }
      } catch {
        throw new Error(`Failed to parse Google ADK JSON code: ${err.message || String(err)}`);
      }
    } else {
      throw new Error(`Failed to parse Google ADK ${language} code: ${err.message || String(err)}`);
    }
  }

  const orig = parsedData.originalSpec;
  const steps = orig?.steps?.length ? orig.steps : extractSteps(parsedData.instruction);
  const archetype = orig?.archetype || inferArchetype(parsedData.name, parsedData.instruction, parsedData.tools);
  const studioTools = mapToStudioTools(parsedData.tools, orig);

  const base = emptySpec();
  const spec: AgentSpec = {
    ...base,
    ...(orig || {}),
    name: parsedData.name || orig?.name || "Google ADK Agent",
    archetype,
    domain:
      orig?.domain ||
      (archetype === "sentinel"
        ? "DevOps & SRE"
        : archetype === "analyst"
        ? "Financial Close"
        : "Customer Operations"),
    purpose:
      orig?.purpose ||
      parsedData.instruction.split("\n")[0] ||
      `Autonomous agent converted from Google ADK (${parsedData.model}).`,
    brief: orig?.brief || parsedData.instruction,
    steps,
    tools: studioTools,
    guardrails: {
      maxSteps: 12,
      requireCitations: true,
      escalateOnAmbiguity: true,
      stayInScope: true,
      extra: `Originally authored in Google ADK (${parsedData.model}). Follow strict procedures.`,
      ...(orig?.guardrails || {}),
    },
    output: {
      format: "Markdown summary report",
      instructions: "Include clear status, cited figures, and step-by-step confirmation of actions taken.",
      ...(orig?.output || {}),
    },
    inputs: orig?.inputs || [],
    skills: orig?.skills || [],
    sources: orig?.sources || [],
    trigger: orig?.trigger || { type: "manual" },
  };

  return {
    name: parsedData.name,
    model: parsedData.model,
    instruction: parsedData.instruction,
    steps,
    tools: parsedData.tools,
    subAgents: parsedData.subAgents,
    archetype,
    language,
    rawSource,
    spec,
  };
}
