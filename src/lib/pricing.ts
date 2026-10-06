/**
 * What a run costs.
 *
 * Rates are US dollars per million tokens, first-party Anthropic API pricing.
 * Cached input is billed differently from fresh input: writing to the cache
 * costs about 1.25x the input rate, reading from it about 0.1x — so a run that
 * leans on the cache is far cheaper than its raw token count suggests, and
 * ignoring the distinction overstates spend.
 *
 * Cost is computed when a run finishes and stored on the run, so a later change
 * to these rates never rewrites history.
 */

export type Rate = { input: number; output: number };

/** Per million tokens. Source: Anthropic API pricing, cached 2026-06-24. */
export const RATES: Record<string, Rate> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  // Google Gemini, per million tokens (standard tier, prompts under 200k tokens).
  // An estimate for the dashboard; Google's invoice is the record.
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
};

/** Used when the configured model is not in the table, so spend is never silently zero. */
export const FALLBACK_MODEL = "claude-sonnet-4-6";

const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export function rateFor(model: string): { rate: Rate; known: boolean } {
  const rate = RATES[model];
  if (rate) return { rate, known: true };
  // An unlisted Gemini model is priced like Flash rather than like Claude.
  return { rate: RATES[model.startsWith("gemini") ? "gemini-2.5-flash" : FALLBACK_MODEL], known: false };
}

export type Usage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

/** Cost in US dollars. */
export function costOf(u: Usage): number {
  const { rate } = rateFor(u.model);
  const perToken = (dollarsPerMillion: number) => dollarsPerMillion / 1_000_000;
  return (
    u.inputTokens * perToken(rate.input) +
    u.outputTokens * perToken(rate.output) +
    (u.cacheWriteTokens ?? 0) * perToken(rate.input) * CACHE_WRITE_MULTIPLIER +
    (u.cacheReadTokens ?? 0) * perToken(rate.input) * CACHE_READ_MULTIPLIER
  );
}

/** "$0.0431" / "$12.40" — small amounts still need to be legible. */
export function formatUsd(n: number): string {
  const v = Number(n) || 0;
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}
