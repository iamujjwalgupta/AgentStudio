import { one, q } from "./db";
import { parseSchedule, nextRun, describeSchedule, unattendedNotes, type Schedule } from "./schedule";
import type { AgentSpec } from "./types";

/**
 * Keeps an agent's scheduling state in step with its spec.
 *
 * Only a published agent is ever due: a draft has not been reviewed, and the
 * spec that runs is the published one. Unpublishing or retiring an agent
 * therefore clears its next firing rather than leaving it armed.
 */
export async function syncAgentSchedule(agentId: string): Promise<{
  schedule: Schedule | null;
  caveat: string;
  next: Date | null;
  description: string;
}> {
  const agent = await one<any>(
    `select a.id, a.status, a.published_ver, a.draft_spec, o.timezone
       from agents a join orgs o on o.id = a.org_id where a.id = $1`,
    [agentId],
  );
  const clear = { schedule: null, caveat: "", next: null, description: "" };
  if (!agent) return clear;

  // The published version is what a scheduled run would execute.
  let spec: AgentSpec = agent.draft_spec;
  if (agent.status === "published" && agent.published_ver) {
    const v = await one<any>(`select spec from agent_versions where agent_id = $1 and version = $2`, [
      agentId,
      agent.published_ver,
    ]);
    if (v) spec = v.spec;
  }

  const armed = agent.status === "published" && spec?.trigger?.type === "schedule";
  if (!armed) {
    await q(`update agents set schedule = null, schedule_caveat = '', next_run_at = null where id = $1`, [agentId]);
    return clear;
  }

  const tz = agent.timezone || "UTC";
  const { schedule, caveat } = parseSchedule(spec.trigger.schedule || "");
  if (!schedule) {
    await q(
      `update agents set schedule = null, next_run_at = null,
              schedule_caveat = 'This schedule could not be understood, so the agent will not run on its own.'
        where id = $1`,
      [agentId],
    );
    return { ...clear, caveat: "This schedule could not be understood, so the agent will not run on its own." };
  }

  const notes = [caveat, ...unattendedNotes(spec)];

  const next = nextRun(schedule, tz);
  await q(`update agents set schedule = $2, schedule_caveat = $3, next_run_at = $4 where id = $1`, [
    agentId,
    JSON.stringify(schedule),
    notes.filter(Boolean).join("; "),
    next,
  ]);
  return {
    schedule,
    caveat: notes.filter(Boolean).join("; "),
    next,
    description: describeSchedule(schedule, tz),
  };
}
