import { one, q } from "./db";
import { maskPII } from "./guardrails";
import { toolById } from "./tools";

/**
 * A run as another application sees it: where it has got to, its answer once
 * there is one, and what it is waiting for when an action is held for a person.
 * The same shape from invoke and from GET /api/v1/runs/{id}.
 */

/** The address callers reached us on, as they see it (behind a proxy too), for the links we hand back. */
export function originOf(req: Request) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

/** Still going: the caller should ask again (or wait). */
export const unfinished = (status: string) => status === "running" || status === "awaiting_approval";

export async function runResult(runId: string, origin: string) {
  const run = await one<any>(
    `select r.*, a.name as agent_name from runs r join agents a on a.id = r.agent_id where r.id = $1`,
    [runId],
  );
  if (!run) return null;
  const spec = run.spec ?? {};

  const steps = await q<any>(`select tool from run_steps where run_id = $1 order by idx asc`, [runId]);
  const held = run.status === "awaiting_approval"
    ? await q<any>(`select tool, created_at from approvals where run_id = $1 and status = 'pending' order by created_at`, [runId])
    : [];

  let output: string | null = run.output ?? null;
  if (output && spec.guardrails?.dlpEnabled) output = maskPII(output, spec.guardrails).text;

  return {
    runId: run.id,
    agentId: run.agent_id,
    agentName: run.agent_name,
    version: run.version,
    status: run.status as string,
    // In words, for a log line or a person reading the response.
    message:
      run.status === "running"
        ? "The agent is still working. Ask the statusUrl again in a few seconds."
        : run.status === "awaiting_approval"
          ? "The agent is waiting for a person to approve an action in Agent Studio. Ask the statusUrl again later."
          : run.status === "completed"
            ? "Finished."
            : run.status === "rejected"
              ? "Stopped: a person rejected an action the agent wanted to take."
              : "The run failed.",
    output,
    error: run.error ?? null,
    waitingFor: held.map((h) => ({ action: toolById(h.tool)?.label ?? h.tool, since: h.created_at })),
    dryRun: Boolean(run.dry_run),
    stepsCount: steps.length,
    toolsCalled: steps.filter((s) => s.tool).map((s) => s.tool),
    usage: {
      model: run.model || null,
      inputTokens: run.input_tokens || 0,
      outputTokens: run.output_tokens || 0,
      costUsd: Number(run.cost_usd || 0),
    },
    startedAt: run.started_at,
    endedAt: run.ended_at,
    statusUrl: `${origin}/api/v1/runs/${run.id}`,
    // The same run in Agent Studio, for a person to open.
    runUrl: `${origin}/runs/${run.id}`,
  };
}

/** Polls until the run finishes or stops for approval, or the time is up. */
export async function waitForRun(runId: string, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const r = await one<any>(`select status from runs where id = $1`, [runId]);
    if (!r || r.status !== "running") return;
    await new Promise((res) => setTimeout(res, 1000));
  }
}
