import { q, one } from "./db";
import { assistantTurn, engineAccess, engineOf, meteredStep, type EngineAccess } from "./models";
import { costOf } from "./pricing";
import { createA2ATaskEnvelope } from "./a2a/envelope";
import { dispatchA2AMessage } from "./a2a/client";
import type { AgentSpec, SwarmWorker } from "./types";
import type { A2AWorkerResponse } from "./a2a/types";

export interface SwarmExecutionOptions {
  runId: string;
  run: {
    id: string;
    org_id: string;
    agent_id: string;
    input: string;
    spec: AgentSpec;
    dry_run?: boolean;
    started_by: string;
  };
  user: { id: string; name: string };
}

async function addStep(runId: string, idx: number, s: {
  kind: "model" | "tool" | "approval" | "output";
  tool?: string | null;
  title?: string;
  input?: any;
  output?: any;
  status?: "ok" | "error";
  duration_ms?: number;
}) {
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

async function nextIdx(runId: string): Promise<number> {
  const r = await one<any>(`select coalesce(max(idx), -1) + 1 as n from run_steps where run_id = $1`, [runId]);
  return Number(r?.n ?? 0);
}

async function finishRun(
  runId: string,
  status: "completed" | "failed",
  output: string | null,
  error: string | null,
  usage: { model: string; inTok: number; outTok: number; cacheRead: number; cacheWrite: number }
) {
  await q(
    `update runs set status = $2, output = $3, error = $4, ended_at = now(), locked_at = null, model = coalesce($7, model),
       input_tokens = input_tokens + $5, output_tokens = output_tokens + $6,
       cache_read_tokens = cache_read_tokens + $8, cache_write_tokens = cache_write_tokens + $9,
       cost_usd = cost_usd + $10
     where id = $1`,
    [
      runId,
      status,
      output,
      error,
      usage.inTok,
      usage.outTok,
      usage.model || null,
      usage.cacheRead,
      usage.cacheWrite,
      costOf({
        model: usage.model,
        inputTokens: usage.inTok,
        outputTokens: usage.outTok,
        cacheReadTokens: usage.cacheRead,
        cacheWriteTokens: usage.cacheWrite,
      }),
    ],
  );
}

/**
 * Executes an individual swarm worker (either internal workspace agent or external A2A agent).
 */
async function invokeWorker(
  orgId: string,
  supervisorAgentId: string,
  supervisorName: string,
  parentRunId: string,
  worker: SwarmWorker,
  taskPrompt: string,
  user: { id: string; name: string }
): Promise<A2AWorkerResponse> {
  const isExternal = worker.type === "external" || Boolean(worker.endpointUrl);

  if (isExternal && worker.endpointUrl) {
    // External Agent: Dispatch via A2A Protocol
    const envelope = createA2ATaskEnvelope({
      supervisor: { id: supervisorAgentId, name: supervisorName },
      worker: { id: worker.id || worker.name, name: worker.name, endpoint: worker.endpointUrl },
      goal: taskPrompt,
      conversationId: `swarm_${parentRunId}`,
      timeoutMs: 60_000,
    });

    return await dispatchA2AMessage({
      endpointUrl: worker.endpointUrl,
      message: envelope,
      apiKey: worker.apiKey,
      timeoutMs: 60_000,
      allowLocalhost: true,
    });
  }

  // Internal Agent: Spawn child run via orchestrator startRun
  if (!worker.agentId) {
    return {
      status: "failed",
      error: `Worker "${worker.name}" is missing a valid agentId or external endpointUrl.`,
    };
  }

  const targetAgent = await one<any>(
    `select id, name, status, published_ver, draft_spec from agents where id = $1 and org_id = $2`,
    [worker.agentId, orgId]
  );

  if (!targetAgent) {
    return {
      status: "failed",
      error: `Internal agent "${worker.name}" (${worker.agentId}) was not found in this workspace.`,
    };
  }

  let spec = targetAgent.draft_spec;
  let ver = targetAgent.published_ver;
  if (targetAgent.status === "published" && targetAgent.published_ver) {
    const verRow = await one<any>(
      `select spec from agent_versions where agent_id = $1 and version = $2`,
      [targetAgent.id, targetAgent.published_ver]
    );
    if (verRow?.spec) spec = verRow.spec;
  }

  const { startRun } = await import("./orchestrator");
  const t0 = Date.now();

  try {
    const childRunId = await startRun({
      orgId,
      agentId: targetAgent.id,
      spec,
      version: ver || null,
      input: taskPrompt,
      user,
      trigger: `swarm:${supervisorAgentId}`,
      parentRunId,
      waitForCompletion: true,
    });

    const durationMs = Date.now() - t0;
    const childRun = await one<any>(`select * from runs where id = $1`, [childRunId]);

    if (!childRun) {
      return { status: "failed", error: "Child run record not found", metadata: { durationMs } };
    }

    if (childRun.status === "completed") {
      return {
        status: "completed",
        deliverable: childRun.output || "Task completed with no output text.",
        metadata: {
          durationMs,
          agentName: targetAgent.name,
          model: childRun.model,
          tokensUsed: (childRun.input_tokens || 0) + (childRun.output_tokens || 0),
        },
      };
    }

    if (childRun.status === "awaiting_approval") {
      return {
        status: "awaiting_approval",
        deliverable: `Worker agent "${targetAgent.name}" requested a gated action requiring human approval in workspace queue.`,
        metadata: { durationMs, agentName: targetAgent.name },
      };
    }

    return {
      status: "failed",
      error: childRun.error || `Child run finished with status ${childRun.status}`,
      deliverable: childRun.output,
      metadata: { durationMs, agentName: targetAgent.name },
    };
  } catch (err: any) {
    return {
      status: "failed",
      error: err.message || String(err),
      metadata: { durationMs: Date.now() - t0 },
    };
  }
}

/**
 * Main entrance point for executing swarm runs
 */
export async function executeSwarmRun(opts: SwarmExecutionOptions): Promise<void> {
  const { runId, run, user } = opts;
  const spec = run.spec;
  const swarm = spec.swarm;

  if (!swarm || !swarm.enabled || !swarm.workers || swarm.workers.length === 0) {
    await finishRun(runId, "failed", null, "Swarm configuration has no active workers.", {
      model: "",
      inTok: 0,
      outTok: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    return;
  }

  // The supervisor runs on the agent's own engine, like a single agent does.
  const access = await engineAccess(run.org_id, engineOf(spec), spec.model);
  const model = access.model;

  const agentRow = await one<any>(`select name from agents where id = $1`, [run.agent_id]);
  const supervisorName = agentRow?.name || spec.name || "Supervisor Coordinator";

  const strategy = swarm.strategy || "router";

  try {
    if (strategy === "parallel") {
      await executeParallelSwarm(opts, supervisorName, access, model);
    } else if (strategy === "sequential") {
      await executeSequentialSwarm(opts, supervisorName, access, model);
    } else {
      await executeRouterSwarm(opts, supervisorName, access, model);
    }
  } catch (err: any) {
    console.error(`[Swarm Orchestration Error] Run ${runId}:`, err);
    await finishRun(runId, "failed", null, err.message || String(err), {
      model,
      inTok: 0,
      outTok: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  }
}

/**
 * Strategy: PARALLEL (Scatter-Gather / Map-Reduce)
 * Dispatches all workers concurrently, records worker steps, then runs a synthesis pass.
 */
async function executeParallelSwarm(
  opts: SwarmExecutionOptions,
  supervisorName: string,
  access: EngineAccess,
  model: string
) {
  const { runId, run, user } = opts;
  const workers = opts.run.spec.swarm!.workers;

  // 1. Initial Orchestrator Step
  const idx0 = await nextIdx(runId);
  await addStep(runId, idx0, {
    kind: "tool",
    tool: "swarm:parallel_dispatch",
    title: `Parallel Swarm Dispatched: ${workers.length} Workers`,
    input: {
      strategy: "parallel",
      supervisorRole: opts.run.spec.swarm!.supervisorRole || "Triage & Delegate",
      workers: workers.map((w) => ({ name: w.name, role: w.role, type: w.type || (w.endpointUrl ? "external" : "internal") })),
    },
    output: { message: `Fanning out tasks concurrently to ${workers.length} specialist agents.` },
    status: "ok",
  });

  // 2. Fan-out execution across all workers concurrently
  const promises = workers.map(async (worker, i) => {
    const workerPrompt = worker.taskPrompt
      ? `${worker.taskPrompt}\n\nTask Context:\n${run.input}`
      : `You are specialist "${worker.name}" (${worker.role}). Execute your portion of this objective:\n${run.input}`;

    const t0 = Date.now();
    const res = await invokeWorker(
      run.org_id,
      run.agent_id,
      supervisorName,
      run.id,
      worker,
      workerPrompt,
      user
    );
    const duration = Date.now() - t0;

    const stepIdx = await nextIdx(runId);
    await addStep(runId, stepIdx, {
      kind: "tool",
      tool: worker.endpointUrl ? "a2a:external_worker" : "swarm:child_agent",
      title: `${worker.name} (${worker.type === "external" || worker.endpointUrl ? "External A2A" : "Specialist"})`,
      input: {
        workerName: worker.name,
        role: worker.role,
        type: worker.type || (worker.endpointUrl ? "external" : "internal"),
        endpoint: worker.endpointUrl || "workspace_agent",
        prompt: workerPrompt,
      },
      output: {
        status: res.status,
        deliverable: res.deliverable,
        error: res.error,
        metadata: res.metadata,
      },
      status: res.status === "completed" ? "ok" : "error",
      duration_ms: duration,
    });

    return { worker, res };
  });

  const settled = await Promise.allSettled(promises);
  const workerFindings: string[] = [];

  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    const w = workers[i];
    if (s.status === "fulfilled") {
      const { res } = s.value;
      if (res.status === "completed" && res.deliverable) {
        workerFindings.push(`### Specialist Contribution: ${w.name} (${w.role})\n${res.deliverable}`);
      } else {
        workerFindings.push(`### Specialist Contribution: ${w.name} (${w.role})\n[Failed/Incomplete: ${res.error || "No deliverable returned"}]`);
      }
    } else {
      workerFindings.push(`### Specialist Contribution: ${w.name} (${w.role})\n[Execution Error: ${s.reason?.message || String(s.reason)}]`);
    }
  }

  // 3. Supervisor Synthesis Pass
  const synthPrompt = `You are "${supervisorName}", the Lead Supervisor Coordinator in Agent Studio.
Your swarm of ${workers.length} specialist agents has concluded its concurrent execution for the following task:

ORIGINAL TASK:
${run.input}

SPECIALIST FINDINGS & DELIVERABLES:
${workerFindings.join("\n\n---\n\n")}

SUPERVISOR OBJECTIVE:
Synthesize, verify, and consolidate the specialists' contributions into a unified, high-quality, professional deliverable that comprehensively answers the original user request.
Highlight key consensus findings, address discrepancies if any, and deliver the final result in clear GitHub-flavored Markdown.`;

  const synthResponse = await meteredStep(access, {
    system: "You consolidate the work of specialist agents into one deliverable.",
    messages: [{ role: "user", content: synthPrompt }],
    tools: [],
    maxTokens: 4000,
  }, { orgId: run.org_id, feature: "agent_run", agentId: run.agent_id, runId, userId: (run as any).started_by ?? null });

  const finalDeliverable = synthResponse.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n\n");

  const synthIdx = await nextIdx(runId);
  await addStep(runId, synthIdx, {
    kind: "output",
    title: `Consolidated Swarm Deliverable (${supervisorName})`,
    output: { deliverable: finalDeliverable },
    status: "ok",
    duration_ms: 0,
  });

  await finishRun(runId, "completed", finalDeliverable, null, {
    model,
    inTok: synthResponse.usage?.input_tokens || 0,
    outTok: synthResponse.usage?.output_tokens || 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
}

/**
 * Strategy: SEQUENTIAL (Pipeline Chain)
 * Pipes output of Worker N into Worker N+1 as structured input.
 */
async function executeSequentialSwarm(
  opts: SwarmExecutionOptions,
  supervisorName: string,
  access: EngineAccess,
  model: string
) {
  const { runId, run, user } = opts;
  const workers = opts.run.spec.swarm!.workers;

  const idx0 = await nextIdx(runId);
  await addStep(runId, idx0, {
    kind: "tool",
    tool: "swarm:sequential_pipeline",
    title: `Sequential Swarm Pipeline: ${workers.length} Stages`,
    input: {
      strategy: "sequential",
      stages: workers.map((w, idx) => ({ step: idx + 1, name: w.name, role: w.role })),
    },
    output: { message: `Initiating sequential pipeline across ${workers.length} ordered stages.` },
    status: "ok",
  });

  let currentContext = run.input;

  for (let i = 0; i < workers.length; i++) {
    const worker = workers[i];
    const isFirst = i === 0;

    const workerPrompt = isFirst
      ? (worker.taskPrompt ? `${worker.taskPrompt}\n\nTask:\n${currentContext}` : currentContext)
      : [
          `You are executing Step ${i + 1} of a multi-agent sequential pipeline.`,
          `Your Role: ${worker.name} (${worker.role})`,
          worker.taskPrompt ? `Role Specific Directives: ${worker.taskPrompt}` : "",
          `--- ORIGINAL OBJECTIVE ---`,
          run.input,
          `--- PREVIOUS STAGE DELIVERABLE ---`,
          currentContext,
          `Perform your designated stage operations and output your enhanced deliverable:`,
        ].filter(Boolean).join("\n\n");

    const t0 = Date.now();
    const res = await invokeWorker(
      run.org_id,
      run.agent_id,
      supervisorName,
      run.id,
      worker,
      workerPrompt,
      user
    );
    const duration = Date.now() - t0;

    const stepIdx = await nextIdx(runId);
    await addStep(runId, stepIdx, {
      kind: "tool",
      tool: worker.endpointUrl ? "a2a:external_worker" : "swarm:pipeline_stage",
      title: `Stage ${i + 1}: ${worker.name} (${worker.type === "external" || worker.endpointUrl ? "External A2A" : "Specialist"})`,
      input: {
        stage: i + 1,
        workerName: worker.name,
        role: worker.role,
        prompt: workerPrompt,
      },
      output: {
        status: res.status,
        deliverable: res.deliverable,
        error: res.error,
      },
      status: res.status === "completed" ? "ok" : "error",
      duration_ms: duration,
    });

    if (res.status === "completed" && res.deliverable) {
      currentContext = res.deliverable;
    } else {
      // Pipeline failed at this step
      await finishRun(runId, "failed", currentContext, `Pipeline halted at Stage ${i + 1} (${worker.name}): ${res.error || "Stage failed"}`, {
        model,
        inTok: 0,
        outTok: 0,
        cacheRead: 0,
        cacheWrite: 0,
      });
      return;
    }
  }

  // Final Supervisor wrap-up
  const finalIdx = await nextIdx(runId);
  await addStep(runId, finalIdx, {
    kind: "output",
    title: `Pipeline Complete: ${workers.length} Stages Finished`,
    output: { deliverable: currentContext },
    status: "ok",
  });

  await finishRun(runId, "completed", currentContext, null, {
    model,
    inTok: 0,
    outTok: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
}

/**
 * Strategy: ROUTER (Autonomous Supervisor with Dynamic A2A Delegation)
 * Equips the supervisor with an injected 'a2a_dispatch' tool to converse with workers adaptively.
 */
async function executeRouterSwarm(
  opts: SwarmExecutionOptions,
  supervisorName: string,
  access: EngineAccess,
  model: string
) {
  const { runId, run, user } = opts;
  const workers = opts.run.spec.swarm!.workers;

  const rosterDesc = workers
    .map(
      (w, i) =>
        `${i + 1}. "${w.name}" [Type: ${w.type || (w.endpointUrl ? "external" : "internal")}] — Role: ${w.role}.${
          w.taskPrompt ? ` Guidelines: ${w.taskPrompt}` : ""
        }`
    )
    .join("\n");

  const systemPrompt = [
    `You are "${supervisorName}", Lead Coordinator for an autonomous Multi-Agent Swarm in Agent Studio.`,
    `Your role is to triage, delegate, and coordinate with your specialist workers to resolve the user's objective.`,
    ``,
    `AVAILABLE SWARM WORKER ROSTER:`,
    rosterDesc,
    ``,
    `OPERATING PROCEDURE:`,
    `- Analyze the user's task and determine which specialist(s) are needed.`,
    `- Use the 'a2a_dispatch' tool to send tasks, instructions, or queries to any worker.`,
    `- You may call workers sequentially or multiple times as needed based on their findings.`,
    `- When you have gathered sufficient information and verified the results, produce your comprehensive deliverable as the final message.`,
  ].join("\n");

  const tools = [
    {
      name: "a2a_dispatch",
      description: "Dispatch an A2A task or inquiry to a specialist worker in your swarm.",
      input_schema: {
        type: "object",
        properties: {
          worker_name: {
            type: "string",
            description: `Exact name of the worker to delegate to. Options: ${workers.map((w) => `"${w.name}"`).join(", ")}`,
          },
          task_prompt: {
            type: "string",
            description: "Detailed instructions and context for the worker to execute",
          },
          performative: {
            type: "string",
            enum: ["REQUEST", "QUERY", "INFORM"],
            description: "A2A performative intent (default: REQUEST)",
          },
        },
        required: ["worker_name", "task_prompt"],
      },
    },
  ];

  const messages: any[] = [{ role: "user", content: run.input }];
  let steps = 0;
  let inTok = 0;
  let outTok = 0;

  while (steps < 10) {
    steps++;
    const res = await meteredStep(access, {
      system: systemPrompt,
      messages,
      tools,
      maxTokens: 3000,
    }, { orgId: run.org_id, feature: "agent_run", agentId: run.agent_id, runId, userId: (run as any).started_by ?? null });

    inTok += res.usage?.input_tokens || 0;
    outTok += res.usage?.output_tokens || 0;

    const toolCalls = res.content.filter((b: any) => b.type === "tool_use");

    if (!toolCalls.length) {
      // Completed by supervisor
      const deliverable = res.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n\n");

      const finalIdx = await nextIdx(runId);
      await addStep(runId, finalIdx, {
        kind: "output",
        title: `Swarm Deliverable (${supervisorName})`,
        output: { deliverable },
        status: "ok",
      });

      await finishRun(runId, "completed", deliverable, null, {
        model,
        inTok,
        outTok,
        cacheRead: 0,
        cacheWrite: 0,
      });
      return;
    }

    // Process tool calls (a2a_dispatch)
    messages.push(assistantTurn(res));
    const toolResults: any[] = [];

    for (const call of toolCalls) {
      if (call.name === "a2a_dispatch") {
        const { worker_name, task_prompt } = call.input || {};
        const matchedWorker = workers.find(
          (w) =>
            w.name.toLowerCase().trim() === String(worker_name || "").toLowerCase().trim() ||
            (w.id && w.id === worker_name)
        );

        if (!matchedWorker) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: `Worker "${worker_name}" not found in swarm roster. Available workers: ${workers.map((w) => w.name).join(", ")}.`,
          });
          continue;
        }

        const t0 = Date.now();
        const workerRes = await invokeWorker(
          run.org_id,
          run.agent_id,
          supervisorName,
          run.id,
          matchedWorker,
          task_prompt,
          user
        );
        const duration = Date.now() - t0;

        const stepIdx = await nextIdx(runId);
        await addStep(runId, stepIdx, {
          kind: "tool",
          tool: matchedWorker.endpointUrl ? "a2a:external_worker" : "swarm:child_agent",
          title: `A2A Dispatch: ${matchedWorker.name}`,
          input: {
            worker: matchedWorker.name,
            task: task_prompt,
            type: matchedWorker.type || (matchedWorker.endpointUrl ? "external" : "internal"),
          },
          output: {
            status: workerRes.status,
            deliverable: workerRes.deliverable,
            error: workerRes.error,
          },
          status: workerRes.status === "completed" ? "ok" : "error",
          duration_ms: duration,
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: workerRes.deliverable || `Worker status: ${workerRes.status}. Error: ${workerRes.error || "none"}`,
        });
      } else {
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `Unrecognized tool call: ${call.name}`,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  // If exceeded 10 steps
  await finishRun(runId, "failed", null, "Supervisor exceeded step budget during swarm delegation.", {
    model,
    inTok,
    outTok,
    cacheRead: 0,
    cacheWrite: 0,
  });
}
