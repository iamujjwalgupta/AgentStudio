import { one } from "./db";
import type { SessionUser } from "./auth";
import { startRun } from "./orchestrator";
import { budgetCheck } from "./spend";
import { composeRunInput, missingRequired } from "./run-input";
import type { AgentSpec } from "./types";

export type StartResult = { runId: string; spec: AgentSpec } | { error: string; status: number; missing?: string[] };

/**
 * Starts a run of an agent for a signed-in person: the published version (or
 * the draft when asked), its required inputs checked, usage limits checked.
 * The run form and the chat both start runs through here, so they follow the
 * same rules.
 */
export async function startAgentRun(
  u: SessionUser,
  o: {
    agentId: string;
    /** Free text for the run, after the input values. */
    input?: string;
    useDraft?: boolean;
    dryRun?: boolean;
    values?: Record<string, string>;
    chatId?: string;
    /** The person's own words, kept beside the run (chat). */
    message?: string;
    /** A later turn of a conversation. */
    followUp?: boolean;
  },
): Promise<StartResult> {
  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [o.agentId, u.orgId]);
  if (!agent) return { error: "Agent not found", status: 404 };
  if (agent.status === "retired") return { error: "That agent is retired. Restore it before running it again.", status: 409 };

  let spec: AgentSpec = agent.draft_spec;
  let version: number | null = null;
  if (!o.useDraft && agent.published_ver) {
    const v = await one<any>(`select spec, version from agent_versions where agent_id = $1 and version = $2`, [o.agentId, agent.published_ver]);
    if (v) {
      spec = v.spec;
      version = v.version;
    }
  }
  if (!spec?.steps?.length) return { error: "Add instructions before running this agent.", status: 400 };

  const supplied: Record<string, string> = o.values && typeof o.values === "object" ? o.values : {};
  const missing = missingRequired(spec, supplied);
  if (missing.length) return { error: `Fill in ${missing.join(", ")} before running this agent.`, status: 400, missing };

  const budget = await budgetCheck(u.orgId, o.agentId);
  if (!budget.ok) return { error: budget.reason || "A usage limit stops this run.", status: 402 };

  const runId = await startRun({
    orgId: u.orgId,
    agentId: o.agentId,
    spec,
    version,
    input: composeRunInput(spec, supplied, o.input || ""),
    user: { id: u.id, name: u.name },
    dryRun: Boolean(o.dryRun),
    inputs: supplied,
    waitForCompletion: false,
    chatId: o.chatId,
    message: o.message,
    followUp: o.followUp,
  });
  return { runId, spec };
}
