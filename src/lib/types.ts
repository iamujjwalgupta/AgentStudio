export type Archetype = "analyst" | "author" | "operator" | "sentinel";
export type Gate = "auto" | "approval";
export type Risk = "low" | "medium" | "high";

export type SpecSource = {
  connectionId: string;
  label?: string;
  scope?: string;
};

/** What kind of control the run form shows for an input. */
export type InputType = "text" | "longtext" | "number" | "date" | "choice" | "file";

export type SpecInput = {
  /** Stable identifier used in the run record; derived from the label when absent. */
  key: string;
  label: string;
  hint: string;
  type: InputType;
  required: boolean;
  /** For type "choice". */
  options?: string[];
  /** For type "file": the kinds of file accepted, by FILE_KINDS id. Empty or absent means any readable file. */
  accept?: string[];
};

/**
 * The files an agent can actually read: what the document reader parses
 * (lib/tools.ts). Excel is read as .xlsx only; an old .xls has to be saved as
 * .xlsx or CSV first.
 */
export const FILE_KINDS: { id: string; label: string; exts: string[] }[] = [
  { id: "csv", label: "CSV", exts: [".csv", ".tsv"] },
  { id: "excel", label: "Excel", exts: [".xlsx"] },
  { id: "pdf", label: "PDF", exts: [".pdf"] },
  { id: "word", label: "Word", exts: [".docx"] },
  { id: "text", label: "Text", exts: [".txt", ".md", ".json"] },
];

/** The extensions a file input takes, for an <input accept>. Empty when any readable file will do. */
export function acceptedExtensions(input: Pick<SpecInput, "accept">): string[] {
  const ids = input.accept ?? [];
  return FILE_KINDS.filter((k) => ids.includes(k.id)).flatMap((k) => k.exts);
}

/** Whether a chosen file fits the input. With no restriction, anything goes. */
export function fileAccepted(input: Pick<SpecInput, "accept">, fileName: string): boolean {
  const exts = acceptedExtensions(input);
  if (!exts.length) return true;
  const lower = fileName.toLowerCase();
  return exts.some((e) => lower.endsWith(e));
}

export const INPUT_TYPES: { id: InputType; label: string; blurb: string }[] = [
  { id: "text", label: "Text", blurb: "A short answer" },
  { id: "longtext", label: "Long text", blurb: "A paragraph or more" },
  { id: "number", label: "Number", blurb: "A figure, rate or threshold" },
  { id: "date", label: "Date", blurb: "A single date" },
  { id: "choice", label: "Choice", blurb: "One of a fixed set" },
  { id: "file", label: "File", blurb: "A document the agent reads" },
];

/** Turns a label into a stable key. */
export function inputKey(label: string, index: number): string {
  const slug = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || `input_${index + 1}`;
}

/**
 * Specs written before inputs were typed carry only a label and a hint.
 * Normalising on read means old agents keep working and gain sensible types.
 */
export function normaliseInputs(raw: any[]): SpecInput[] {
  return (raw || []).map((i: any, idx: number) => {
    const label = i?.label ?? "";
    const hint = i?.hint ?? "";
  const text = `${label} ${hint}`.toLowerCase();

  // Anything the agent has to read is a file. This vocabulary decides whether an
  // existing agent is usable at all, so it errs towards offering an upload.
  const DOCUMENT =
    /listing|ledger|statement|invoice|claim|schedule|register|report|contract|agreement|pack|policy|export|upload|document|file|spreadsheet|workbook|csv|balances|trial balance|results|data|record|log|plan|forecast|budget sheet|matrix|batch|breakdown|transactions|entries|payables|receivables|payroll|filing|return/;
  const NUMBER = /\b(rate|threshold|limit|window|days|percent|percentage|amount|size|count|tolerance|multiple|margin|number of)\b/;
  const DATE = /\bdate\b|cut-?off\b/;

  const guessed: InputType = DOCUMENT.test(text)
    ? "file"
    : DATE.test(text)
      ? "date"
      : NUMBER.test(text)
        ? "number"
        : "text";
    return {
      key: i?.key || inputKey(label, idx),
      label,
      hint,
      type: (i?.type as InputType) || guessed,
      required: i?.required ?? false,
      ...(Array.isArray(i?.options) ? { options: i.options } : {}),
      ...(Array.isArray(i?.accept) && i.accept.length ? { accept: i.accept } : {}),
    };
  });
}

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
  /**
   * The model the agent runs on: Claude through Anthropic, or Gemini through
   * Google. Unset means Claude, which is what every agent ran on before the
   * choice existed. The workspace needs a key for whichever it is.
   */
  engine?: "anthropic" | "gemini";
  /**
   * A model for this agent only, e.g. "gemini-2.5-pro" for a heavy agent while
   * the workspace default stays cheaper. Unset uses the model on the engine's
   * key in Connections.
   */
  model?: string;
  /**
   * Skills granted to this agent, by id. Instructions rather than capability:
   * the runtime lists their names and one-line descriptions in the system
   * prompt and the agent reads a body with load_skill when it wants one.
   * Workspace-specific, like sources — an id means nothing in another workspace.
   */
  skills: string[];
  inputs: SpecInput[];
  output: { format: string; instructions: string };
  trigger: {
    type: "manual" | "schedule" | "event";
    schedule?: string;
    condition?: string;
    /** Standing input for unattended runs. A scheduled run has nobody to type one. */
    input?: string;
    /** Standing values per declared input, keyed by input key. */
    inputs?: Record<string, string>;
  };
  guardrails: {
    maxSteps: number;
    requireCitations: boolean;
    escalateOnAmbiguity: boolean;
    stayInScope: boolean;
    extra: string;
    dlpEnabled?: boolean;
    redactCreditCards?: boolean;
    redactEmails?: boolean;
    redactCredentials?: boolean;
    redactPhoneNumbers?: boolean;
    customDlpPatterns?: { name: string; pattern: string; replacement: string }[];
    rateLimitRpm?: number;
    rateLimitTpm?: number;
  };
  swarm?: {
    enabled: boolean;
    strategy: "router" | "parallel" | "sequential";
    supervisorRole?: string;
    workers: SwarmWorker[];
  };
};

export interface SwarmWorker {
  id?: string;
  agentId?: string;
  name: string;
  role: string;
  type?: "internal" | "external";
  endpointUrl?: string;
  apiKey?: string;
  protocol?: "a2a" | "http";
  taskPrompt?: string;
}

/** Skill ids off a spec, tolerating specs written before skills existed. */
export function specSkillIds(spec: Partial<AgentSpec> | null | undefined): string[] {
  const raw = (spec as any)?.skills;
  return Array.isArray(raw) ? raw.filter((s: any) => typeof s === "string" && s) : [];
}

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
    skills: [],
    inputs: [],
    output: { format: "Markdown summary", instructions: "" },
    trigger: { type: "manual" },
    guardrails: {
      maxSteps: 12,
      requireCitations: true,
      escalateOnAmbiguity: true,
      stayInScope: true,
      extra: "",
      dlpEnabled: false,
      redactCreditCards: true,
      redactEmails: true,
      redactCredentials: true,
      redactPhoneNumbers: true,
      rateLimitRpm: 60,
    },
    swarm: {
      enabled: false,
      strategy: "router",
      supervisorRole: "Triage & Delegate",
      workers: [],
    },
  };
}

