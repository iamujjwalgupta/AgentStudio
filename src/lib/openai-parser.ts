import { emptySpec, type AgentSpec, type Archetype } from "./types";
import { SELECTABLE_TOOLS } from "./tools";

export type OpenAITool = {
  name: string;
  description: string;
  parameters: Record<string, any>;
  isHandoff?: boolean;
};

export type ParsedOpenAIAgent = {
  name: string;
  model: string;
  instruction: string;
  steps: string[];
  tools: OpenAITool[];
  handoffs: string[];
  archetype: Archetype;
  language: "python" | "json";
  rawSource: string;
  spec: AgentSpec;
};

export const OPENAI_TEMPLATES = [
  {
    id: "tiered-support-swarm",
    title: "Tiered Customer Support Swarm",
    language: "python" as const,
    blurb: "OpenAI Swarm agent with automated intent classification and specialist handoff routines.",
    code: `from swarm import Swarm, Agent

def query_order_database(order_id: str) -> str:
    """Retrieve billing, order status, and tracking telemetry."""
    return f"Order {order_id}: Shipped via Priority Air, Status: Delayed at Hub"

def transfer_to_refund_specialist() -> Agent:
    """Handoff customer conversation to senior financial refund specialist."""
    return refund_agent

triage_agent = Agent(
    name="Customer Support Triage Swarm",
    model="gpt-4o",
    instructions="""You are a front-line customer support triage agent.
1. Welcome the customer and extract the customer identifier or order reference.
2. Query order database with query_order_database to inspect fulfillment status.
3. If order is lost, damaged, or delayed beyond SLA, call transfer_to_refund_specialist.
4. Otherwise, summarize tracking resolution to customer.""",
    functions=[query_order_database, transfer_to_refund_specialist]
)
`,
  },
  {
    id: "security-code-reviewer",
    title: "Automated Pull Request Security Reviewer",
    language: "python" as const,
    blurb: "OpenAI Assistant scanning PR diffs for secret leaks and injection vulnerabilities.",
    code: `import openai

def scan_git_diff(pr_number: int) -> dict:
    """Fetch unified git diff from GitHub repository."""
    return {"pr_number": pr_number, "changed_files": ["auth/jwt.py"], "added_lines": 42}

def post_github_pr_review(pr_number: int, comments_markdown: str, approve: bool) -> dict:
    """Submit inline review comments and approval status to GitHub PR."""
    return {"status": "submitted", "review_id": 8912}

agent = {
    "name": "Security Code Reviewer Assistant",
    "model": "gpt-4o",
    "instructions": """You are an automated DevSecOps code reviewer.
1. Fetch pull request unified diffs using scan_git_diff.
2. Scan for hardcoded secrets, SQL injection, and insecure JWT signing routines.
3. Formulate structured remediation recommendations with code snippets.
4. Publish review audit to the pull request via post_github_pr_review.""",
    "tools": [scan_git_diff, post_github_pr_review]
}
`,
  },
];

function extractSteps(instruction: string): string[] {
  const lines = instruction.split("\n").map((l) => l.trim()).filter(Boolean);
  const numbered: string[] = [];
  for (const line of lines) {
    const match = line.match(/^(\d+[\.\)]|\-|\*)\s+(.*)$/);
    if (match && match[2].length > 10) numbered.push(match[2].trim());
  }
  if (numbered.length >= 2) return numbered.slice(0, 8);

  return [
    "Analyze incoming request and extract relevant parameters.",
    "Execute diagnostic queries or delegate via handoff routines.",
    "Formulate structured deliverable and post resolution to user."
  ];
}

function inferArchetype(name: string, instruction: string, tools: OpenAITool[]): Archetype {
  const text = `${name} ${instruction} ${tools.map((t) => t.name).join(" ")}`.toLowerCase();
  if (/security|review|pr|vuln|scan|audit/i.test(text)) return "sentinel";
  if (/refund|billing|transfer|handoff|order/i.test(text)) return "operator";
  return "analyst";
}

export function parseOpenAIAgent(rawSource: string, forcedLanguage?: "python" | "json"): ParsedOpenAIAgent {
  let language: "python" | "json" = forcedLanguage || "python";
  const trimmed = rawSource.trim();
  if (!forcedLanguage && trimmed.startsWith("{") && trimmed.endsWith("}")) language = "json";

  let name = "OpenAI Swarm Agent";
  let model = "gpt-4o";
  let instruction = "";
  const tools: OpenAITool[] = [];
  const handoffs: string[] = [];
  let originalSpec: AgentSpec | undefined;

  if (language === "json") {
    try {
      const obj = JSON.parse(rawSource);
      originalSpec =
        obj.spec && typeof obj.spec === "object" && (obj.spec.tools || obj.spec.steps || obj.spec.brief)
          ? obj.spec
          : obj.tools && (obj.steps || obj.purpose || obj.brief || obj.archetype)
          ? obj
          : undefined;

      name = originalSpec?.name || obj.name || name;
      model = obj.model || model;
      instruction =
        originalSpec?.brief ||
        (originalSpec as any)?.instructions ||
        originalSpec?.purpose ||
        obj.instructions ||
        obj.instruction ||
        "";
      const rawTools = originalSpec?.tools || obj.tools || obj.functions || [];
      for (const t of rawTools) {
        const toolId = typeof t === "string" ? t : t.id || t.name;
        tools.push({
          name: toolId,
          description: t.description || "",
          parameters: t.parameters || {},
        });
      }
    } catch (err: any) {
      throw new Error(`Invalid JSON syntax in OpenAI agent: ${err.message}`);
    }
  } else {
    const nameMatch = rawSource.match(/name\s*=\s*["']([^"']+)["']/i);
    if (nameMatch) name = nameMatch[1].trim();

    const modelMatch = rawSource.match(/model\s*=\s*["']([^"']+)["']/i);
    if (modelMatch) model = modelMatch[1].trim();

    const instMatch = rawSource.match(/(?:instructions|instruction)\s*=\s*"""([\s\S]*?)"""/);
    if (instMatch) instruction = instMatch[1].trim();
    else instruction = "Execute OpenAI Swarm agent instructions.";

    // Functions
    const fnRegex = /def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)(?:\s*->\s*([a-zA-Z0-9_\[\], ]+))?:(?:\s*"""([\s\S]*?)"""|\s*'''([\s\S]*?)''')?/g;
    let match;
    while ((match = fnRegex.exec(rawSource)) !== null) {
      const fnName = match[1];
      const isHandoff = fnName.startsWith("transfer_to_");
      if (isHandoff) handoffs.push(fnName);
      tools.push({
        name: fnName,
        description: match[4] || match[5] || (isHandoff ? `Handoff to specialist` : `Execute ${fnName}`),
        parameters: {},
        isHandoff,
      });
    }
  }

  const steps = originalSpec?.steps?.length ? originalSpec.steps : extractSteps(instruction);
  const archetype = originalSpec?.archetype || inferArchetype(name, instruction, tools);

  const studioTools = originalSpec?.tools?.length
    ? originalSpec.tools
    : tools.map((t) => {
        const raw = t.name.toLowerCase();
        if (raw.includes("github")) return { id: "github_create_issue", gate: "approval" as const };
        if (raw.includes("order") || raw.includes("sql")) return { id: "sql_query", gate: "auto" as const };
        return { id: "http_request", gate: (t.isHandoff ? "auto" : "approval") as "auto" | "approval" };
      });

  const base = emptySpec();
  const spec: AgentSpec = {
    ...base,
    ...(originalSpec || {}),
    name: name || originalSpec?.name || "OpenAI Agent",
    archetype,
    domain: originalSpec?.domain || (archetype === "sentinel" ? "DevSecOps & Code Integrity" : "Customer Success Operations"),
    purpose: originalSpec?.purpose || instruction.split("\n")[0] || "Complete Swarm delegation pipeline.",
    brief: originalSpec?.brief || instruction,
    steps,
    tools: studioTools,
    guardrails: {
      maxSteps: 12,
      requireCitations: true,
      escalateOnAmbiguity: true,
      stayInScope: true,
      extra: "Transpiled from OpenAI Swarm routine.",
      ...(originalSpec?.guardrails || {}),
    },
    output: {
      format: "Markdown report",
      instructions: "Detail swarm handoffs and action outcomes.",
      ...(originalSpec?.output || {}),
    },
    inputs: originalSpec?.inputs || [],
    skills: originalSpec?.skills || [],
    sources: originalSpec?.sources || [],
    trigger: originalSpec?.trigger || { type: "manual" },
  };

  return {
    name,
    model,
    instruction,
    steps,
    tools,
    handoffs,
    archetype,
    language,
    rawSource,
    spec,
  };
}
