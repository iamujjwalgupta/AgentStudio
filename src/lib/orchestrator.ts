import path from "path";
import { q, one } from "./db";
import { anthropicFor, buildSystemPrompt, audit } from "./ai";
import { costOf } from "./pricing";
import { spendThisMonth, capFor, OVER_CAP } from "./spend";
import { notify, approverEmails } from "./notify";
import { TOOLS, toolById, anthropicTools, type ConnRow, type ToolContext } from "./tools";
import { skillsFor } from "./skills";
import { specSkillIds, type AgentSpec } from "./types";
import { maskPII, checkRateLimit } from "./guardrails";

const STORAGE = process.env.STORAGE_DIR || path.join(process.cwd(), "storage");


type RunRow = {
  id: string;
  org_id: string;
  agent_id: string;
  spec: AgentSpec;
  status: string;
  state: { messages: any[]; partial: any[]; steps: number };
  started_by: string;
};

async function loadContext(
  orgId: string,
  userId: string,
  spec: AgentSpec,
  model: { apiKey: string; model: string },
  runId?: string,
  agentId?: string,
): Promise<ToolContext> {
  const ids = (spec.sources || []).map((s) => s.connectionId);
  const rows = ids.length
    ? await q<ConnRow>(`select id, name, kind, config, secret_enc from connections where org_id = $1 and id = any($2::uuid[])`, [orgId, ids])
    : [];
  const connections: Record<string, ConnRow> = {};
  for (const r of rows) connections[r.id] = r;
  // Resolved at run time rather than snapshotted into the spec, so an edit to a
  // skill reaches every agent that holds it without republishing each one.
  const skills = await skillsFor(orgId, specSkillIds(spec));
  return {
    orgId,
    userId,
    connections,
    skills,
    storageDir: STORAGE,
    apiKey: model.apiKey,
    model: model.model,
    runId,
    agentId,
  };
}

async function addStep(runId: string, idx: number, s: Partial<any>) {
  await q(
    `insert into run_steps (run_id, idx, kind, tool, title, input, output, status, duration_ms)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      runId,
      idx,
      s.kind,
      s.tool ?? null,
      s.title ?? "",
      s.input ? JSON.stringify(s.input) : null,
      s.output ? JSON.stringify(s.output) : null,
      s.status ?? "ok",
      s.duration_ms ?? 0,
    ],
  );
}

async function nextIdx(runId: string) {
  const r = await one<any>(`select coalesce(max(idx), -1) + 1 as n from run_steps where run_id = $1`, [runId]);
  return Number(r?.n ?? 0);
}

function applyDLP(content: string, spec: AgentSpec): string {
  if (!spec.guardrails?.dlpEnabled || !content) return content;
  return maskPII(content, {
    enabled: true,
    redactCreditCards: spec.guardrails.redactCreditCards,
    redactEmails: spec.guardrails.redactEmails,
    redactCredentials: spec.guardrails.redactCredentials,
    redactPhoneNumbers: spec.guardrails.redactPhoneNumbers,
    customPatterns: spec.guardrails.customDlpPatterns,
  }).text;
}

function safeTrimToolOutput(out: any, maxChars = 20000): string {
  if (out === null || out === undefined) return "null";
  if (typeof out === "string") {
    if (out.length <= maxChars) return out;
    return out.slice(0, maxChars) + `\n...[truncated, ${out.length} chars total]`;
  }
  if (Array.isArray(out)) {
    if (out.length > 50) {
      const sample = out.slice(0, 50);
      return JSON.stringify(
        {
          items: sample,
          _meta: `Truncated array: showing first 50 of ${out.length} items`,
        },
        null,
        2
      );
    }
  }
  const serialized = JSON.stringify(out, null, 2);
  if (serialized.length <= maxChars) return serialized;
  return JSON.stringify({
    preview: JSON.stringify(out).slice(0, maxChars),
    _meta: `Truncated large object output (${serialized.length} chars total)`,
  });
}

export async function startRun(opts: {
  orgId: string;
  agentId: string;
  spec: AgentSpec;
  version: number | null;
  input: string;
  user: { id: string; name: string };
  trigger?: string;
  dryRun?: boolean;
  inputs?: Record<string, string>;
  parentRunId?: string;
  waitForCompletion?: boolean;
}) {
  // 1. Enforce per-agent rate limit
  if (opts.spec.guardrails?.rateLimitRpm) {
    const rateCheck = checkRateLimit(
      opts.agentId,
      opts.spec.guardrails.rateLimitRpm,
      opts.spec.guardrails.rateLimitTpm
    );
    if (!rateCheck.allowed) {
      throw new Error(
        `Rate limit exceeded for agent (${opts.spec.guardrails.rateLimitRpm} RPM). Please retry in ${rateCheck.retryAfterSeconds}s.`
      );
    }
  }

  // 2. Enforce DLP masking if enabled
  let effectiveInput = opts.input;
  if (opts.spec.guardrails?.dlpEnabled) {
    const dlpResult = maskPII(opts.input, {
      enabled: true,
      redactCreditCards: opts.spec.guardrails.redactCreditCards,
      redactEmails: opts.spec.guardrails.redactEmails,
      redactCredentials: opts.spec.guardrails.redactCredentials,
      redactPhoneNumbers: opts.spec.guardrails.redactPhoneNumbers,
      customPatterns: opts.spec.guardrails.customDlpPatterns,
    });
    effectiveInput = dlpResult.text;
  }

  const run = await one<any>(
    `insert into runs (org_id, agent_id, version, spec, trigger, input, state, started_by, dry_run, inputs, parent_run_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [
      opts.orgId,
      opts.agentId,
      opts.version,
      JSON.stringify(opts.spec),
      opts.dryRun ? "rehearsal" : opts.trigger || "manual",
      effectiveInput,
      JSON.stringify({ messages: [{ role: "user", content: effectiveInput || "Begin." }], partial: [], steps: 0 }),
      opts.user.id,
      Boolean(opts.dryRun),
      JSON.stringify(opts.inputs || {}),
      opts.parentRunId ?? null,
    ],
  );
  await audit(opts.orgId, opts.user, "Started run", "run", run.id, {
    agentId: opts.agentId,
    input: effectiveInput,
    ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
  });

  if (opts.waitForCompletion) {
    await advance(run.id, opts.user);
  } else {
    // Non-blocking asynchronous dispatch for HTTP route callers
    setImmediate(() => {
      advance(run.id, opts.user).catch((err) => {
        console.error(`[Async advance error] Run ${run.id}:`, err);
      });
    });
  }

  return run.id as string;
}


/** How long a worker may hold a run before another may take it over. */
const LEASE = "5 minutes";

/**
 * Drives the plan–act–observe loop until the run completes or hits an approval gate.
 *
 * Entry is guarded by an atomic claim: the same run cannot be stepped by two
 * workers at once, which would re-execute its tool calls — sending the same
 * email twice. The claim is a lease, so a worker that dies mid-run releases it
 * by expiry rather than wedging the run forever.
 *
 * @param heldLease  set by resumeAfterApprovals, which has already claimed the run.
 */
export async function advance(
  runId: string,
  user: { id: string; name: string },
  heldLease = false,
) {
  const run = heldLease
    ? await one<RunRow>(`select * from runs where id = $1`, [runId])
    : await one<RunRow>(
        `update runs set locked_at = now()
          where id = $1 and status = 'running'
            and (locked_at is null or locked_at < now() - interval '${LEASE}')
          returning *`,
        [runId],
      );
  // No row means another worker holds it, or it is no longer running. Either
  // way this caller has nothing to do.
  if (!run) return;
  if (run.status !== "running") return;

  const spec = run.spec;

  // Multi-Agent Swarm Orchestration execution
  if (spec.swarm?.enabled && spec.swarm.workers && spec.swarm.workers.length > 0) {
    const { executeSwarmRun } = await import("./swarm-orchestrator");
    await executeSwarmRun({
      runId,
      run: run as any,
      user,
    });
    return;
  }

  // Setup can fail too — no model key, an unreachable database. It must fail the
  // run rather than throw past it, or the run is stranded on 'running' forever.
  let client, model: string, ctx;
  const connectionNames: Record<string, string> = {};
  try {
    // Resolved once per advance, so a key changed mid-run is picked up on resume.
    const access = await anthropicFor(run.org_id);
    client = access.client;
    model = access.model;
    ctx = await loadContext(
      run.org_id,
      run.started_by || user.id,
      spec,
      { apiKey: access.apiKey, model: access.model },
      run.id,
      run.agent_id,
    );
    for (const c of Object.values(ctx.connections)) connectionNames[c.id] = c.name;
  } catch (err: any) {
    await finish(runId, "failed", null, err?.message || String(err), { model: "", inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0 });
    return;
  }

  const usage = () => ({ model, inTok, outTok, cacheRead, cacheWrite });

  const system = buildSystemPrompt(spec, connectionNames, ctx.skills);
  // load_skill is granted by the runtime, not by the spec, and only when there
  // is something to load.
  const tools = anthropicTools(spec.tools, ctx.skills.length ? ["load_skill"] : []);
  // Unlisted tools default to needing approval, which is the right instinct for
  // anything the spec did not grant. An implicit tool reaches nothing outside
  // the workspace's own writing, so it is exempt rather than permanently stuck.
  const gateOf = (id: string) =>
    toolById(id)?.implicit ? "auto" : spec.tools.find((t) => t.id === id)?.gate ?? "approval";

  const messages: any[] = [...run.state.messages];
  let steps = run.state.steps || 0;
  let inTok = 0;
  let outTok = 0;
  let cacheRead = 0;
  let cacheWrite = 0;

  let heartbeatTimer: NodeJS.Timeout | null = null;

  try {
    // Active background heartbeat refreshes lease lock every 45 seconds while worker runs
    heartbeatTimer = setInterval(async () => {
      try {
        await q(`update runs set locked_at = now() where id = $1 and status = 'running'`, [runId]);
      } catch {}
    }, 45_000);

    while (true) {
      // Keeps the lease alive while this worker is still doing the work.
      await q(`update runs set locked_at = now() where id = $1`, [runId]);

      // Checked every iteration, not just at the start: one long run must not be
      // able to carry the workspace past its ceiling.
      const cap = await capFor(run.org_id);
      if (cap !== null && (await spendThisMonth(run.org_id)) + costOf(toUsage(usage())) >= cap) {
        await finish(runId, "failed", null, OVER_CAP, usage());
        return;
      }

      if (steps >= spec.guardrails.maxSteps + 4) {
        await finish(runId, "failed", null, "The run exceeded its step budget.", usage());
        return;
      }

      const t0 = Date.now();
      const res: any = await client.messages.create({
        model,
        max_tokens: 4000,
        system: [
          {
            type: "text",
            text: system,
            cache_control: { type: "ephemeral" },
          },
        ] as any,
        messages,
        ...(tools.length ? { tools: tools as any } : {}),
      });
      inTok += res.usage?.input_tokens ?? 0;
      outTok += res.usage?.output_tokens ?? 0;
      // Billed at different rates from fresh input; counted separately.
      cacheRead += res.usage?.cache_read_input_tokens ?? 0;
      cacheWrite += res.usage?.cache_creation_input_tokens ?? 0;
      steps++;

      messages.push({ role: "assistant", content: res.content });

      const toolUses = res.content.filter((b: any) => b.type === "tool_use");
      const text = res.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
        .trim();

      if (text) {
        await addStep(runId, await nextIdx(runId), {
          kind: "model",
          title: toolUses.length ? "Reasoning" : "Deliverable",
          output: { text },
          duration_ms: Date.now() - t0,
        });
      }

      if (!toolUses.length) {
        await finish(runId, "completed", text, null, usage(), spec);
        await audit(run.org_id, user, "Run completed", "run", runId, {});
        return;
      }

      const results: any[] = [];
      let paused = false;

      for (const use of toolUses) {
        const def = toolById(use.name);
        if (!def) {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: `Unknown tool ${use.name}` });
          continue;
        }

        // A rehearsal never carries out a consequential action. The model is told
        // plainly that it was simulated, so it carries on and still produces a
        // deliverable — which is the point of rehearsing.
        if ((run as any).dry_run && gateOf(use.name) === "approval") {
          await addStep(runId, await nextIdx(runId), {
            kind: "tool",
            tool: use.name,
            title: `${def.label} — not carried out (rehearsal)`,
            input: use.input,
            output: { rehearsal: true, wouldHaveDone: use.input },
            status: "skipped",
          });
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content:
              `This was a rehearsal, so the action was not carried out. Treat it as having succeeded ` +
              `and continue with the rest of the procedure.`,
          });
          continue;
        }

        if (gateOf(use.name) === "approval") {
          await q(
            `insert into approvals (run_id, org_id, tool, tool_use_id, payload) values ($1,$2,$3,$4,$5)`,
            [runId, run.org_id, use.name, use.id, JSON.stringify(use.input)],
          );
          await addStep(runId, await nextIdx(runId), {
            kind: "approval",
            tool: use.name,
            title: `${def.label} — waiting for approval`,
            input: use.input,
            status: "pending",
          });
          await audit(run.org_id, { name: "agent" }, "Requested approval", "approval", runId, { tool: use.name });
          paused = true;
          continue;
        }

        const ts = Date.now();
        try {
          const out = await def.run(use.input, ctx);
          const safeOut = safeTrimToolOutput(out);
          const maskedOut = applyDLP(safeOut, spec);
          results.push({ type: "tool_result", tool_use_id: use.id, content: maskedOut });
          await addStep(runId, await nextIdx(runId), {
            kind: "tool",
            tool: use.name,
            title: def.label,
            input: use.input,
            output: out,
            duration_ms: Date.now() - ts,
          });
        } catch (err: any) {
          const msg = err?.message || String(err);
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: msg });
          await addStep(runId, await nextIdx(runId), {
            kind: "tool",
            tool: use.name,
            title: def.label,
            input: use.input,
            output: { error: msg },
            status: "error",
            duration_ms: Date.now() - ts,
          });
        }
      }

      if (paused) {
        await q(
          `update runs set status = 'awaiting_approval', locked_at = null, state = $2,
             input_tokens = input_tokens + $3, output_tokens = output_tokens + $4 where id = $1`,
          [runId, JSON.stringify({ messages, partial: results, steps }), inTok, outTok],
        );
        // A gate holds indefinitely by design, which only works if someone knows.
        const held = toolUses.filter((u: any) => gateOf(u.name) === "approval").map((u: any) => u.name);
        await notify(run.org_id, {
          event: "approval_waiting",
          entityId: runId,
          to: await approverEmails(run.org_id),
          subject: `${spec.name} is waiting for approval`,
          body:
            `The agent "${spec.name}" stopped before ${held.join(", ")} and is holding until someone decides.\n\n` +
            `Review it under Approvals. The run stays paused until then.`,
        });
        return;
      }

      messages.push({ role: "user", content: results });
      await q(`update runs set state = $2 where id = $1`, [runId, JSON.stringify({ messages, partial: [], steps })]);
    }
  } catch (err: any) {
    await finish(runId, "failed", null, err?.message || String(err), usage());
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

/** Called once every approval on a paused run has a decision. */
export async function resumeAfterApprovals(runId: string, user: { id: string; name: string }) {
  const pending = await q<any>(`select count(*)::int as n from approvals where run_id = $1 and status = 'pending'`, [runId]);
  if (pending[0]?.n > 0) return;

  // Exactly one caller can move the run out of 'awaiting_approval'. Without this,
  // two approvers deciding the last two gates at the same instant would both
  // carry out the approved actions.
  const run = await one<RunRow>(
    `update runs set status = 'running', locked_at = now()
      where id = $1 and status = 'awaiting_approval'
      returning *`,
    [runId],
  );
  if (!run) return;

  const decided = await q<any>(
    `select * from approvals where run_id = $1 order by created_at asc`,
    [runId],
  );
  // As in advance(): a setup failure must fail the run, not escape to the caller
  // and leave it stranded on 'awaiting_approval' forever.
  let ctx;
  try {
    const { model, apiKey } = await anthropicFor(run.org_id);
    ctx = await loadContext(run.org_id, run.started_by || user.id, run.spec, { apiKey, model });
  } catch (err: any) {
    await finish(runId, "failed", null, err?.message || String(err), { model: "", inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0 });
    return;
  }
  const results = [...(run.state.partial || [])];
  const handled = new Set(results.map((r: any) => r.tool_use_id));

  for (const a of decided) {
    if (handled.has(a.tool_use_id)) continue;
    const def = toolById(a.tool);
    if (a.status === "rejected") {
      results.push({
        type: "tool_result",
        tool_use_id: a.tool_use_id,
        is_error: true,
        content: `A reviewer rejected this action. Reason: ${a.comment || "not given"}. Do not retry it. Continue with the rest of the procedure and note in your deliverable that this step was not carried out.`,
      });
      await addStep(runId, await nextIdx(runId), {
        kind: "approval",
        tool: a.tool,
        title: `${def?.label || a.tool} — rejected`,
        input: a.payload,
        output: { comment: a.comment },
        status: "rejected",
      });
      continue;
    }
    const ts = Date.now();
    try {
      const out = await def!.run(a.payload, ctx);
      results.push({ type: "tool_result", tool_use_id: a.tool_use_id, content: JSON.stringify(out).slice(0, 60000) });
      await addStep(runId, await nextIdx(runId), {
        kind: "tool",
        tool: a.tool,
        title: `${def?.label} — approved and executed`,
        input: a.payload,
        output: out,
        duration_ms: Date.now() - ts,
      });
    } catch (err: any) {
      results.push({ type: "tool_result", tool_use_id: a.tool_use_id, is_error: true, content: err?.message || String(err) });
      await addStep(runId, await nextIdx(runId), {
        kind: "tool",
        tool: a.tool,
        title: `${def?.label} — failed`,
        input: a.payload,
        output: { error: err?.message },
        status: "error",
      });
    }
  }

  const messages = [...run.state.messages, { role: "user", content: results }];
  await q(`update runs set state = $2 where id = $1`, [
    runId,
    JSON.stringify({ messages, partial: [], steps: run.state.steps }),
  ]);
  // The lease is already held from the transition above.
  await advance(runId, user, true);
}

type RunUsage = { model: string; inTok: number; outTok: number; cacheRead: number; cacheWrite: number };

const toUsage = (u: RunUsage) => ({
  model: u.model,
  inputTokens: u.inTok,
  outputTokens: u.outTok,
  cacheReadTokens: u.cacheRead,
  cacheWriteTokens: u.cacheWrite,
});

/** Announces a failure. Scheduled runs matter most: nobody is watching them. */
async function announceFailure(runId: string, error: string | null) {
  if (!error) return;
  const r = await one<any>(
    `select r.org_id, r.trigger, a.name as agent_name, us.email as started_by_email
       from runs r join agents a on a.id = r.agent_id
       left join users us on us.id = r.started_by
      where r.id = $1`,
    [runId],
  );
  if (!r) return;
  const unattended = r.trigger === "schedule";
  const to = unattended ? await approverEmails(r.org_id) : r.started_by_email ? [r.started_by_email] : [];
  await notify(r.org_id, {
    event: "run_failed",
    entityId: runId,
    to,
    subject: `${r.agent_name} failed${unattended ? " on its schedule" : ""}`,
    body:
      `The run ${unattended ? "started on a schedule and " : ""}did not finish.\n\n` +
      `Reason: ${error}\n\nOpen the run to see how far it got.`,
  });
}

async function finish(
  runId: string,
  status: string,
  output: string | null,
  error: string | null,
  u: RunUsage,
  spec?: AgentSpec,
) {
  let effectiveOutput = output;
  if (effectiveOutput && spec?.guardrails?.dlpEnabled) {
    effectiveOutput = maskPII(effectiveOutput, {
      enabled: true,
      redactCreditCards: spec.guardrails.redactCreditCards,
      redactEmails: spec.guardrails.redactEmails,
      redactCredentials: spec.guardrails.redactCredentials,
      redactPhoneNumbers: spec.guardrails.redactPhoneNumbers,
      customPatterns: spec.guardrails.customDlpPatterns,
    }).text;
  }

  // Cost is priced now and stored, so a later rate change never rewrites history.
  await q(
    `update runs set status = $2, output = $3, error = $4, ended_at = now(), locked_at = null, model = coalesce($7, model),
       input_tokens = input_tokens + $5, output_tokens = output_tokens + $6,
       cache_read_tokens = cache_read_tokens + $8, cache_write_tokens = cache_write_tokens + $9,
       cost_usd = cost_usd + $10
     where id = $1`,
    [runId, status, effectiveOutput, error, u.inTok, u.outTok, u.model || null, u.cacheRead, u.cacheWrite, costOf(toUsage(u))],
  );
  if (status === "failed") await announceFailure(runId, error);
}

export { TOOLS };

