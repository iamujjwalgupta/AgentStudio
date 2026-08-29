export type Archetype = "analyst" | "author" | "operator" | "sentinel";
export type Gate = "auto" | "approval";
export type Risk = "low" | "medium" | "high";

export type SpecSource = {
  connectionId: string;
  label?: string;
  scope?: string;
};

export type SpecTool = {
  id: string;
  gate: Gate;
};

export type AgentSpec = {
  name: string;
  archetype: Archetype;
  purpose: string;
  brief: string;
  domain: string;
  sources: SpecSource[];
  steps: string[];
  tools: SpecTool[];
  inputs: { label: string; hint: string }[];
  output: { format: string; instructions: string };
  trigger: { type: "manual" | "schedule" | "event"; schedule?: string; condition?: string };
  guardrails: {
    maxSteps: number;
    requireCitations: boolean;
    escalateOnAmbiguity: boolean;
    stayInScope: boolean;
    extra: string;
  };
};

export const ARCHETYPES: { id: Archetype; label: string; blurb: string }[] = [
  { id: "analyst", label: "Analyst", blurb: "Investigates and answers questions from your data" },
  { id: "author", label: "Author", blurb: "Produces a document, report or message" },
  { id: "operator", label: "Operator", blurb: "Carries out a process across systems" },
  { id: "sentinel", label: "Sentinel", blurb: "Watches for a condition and raises it" },
];

export function emptySpec(): AgentSpec {
  return {
    name: "",
    archetype: "analyst",
    purpose: "",
    brief: "",
    domain: "",
    sources: [],
    steps: [],
    tools: [],
    inputs: [],
    output: { format: "Markdown summary", instructions: "" },
    trigger: { type: "manual" },
    guardrails: {
      maxSteps: 12,
      requireCitations: true,
      escalateOnAmbiguity: true,
      stayInScope: true,
      extra: "",
    },
  };
}
