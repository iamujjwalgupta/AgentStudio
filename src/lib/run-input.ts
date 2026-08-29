import { normaliseInputs, type AgentSpec } from "./types";

/**
 * Turns the values a person filled in on the run form into the opening message.
 *
 * Values are per-run, so they belong in the first message rather than the system
 * prompt — which stays a pure function of the spec, as the versioning depends on.
 * A file is named rather than inlined, because the agent has a tool for reading
 * documents and the file may be far larger than the context window.
 */
export function composeRunInput(
  spec: AgentSpec,
  values: Record<string, string>,
  freeText = "",
): string {
  const inputs = normaliseInputs(spec.inputs as any[]);
  const lines: string[] = [];

  for (const i of inputs) {
    const v = (values?.[i.key] ?? "").toString().trim();
    if (!v) continue;
    lines.push(
      i.type === "file"
        ? `${i.label}: the uploaded document named "${v}" — read it with the document tool.`
        : `${i.label}: ${v}`,
    );
  }

  const missing = inputs.filter((i) => i.required && !(values?.[i.key] ?? "").toString().trim());
  const parts: string[] = [];
  if (lines.length) parts.push(`Here is what you have been given:\n${lines.join("\n")}`);
  if (missing.length) parts.push(`Not supplied: ${missing.map((m) => m.label).join(", ")}.`);
  if (freeText.trim()) parts.push(freeText.trim());
  return parts.join("\n\n") || "Begin.";
}

/** Which required inputs have no value. */
export function missingRequired(spec: AgentSpec, values: Record<string, string>): string[] {
  return normaliseInputs(spec.inputs as any[])
    .filter((i) => i.required && !(values?.[i.key] ?? "").toString().trim())
    .map((i) => i.label);
}
