import { emptySpec, type AgentSpec, type Archetype } from "./types";
import { SELECTABLE_TOOLS } from "./tools";

export type FoundryAction = {
  name: string;
  description: string;
  parameters: Record<string, any>;
  requiresApproval: boolean;
  affectedOntology?: string;
};

export type ParsedFoundryAgent = {
  name: string;
  model: string;
  instruction: string;
  steps: string[];
  tools: FoundryAction[];
  ontologyObjects: string[];
  archetype: Archetype;
  language: "typescript" | "python" | "json";
  rawSource: string;
  spec: AgentSpec;
};

export const FOUNDRY_TEMPLATES = [
  {
    id: "supply-chain-mitigation",
    title: "Supply Chain Disruption Mitigator",
    language: "typescript" as const,
    blurb: "Palantir Foundry AIP Agent with Ontology-backed Actions and approval-gated shipping rerouting.",
    code: `import { AipAgent, ActionType, Ontology } from "@foundry/aip-sdk";

// Palantir Foundry Action Type with Human-in-the-Loop Governance:
export const rerouteShipmentAction = new ActionType({
  name: "RerouteShipment",
  description: "Update logistical carrier route and delivery SLA in Foundry Ontology",
  requiresApproval: true,
  parameters: {
    shipmentId: { type: "string", description: "Foundry object primary key" },
    newHubCode: { type: "string", description: "Target regional distribution hub" },
    expeditedFreight: { type: "boolean", description: "Authorize priority freight charge" }
  }
});

export const queryDelayedShipments = new ActionType({
  name: "query_delayed_shipments",
  description: "Read-only query of Ontology Shipment objects with port delay flags",
  requiresApproval: false,
  parameters: {
    originPort: { type: "string" },
    minDelayHours: { type: "number" }
  }
});

export const supplyChainAgent = new AipAgent({
  name: "Foundry Supply Chain Disruption Mitigator",
  model: "gemini-2.5-flash",
  ontologyObjects: ["Shipment", "DistributionHub", "FreightCarrier"],
  instruction: \`You are an automated Palantir Foundry AIP logistics mitigation agent.
1. Scan the enterprise Ontology using query_delayed_shipments for port delays >= 24h.
2. Evaluate downstream stockout risk across regional distribution centers.
3. Call RerouteShipment ActionType to reassign logistical carriers and expedite freight.
4. Broadcast operational mitigation memorandum to the supply chain directorate.\`,
  actions: [queryDelayedShipments, rerouteShipmentAction]
});
`,
  },
  {
    id: "clinical-compliance",
    title: "Clinical Trial Protocol Compliance",
    language: "python" as const,
    blurb: "Python Palantir AIP agent auditing clinical trial participant cohorts and safety adverse events.",
    code: `from foundry.aip import AipAgent, ActionType, OntologyObject

@ActionType(name="flag_patient_protocol_deviation", requires_approval=True)
def flag_patient_protocol_deviation(patient_id: str, deviation_code: str, rationale: str) -> dict:
    """Escalate critical regulatory protocol deviation to Institutional Review Board (IRB)."""
    return {"status": "held_for_irb_review", "patient_id": patient_id}

@ActionType(name="query_trial_vital_metrics", requires_approval=False)
def query_trial_vital_metrics(cohort_id: str, max_systolic: float = 160.0) -> list:
    """Read-only query of patient vital telemetry stored in Foundry Clinical Ontology."""
    return [{"patient_id": "PT-9021", "deviation_detected": True, "systolic": 172.0}]

agent = AipAgent(
    name="Clinical Trial Compliance Sentinel",
    model="gemini-2.5-pro",
    ontology_objects=["TrialSubject", "AdverseEventRecord", "IRBReview"],
    instruction="""You are a Palantir Foundry clinical research compliance auditor.
    1. Query vital sign anomalies across Phase III cohort subjects with query_trial_vital_metrics.
    2. Check vital logs against FDA protocol thresholds.
    3. Execute flag_patient_protocol_deviation to trigger mandated safety review.
    4. Compile audit trail entry and alert principal investigator.""",
    actions=[query_trial_vital_metrics, flag_patient_protocol_deviation]
)
`,
  },
  {
    id: "fleet-maintenance",
    title: "Aviation Fleet Maintenance Dispatcher",
    language: "typescript" as const,
    blurb: "Foundry AIP Agent managing aircraft tail numbers, sensor anomalies, and maintenance work orders.",
    code: `import { AipAgent, ActionType } from "@foundry/aip-sdk";

export const scheduleAOGInspection = new ActionType({
  name: "ScheduleAOGInspection",
  description: "Create high-priority Aircraft On Ground (AOG) maintenance work order",
  requiresApproval: true,
  parameters: {
    tailNumber: { type: "string" },
    sensorFaultCode: { type: "string" },
    airportIata: { type: "string" }
  }
});

export const queryTelemetryTrends = new ActionType({
  name: "query_telemetry_trends",
  description: "Retrieve turbine vibration and temperature sensor time-series",
  requiresApproval: false,
  parameters: {
    tailNumber: { type: "string" }
  }
});

export const fleetAgent = new AipAgent({
  name: "Aviation Fleet Maintenance Sentinel",
  model: "gemini-2.5-flash",
  ontologyObjects: ["Aircraft", "TelemetryStream", "WorkOrder"],
  instruction: \`You are an aviation fleet reliability sentinel in Palantir Foundry.
1. Inspect engine telemetry trends using query_telemetry_trends for sensor anomalies.
2. Cross-reference flight schedule and airport turnaround windows.
3. Trigger ScheduleAOGInspection ActionType to dispatch certified avionics technicians.
4. Notify ground operations team with component diagnostics.\`,
  actions: [queryTelemetryTrends, scheduleAOGInspection]
});
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
    "Query enterprise Ontology objects according to operational filters.",
    "Evaluate governance thresholds and business constraints.",
    "Submit held ActionType mutations for supervisor approval.",
    "Record audit trail and broadcast operational memo."
  ];
}

function inferArchetype(name: string, instruction: string, tools: FoundryAction[]): Archetype {
  const text = `${name} ${instruction} ${tools.map((t) => t.name).join(" ")}`.toLowerCase();
  if (/sentinel|watch|alert|monitor|detect|guard|incident|aog|vital/i.test(text)) {
    return "sentinel";
  }
  if (/operator|reroute|shipment|action|order|dispatch|maintenance/i.test(text)) {
    return "operator";
  }
  if (/author|memo|brief|report/i.test(text)) {
    return "author";
  }
  return "analyst";
}

function parseFoundryCode(code: string): {
  name: string;
  model: string;
  instruction: string;
  tools: FoundryAction[];
  ontologyObjects: string[];
} {
  // Name
  let name = "Palantir Foundry AIP Agent";
  const nameMatch = code.match(/name\s*[:=]\s*["']([^"']+)["']/i);
  if (nameMatch) name = nameMatch[1].trim();

  // Model
  let model = "gemini-2.5-flash";
  const modelMatch = code.match(/model\s*[:=]\s*["']([^"']+)["']/i);
  if (modelMatch) model = modelMatch[1].trim();

  // Instruction
  let instruction = "";
  const backtick = code.match(/instruction\s*[:=]\s*`([\s\S]*?)`/);
  const tripleDouble = code.match(/instruction\s*[:=]\s*"""([\s\S]*?)"""/);
  const quote = code.match(/instruction\s*[:=]\s*["']([^"']+)["']/);

  if (backtick) instruction = backtick[1].trim();
  else if (tripleDouble) instruction = tripleDouble[1].trim();
  else if (quote) instruction = quote[1].trim();
  else instruction = "Execute Palantir Foundry AIP Ontology actions.";

  // Ontology Objects
  const ontologyObjects: string[] = [];
  const ontoMatch = code.match(/ontology(?:_objects|Objects)\s*[:=]\s*\[([^\]]*)\]/i);
  if (ontoMatch) {
    ontologyObjects.push(
      ...ontoMatch[1]
        .split(",")
        .map((s) => s.replace(/["']/g, "").trim())
        .filter(Boolean)
    );
  }

  // ActionTypes / Tools
  const tools: FoundryAction[] = [];
  const actionRegex = /(?:new\s+ActionType\s*\(\s*\{|@ActionType\s*\()([\s\S]*?)(?:\}\s*\)|\):)/g;
  let aMatch;

  while ((aMatch = actionRegex.exec(code)) !== null) {
    const block = aMatch[1];
    const n = block.match(/name\s*[:=]\s*["']([^"']+)["']/);
    const d = block.match(/description\s*[:=]\s*["']([^"']+)["']/);
    const requiresApproval = /requires(?:_approval|Approval)\s*[:=]\s*true/i.test(block);

    if (n) {
      tools.push({
        name: n[1],
        description: d ? d[1] : `Foundry Action ${n[1]}`,
        parameters: { type: "object", properties: {}, required: [] },
        requiresApproval,
      });
    }
  }

  // Fallback if no ActionType regex match
  if (!tools.length) {
    tools.push({
      name: "query_ontology_objects",
      description: "Read-only query of enterprise Foundry Ontology objects",
      parameters: {},
      requiresApproval: false,
    });
    tools.push({
      name: "execute_ontology_action",
      description: "Execute mutation action against target Ontology object",
      parameters: {},
      requiresApproval: true,
    });
  }

  return { name, model, instruction, tools, ontologyObjects };
}

function mapToStudioTools(tools: FoundryAction[]): { id: string; gate: "auto" | "approval" }[] {
  const result: { id: string; gate: "auto" | "approval" }[] = [];
  for (const t of tools) {
    const raw = t.name.toLowerCase();
    const gate = t.requiresApproval ? "approval" : "auto";
    if (/query|telemetry|metric|delayed/i.test(raw)) {
      result.push({ id: "sql_query", gate: "auto" });
    } else if (/reroute|schedule|order|dispatch|flag/i.test(raw)) {
      result.push({ id: "http_request", gate });
    } else {
      result.push({ id: "http_request", gate });
    }
  }
  if (!result.length) result.push({ id: "sql_query", gate: "auto" });
  const seen = new Set<string>();
  return result.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function parseFoundryAgent(rawSource: string, forcedLanguage?: "typescript" | "python" | "json"): ParsedFoundryAgent {
  let language: "typescript" | "python" | "json" = forcedLanguage || "typescript";
  const trimmed = rawSource.trim();

  if (!forcedLanguage) {
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      language = "json";
    } else if (/\b(def\s+|from\s+foundry|import\s+foundry|@ActionType)\b/.test(rawSource)) {
      language = "python";
    } else {
      language = "typescript";
    }
  }

  let parsed: {
    name: string;
    model: string;
    instruction: string;
    tools: FoundryAction[];
    ontologyObjects: string[];
    originalSpec?: AgentSpec;
  };

  try {
    if (language === "json") {
      const obj = JSON.parse(rawSource);
      const originalSpec: AgentSpec | undefined =
        obj.spec && typeof obj.spec === "object" && (obj.spec.tools || obj.spec.steps || obj.spec.brief)
          ? obj.spec
          : obj.tools && (obj.steps || obj.purpose || obj.brief || obj.archetype)
          ? obj
          : undefined;

      const rawTools = originalSpec?.tools || obj.actions || obj.tools || [];
      parsed = {
        name: originalSpec?.name || obj.name || "Foundry AIP Agent",
        model: obj.model || "gemini-2.5-flash",
        instruction:
          originalSpec?.brief ||
          (originalSpec as any)?.instructions ||
          originalSpec?.purpose ||
          obj.instruction ||
          "",
        tools: rawTools.map((a: any) => ({
          name: typeof a === "string" ? a : a.id || a.name || "custom_action",
          description: a.description || "",
          parameters: a.parameters || {},
          requiresApproval: Boolean(a.requiresApproval ?? a.requires_approval ?? (a.gate === "approval")),
        })),
        ontologyObjects: obj.ontologyObjects || obj.ontology_objects || [],
        originalSpec,
      };
    } else {
      parsed = parseFoundryCode(rawSource);
    }
  } catch (err: any) {
    throw new Error(`Failed to parse Palantir Foundry AIP code: ${err.message}`);
  }

  const orig = parsed.originalSpec;
  const steps = orig?.steps?.length ? orig.steps : extractSteps(parsed.instruction);
  const archetype = orig?.archetype || inferArchetype(parsed.name, parsed.instruction, parsed.tools);
  const studioTools = orig?.tools?.length ? orig.tools : mapToStudioTools(parsed.tools);

  const base = emptySpec();
  const spec: AgentSpec = {
    ...base,
    ...(orig || {}),
    name: parsed.name || orig?.name || "Foundry AIP Agent",
    archetype,
    domain: orig?.domain || (archetype === "sentinel" ? "Operational Integrity" : "Enterprise Logistics"),
    purpose: orig?.purpose || parsed.instruction.split("\n")[0] || "Execute Foundry Ontology actions.",
    brief: orig?.brief || parsed.instruction,
    steps,
    tools: studioTools,
    guardrails: {
      maxSteps: 12,
      requireCitations: true,
      escalateOnAmbiguity: true,
      stayInScope: true,
      extra: "Human-in-the-loop governance required for Palantir ActionTypes.",
      ...(orig?.guardrails || {}),
    },
    output: {
      format: "Palantir AIP Action Memo",
      instructions: "Document impacted Ontology objects and human approval gates.",
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
    ontologyObjects: parsed.ontologyObjects,
    archetype,
    language,
    rawSource,
    spec,
  };
}
