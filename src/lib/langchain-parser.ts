import { emptySpec, type AgentSpec, type Archetype } from "./types";
import { SELECTABLE_TOOLS } from "./tools";

export type LangChainTool = {
  name: string;
  description: string;
  parameters: Record<string, any>;
  returnType?: string;
  isCustom?: boolean;
};

export type ParsedLangChainAgent = {
  name: string;
  model: string;
  instruction: string;
  steps: string[];
  tools: LangChainTool[];
  graphNodes?: string[];
  archetype: Archetype;
  language: "python" | "typescript" | "json";
  rawSource: string;
  spec: AgentSpec;
};

export const LANGCHAIN_TEMPLATES = [
  {
    id: "customer-support-react",
    title: "Customer Support ReAct Agent",
    language: "python" as const,
    blurb: "LangChain ReAct agent with order lookup, CRM updates, and payment refund tools.",
    code: `from langchain.agents import create_react_agent, AgentExecutor
from langchain_core.tools import tool
from langchain_anthropic import ChatAnthropic

@tool
def lookup_customer_orders(customer_id: str) -> dict:
    """Query order history, fulfillment status, and delivery tracking."""
    return {"customer_id": customer_id, "orders": [{"id": "ORD-7712", "status": "delivered_damaged", "amount": 189.50}]}

@tool
def issue_customer_refund(order_id: str, amount: float, reason: str) -> dict:
    """Authorize refund transaction for an eligible retail return."""
    return {"refund_id": "RF-8821", "status": "approved", "amount": amount}

llm = ChatAnthropic(model="claude-3-5-sonnet-20241022")
tools = [lookup_customer_orders, issue_customer_refund]

prompt = """You are an autonomous customer support agent.
1. Query customer purchase history using lookup_customer_orders.
2. Determine return eligibility and calculate refund credit.
3. Call issue_customer_refund to disburse payment compensation.
4. Compose a polite confirmation email summarizing the resolution."""

agent = create_react_agent(llm, tools, prompt=prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)
`,
  },
  {
    id: "financial-research-graph",
    title: "Financial Research StateGraph",
    language: "python" as const,
    blurb: "LangGraph StateGraph workflow for automated earnings transcript and financial metrics synthesis.",
    code: `from typing import Annotated
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.tools import tool

class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    ticker: str
    target_metric: str

@tool
def fetch_sec_filing(ticker: str, form_type: str = "10-K") -> dict:
    """Retrieve raw SEC EDGAR 10-K or 10-Q filing report text."""
    return {"ticker": ticker, "revenue_growth": "18.4%", "ebitda_margin": "29.2%"}

@tool
def upload_research_memo(filename: str, report_markdown: str) -> str:
    """Upload finalized executive research brief to S3 vault."""
    return f"s3://equity-research-vault/reports/{filename}"

tools = [fetch_sec_filing, upload_research_memo]

# Workflow Instruction:
# 1. Ingest stock ticker symbol and target accounting metrics.
# 2. Extract quarterly performance ratios using fetch_sec_filing.
# 3. Analyze revenue variance against consensus analyst projections.
# 4. Formulate executive research brief and archive to S3 via upload_research_memo.
`,
  },
  {
    id: "sql-analyst-react",
    title: "Self-Correcting SQL Analyst",
    language: "typescript" as const,
    blurb: "TypeScript LangChain ReAct agent that queries Postgres schemas and runs SQL queries.",
    code: `import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const inspectDbSchema = tool(
  async ({ tableName }) => {
    return { table: tableName, columns: ["id", "amount", "created_at", "status"] };
  },
  {
    name: "inspect_db_schema",
    description: "Inspect column definitions and constraints for a database table",
    schema: z.object({
      tableName: z.string().describe("Target database table name")
    })
  }
);

const executeReadOnlySql = tool(
  async ({ query }) => {
    return { rowCount: 3, rows: [{ id: 1, amount: 450.0, status: "completed" }] };
  },
  {
    name: "execute_read_only_sql",
    description: "Run a read-only SQL query against the analytics replica",
    schema: z.object({
      query: z.string().describe("SQL SELECT statement to run")
    })
  }
);

export const agent = createReactAgent({
  name: "SQL Analytics Specialist",
  tools: [inspectDbSchema, executeReadOnlySql],
  messageModifier: \`You are an expert SQL analytics agent.
1. Inspect relational table definitions using inspect_db_schema.
2. Formulate an optimized PostgreSQL SELECT query.
3. Run the query safely on read-replica using execute_read_only_sql.
4. Summarize statistical insights and anomalies in a markdown table.\`
});
`,
  },
];

function extractSteps(instruction: string): string[] {
  const lines = instruction.split("\n").map((l) => l.trim()).filter(Boolean);
  const numbered: string[] = [];
  for (const line of lines) {
    const match = line.match(/^(\d+[\.\)]|\-|\*|#+)\s+(.*)$/);
    if (match && match[2].length > 10) {
      numbered.push(match[2].trim());
    }
  }
  if (numbered.length >= 2) return numbered.slice(0, 8);

  const sentences = instruction
    .replace(/[\n\r]+/g, " ")
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15 && !/^(you are|your role)/i.test(s));

  return sentences.length > 0 ? sentences.slice(0, 6) : [
    "Analyze incoming request and identify primary goal.",
    "Select and execute appropriate tools to gather evidence.",
    "Formulate structured deliverable and report back to user."
  ];
}

function inferArchetype(name: string, instruction: string, tools: LangChainTool[]): Archetype {
  const text = `${name} ${instruction} ${tools.map((t) => t.name).join(" ")}`.toLowerCase();
  if (/sentinel|watch|alert|monitor|detect|guard|incident|security|anomaly/i.test(text)) {
    return "sentinel";
  }
  if (/operator|process|refund|execute|transfer|reconcil|action|run|provision|sql/i.test(text)) {
    return "operator";
  }
  if (/author|draft|write|email|document|memo|newsletter|summarize/i.test(text)) {
    return "author";
  }
  return "analyst";
}

function parsePythonLangChain(code: string): {
  name: string;
  model: string;
  instruction: string;
  tools: LangChainTool[];
} {
  // Name
  let name = "LangChain ReAct Agent";
  const nameMatch = code.match(/name\s*=\s*["']([^"']+)["']/i);
  if (nameMatch) name = nameMatch[1].trim();
  else if (/financial/i.test(code)) name = "Financial Research StateGraph";
  else if (/customer.*support/i.test(code)) name = "Customer Support ReAct Agent";

  // Model
  let model = "claude-3-5-sonnet-20241022";
  const modelMatch = code.match(/model(?:_name)?\s*=\s*["']([^"']+)["']/i);
  if (modelMatch) model = modelMatch[1].trim();

  // Instruction / Prompt
  let instruction = "";
  const tripleDouble = code.match(/(?:prompt|instruction|system_message)\s*=\s*"""([\s\S]*?)"""/);
  const tripleSingle = code.match(/(?:prompt|instruction|system_message)\s*=\s*'''([\s\S]*?)'''/);
  const commentSteps = code.match(/#\s*Workflow Instruction:\s*\n((?:#.*\n?)+)/i);

  if (tripleDouble) instruction = tripleDouble[1].trim();
  else if (tripleSingle) instruction = tripleSingle[1].trim();
  else if (commentSteps) {
    instruction = commentSteps[1].replace(/#\s?/g, "").trim();
  } else {
    instruction = "Execute multi-step ReAct reasoning using configured tools.";
  }

  // Tools
  const tools: LangChainTool[] = [];
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
      for (const p of rawParams.split(",")) {
        const cleaned = p.trim();
        if (!cleaned || cleaned === "self" || cleaned === "cls") continue;
        const [paramNamePart, defaultVal] = cleaned.split("=");
        const [pName, pType] = paramNamePart.split(":").map((x) => x.trim());
        if (pName) {
          properties[pName] = {
            type: pType?.toLowerCase().includes("int") || pType?.toLowerCase().includes("float") ? "number" : "string",
            description: `Parameter ${pName}`,
          };
          if (!defaultVal) required.push(pName);
        }
      }
    }

    tools.push({
      name: fnName,
      description: docstring || `Execute ${fnName}`,
      parameters: { type: "object", properties, required },
      returnType,
      isCustom: true,
    });
  }

  return { name, model, instruction, tools };
}

function parseTypeScriptLangChain(code: string): {
  name: string;
  model: string;
  instruction: string;
  tools: LangChainTool[];
} {
  let name = "LangChain TypeScript Agent";
  const nameMatch = code.match(/name\s*:\s*["']([^"']+)["']/i);
  if (nameMatch) name = nameMatch[1].trim();

  let model = "claude-3-5-sonnet-20241022";
  const modelMatch = code.match(/model\s*:\s*["']([^"']+)["']/i);
  if (modelMatch) model = modelMatch[1].trim();

  let instruction = "";
  const backtickMatch = code.match(/(?:messageModifier|systemMessage|prompt)\s*:\s*`([\s\S]*?)`/);
  const quoteMatch = code.match(/(?:messageModifier|systemMessage|prompt)\s*:\s*["']([^"']+)["']/);
  if (backtickMatch) instruction = backtickMatch[1].trim();
  else if (quoteMatch) instruction = quoteMatch[1].trim();
  else instruction = "Execute multi-step ReAct reasoning using configured tools.";

  const tools: LangChainTool[] = [];
  const toolBlockRegex = /name\s*:\s*["']([^"']+)["'][\s\S]*?description\s*:\s*["']([^"']+)["']/g;
  let tMatch;
  while ((tMatch = toolBlockRegex.exec(code)) !== null) {
    tools.push({
      name: tMatch[1],
      description: tMatch[2],
      parameters: { type: "object", properties: {}, required: [] },
      isCustom: true,
    });
  }

  return { name, model, instruction, tools };
}

function mapToStudioTools(tools: LangChainTool[]): { id: string; gate: "auto" | "approval" }[] {
  const result: { id: string; gate: "auto" | "approval" }[] = [];
  for (const t of tools) {
    const raw = t.name.toLowerCase();
    const direct = SELECTABLE_TOOLS.find((st) => st.id === raw);
    if (direct) {
      result.push({ id: direct.id, gate: direct.risk === "low" ? "auto" : "approval" });
      continue;
    }
    if (/refund|payment|transfer/i.test(raw)) {
      result.push({ id: "http_request", gate: "approval" });
    } else if (/sql|database|table/i.test(raw)) {
      result.push({ id: "sql_query", gate: "auto" });
    } else if (/upload|s3|storage/i.test(raw)) {
      result.push({ id: "s3_upload_file", gate: "approval" });
    } else if (/sec|filing|research/i.test(raw)) {
      result.push({ id: "web_search", gate: "auto" });
    } else {
      result.push({ id: "http_request", gate: "approval" });
    }
  }
  if (!result.length) result.push({ id: "web_search", gate: "auto" });
  const seen = new Set<string>();
  return result.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function parseLangChainAgent(rawSource: string, forcedLanguage?: "python" | "typescript" | "json"): ParsedLangChainAgent {
  let language: "python" | "typescript" | "json" = forcedLanguage || "python";
  const trimmed = rawSource.trim();

  if (!forcedLanguage) {
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      language = "json";
    } else if (/\b(import\s+.*from\s+["']@langchain|const\s+.*=\s*tool|export\s+const)/.test(rawSource)) {
      language = "typescript";
    } else {
      language = "python";
    }
  }

  let parsed: { name: string; model: string; instruction: string; tools: LangChainTool[]; originalSpec?: AgentSpec };

  try {
    if (language === "typescript") {
      parsed = parseTypeScriptLangChain(rawSource);
    } else if (language === "json") {
      const obj = JSON.parse(rawSource);
      const originalSpec: AgentSpec | undefined =
        obj.spec && typeof obj.spec === "object" && (obj.spec.tools || obj.spec.steps || obj.spec.brief)
          ? obj.spec
          : obj.tools && (obj.steps || obj.purpose || obj.brief || obj.archetype)
          ? obj
          : undefined;

      const rawTools = originalSpec?.tools || obj.tools || [];
      parsed = {
        name: originalSpec?.name || obj.name || "LangChain JSON Agent",
        model: obj.model || "claude-3-5-sonnet-20241022",
        instruction: originalSpec?.brief || (originalSpec as any)?.instructions || originalSpec?.purpose || obj.instruction || obj.prompt || "",
        tools: rawTools.map((t: any) => {
          const toolId = typeof t === "string" ? t : t.id || t.name || "custom_tool";
          const def = SELECTABLE_TOOLS.find((st) => st.id === toolId);
          return {
            name: toolId,
            description: def?.description || t.description || "",
            parameters: def?.schema || t.parameters || {},
            isCustom: !def,
          };
        }),
        originalSpec,
      };
    } else {
      parsed = parsePythonLangChain(rawSource);
    }
  } catch (err: any) {
    throw new Error(`Failed to parse LangChain agent: ${err.message}`);
  }

  const orig = parsed.originalSpec;
  const steps = orig?.steps?.length ? orig.steps : extractSteps(parsed.instruction);
  const archetype = orig?.archetype || inferArchetype(parsed.name, parsed.instruction, parsed.tools);
  const studioTools = mapToStudioTools(parsed.tools);

  const base = emptySpec();
  const spec: AgentSpec = {
    ...base,
    ...(orig || {}),
    name: parsed.name || orig?.name || "LangChain Agent",
    archetype,
    domain:
      orig?.domain ||
      (archetype === "sentinel"
        ? "DevOps & SRE"
        : archetype === "analyst"
        ? "Financial Research"
        : "Customer Operations"),
    purpose: orig?.purpose || parsed.instruction.split("\n")[0] || "Execute designated LangChain task sequence.",
    brief: orig?.brief || parsed.instruction,
    steps,
    tools: orig?.tools?.length
      ? orig.tools
      : studioTools,
    guardrails: {
      maxSteps: 12,
      requireCitations: true,
      escalateOnAmbiguity: true,
      stayInScope: true,
      extra: "Transpiled from LangChain ReAct loop.",
      ...(orig?.guardrails || {}),
    },
    output: {
      format: "Markdown summary",
      instructions: "Detail reasoning steps and tool execution results.",
      ...(orig?.output || {}),
    },
    inputs: orig?.inputs || [],
    skills: orig?.skills || [],
    sources: orig?.sources || [],
    trigger: orig?.trigger || { type: "manual" },
  };

  return {
    name: parsed.name,
    model: parsed.model,
    instruction: parsed.instruction,
    steps,
    tools: parsed.tools,
    archetype,
    language,
    rawSource,
    spec,
  };
}
