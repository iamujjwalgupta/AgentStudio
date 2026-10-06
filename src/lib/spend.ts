import { checkLimits } from "./metering";

/**
 * Whether a run may start: the Anthropic key's limits and the agent's own, from
 * Usage & limits. The orchestrator checks again before every model call, so a
 * run that starts under a limit still stops at it.
 */
export async function budgetCheck(orgId: string, agentId?: string | null): Promise<{ ok: boolean; reason?: string }> {
  const r = await checkLimits(orgId, "anthropic", agentId);
  return r.ok ? { ok: true } : { ok: false, reason: r.reason };
}
