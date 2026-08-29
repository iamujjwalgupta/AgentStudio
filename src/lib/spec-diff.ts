/**
 * What changed between two versions of a spec.
 *
 * The spec is the source of truth and every run is stamped with the version it
 * ran on, so a reviewer approving a publish is approving a specific change. The
 * change that matters is rarely the wording of a step — it is a gate dropped
 * from approval to automatic, a tool newly granted, a guardrail switched off, or
 * an agent that has quietly become unattended. Those are classified as
 * weakening, so they can be shown first rather than buried in prose edits.
 */
import type { AgentSpec } from "./types";

export type Severity = "weakens" | "strengthens" | "neutral";
export type ChangeKind = "added" | "removed" | "changed";

export type Change = {
  section: string;
  label: string;
  before?: string;
  after?: string;
  kind: ChangeKind;
  severity: Severity;
};

export type DiffSummary = {
  changes: Change[];
  weakens: number;
  strengthens: number;
  neutral: number;
  identical: boolean;
};

const yn = (b: boolean) => (b ? "on" : "off");

/** Longest common subsequence, so an inserted step does not report every later one as changed. */
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): number[][] {
  const m = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      m[i][j] = eq(a[i], b[j]) ? m[i + 1][j + 1] + 1 : Math.max(m[i + 1][j], m[i][j + 1]);
    }
  }
  return m;
}

function diffList(before: string[], after: string[], section: string, noun: string): Change[] {
  const eq = (x: string, y: string) => x.trim() === y.trim();
  const m = lcs(before, after, eq);
  const out: Change[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (eq(before[i], after[j])) {
      i++;
      j++;
    } else if (m[i + 1][j] >= m[i][j + 1]) {
      out.push({ section, label: `${noun} ${i + 1} removed`, before: before[i], kind: "removed", severity: "neutral" });
      i++;
    } else {
      out.push({ section, label: `${noun} ${j + 1} added`, after: after[j], kind: "added", severity: "neutral" });
      j++;
    }
  }
  while (i < before.length) {
    out.push({ section, label: `${noun} ${i + 1} removed`, before: before[i], kind: "removed", severity: "neutral" });
    i++;
  }
  while (j < after.length) {
    out.push({ section, label: `${noun} ${j + 1} added`, after: after[j], kind: "added", severity: "neutral" });
    j++;
  }
  return out;
}

/**
 * @param riskOf  Risk of a tool by id. A newly granted medium or high risk tool
 *                weakens control more than a low risk one.
 */
export function diffSpecs(
  a: AgentSpec,
  b: AgentSpec,
  riskOf: (toolId: string) => string = () => "low",
): DiffSummary {
  const c: Change[] = [];

  /* ── identity ── */
  const field = (label: string, before: string, after: string, section = "Identity") => {
    if ((before || "") !== (after || "")) {
      c.push({ section, label, before: before || "—", after: after || "—", kind: "changed", severity: "neutral" });
    }
  };
  field("Name", a.name, b.name);
  field("Purpose", a.purpose, b.purpose);
  field("Type", a.archetype, b.archetype);
  field("Domain", a.domain, b.domain);

  /* ── instructions ── */
  c.push(...diffList(a.steps || [], b.steps || [], "Instructions", "Step"));

  /* ── tools and gates: the part a reviewer is really approving ── */
  const aT = new Map((a.tools || []).map((t) => [t.id, t.gate]));
  const bT = new Map((b.tools || []).map((t) => [t.id, t.gate]));
  for (const [id, gate] of bT) {
    if (!aT.has(id)) {
      const risk = riskOf(id);
      c.push({
        section: "Actions",
        label: `${id} granted${risk !== "low" ? ` (${risk} risk)` : ""}`,
        after: gate === "approval" ? "needs approval" : "runs automatically",
        kind: "added",
        severity: "weakens",
      });
    } else if (aT.get(id) !== gate) {
      const toAuto = gate === "auto";
      c.push({
        section: "Actions",
        label: `${id} gate changed`,
        before: aT.get(id) === "approval" ? "needs approval" : "runs automatically",
        after: toAuto ? "runs automatically" : "needs approval",
        kind: "changed",
        // Dropping a gate is the single most consequential edit possible here.
        severity: toAuto ? "weakens" : "strengthens",
      });
    }
  }
  for (const [id] of aT) {
    if (!bT.has(id)) {
      c.push({ section: "Actions", label: `${id} removed`, before: "granted", kind: "removed", severity: "strengthens" });
    }
  }

  /* ── sources ── */
  const aS = new Set((a.sources || []).map((s) => s.connectionId));
  const bS = new Set((b.sources || []).map((s) => s.connectionId));
  for (const id of bS) if (!aS.has(id)) c.push({ section: "Data", label: "Source granted", after: id, kind: "added", severity: "weakens" });
  for (const id of aS) if (!bS.has(id)) c.push({ section: "Data", label: "Source removed", before: id, kind: "removed", severity: "strengthens" });

  /* ── trigger: becoming unattended matters ── */
  if (a.trigger?.type !== b.trigger?.type) {
    c.push({
      section: "Trigger",
      label: "How it starts",
      before: a.trigger?.type || "manual",
      after: b.trigger?.type || "manual",
      kind: "changed",
      severity: b.trigger?.type === "manual" ? "strengthens" : "weakens",
    });
  } else {
    field("Schedule", a.trigger?.schedule || "", b.trigger?.schedule || "", "Trigger");
    field("Condition", a.trigger?.condition || "", b.trigger?.condition || "", "Trigger");
    field("Standing input", a.trigger?.input || "", b.trigger?.input || "", "Trigger");
  }

  /* ── inputs and deliverable ── */
  c.push(...diffList((a.inputs || []).map((i) => i.label), (b.inputs || []).map((i) => i.label), "Inputs", "Input"));
  field("Format", a.output?.format || "", b.output?.format || "", "Deliverable");
  field("Instructions", a.output?.instructions || "", b.output?.instructions || "", "Deliverable");

  /* ── guardrails ── */
  const g1 = a.guardrails, g2 = b.guardrails;
  const flag = (label: string, before: boolean, after: boolean) => {
    if (before !== after) {
      c.push({
        section: "Guardrails",
        label,
        before: yn(before),
        after: yn(after),
        kind: "changed",
        severity: after ? "strengthens" : "weakens",
      });
    }
  };
  flag("Cite every figure", !!g1?.requireCitations, !!g2?.requireCitations);
  flag("Stay in scope", !!g1?.stayInScope, !!g2?.stayInScope);
  flag("Escalate when ambiguous", !!g1?.escalateOnAmbiguity, !!g2?.escalateOnAmbiguity);
  if ((g1?.maxSteps ?? 0) !== (g2?.maxSteps ?? 0)) {
    c.push({
      section: "Guardrails",
      label: "Tool call budget",
      before: String(g1?.maxSteps ?? "—"),
      after: String(g2?.maxSteps ?? "—"),
      kind: "changed",
      severity: (g2?.maxSteps ?? 0) > (g1?.maxSteps ?? 0) ? "weakens" : "strengthens",
    });
  }
  field("Extra rule", g1?.extra || "", g2?.extra || "", "Guardrails");

  // Weakening first: it is what a reviewer must not miss.
  const rank = { weakens: 0, strengthens: 1, neutral: 2 };
  c.sort((x, y) => rank[x.severity] - rank[y.severity]);

  return {
    changes: c,
    weakens: c.filter((x) => x.severity === "weakens").length,
    strengthens: c.filter((x) => x.severity === "strengthens").length,
    neutral: c.filter((x) => x.severity === "neutral").length,
    identical: c.length === 0,
  };
}
