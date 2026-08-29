import path from "path";
import { q, one } from "./db";
import { anthropicFor, buildSystemPrompt, audit } from "./ai";
import { TOOLS, toolById, anthropicTools, type ConnRow, type ToolContext } from "./tools";
import type { AgentSpec } from "./types";

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
): Promise<ToolContext> {
  const ids = spec.sources.map((s) => s.connectionId);
  const rows = ids.length
    ? await q<ConnRow>(`select id, name, kind, config, secret_enc from connections where org_id = $1 and id = any($2::uuid[])`, [orgId, ids])
    : [];
  const connections: Record<string, ConnRow> = {};
  for (const r of rows) connections[r.id] = r;
  return { orgId, userId, connections, storageDir: STORAGE, apiKey: model.apiKey, model: model.model };
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

export async function startRun(opts: {
  orgId: string;
  agentId: string;
  spec: AgentSpec;
  version: number | null;
  input: string;
  user: { id: string; name: string };
  trigger?: string;
}) {
  const run = await one<any>(
    `insert into runs (org_id, agent_id, version, spec, trigger, input, state, started_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [
      opts.orgId,
      opts.agentId,
      opts.version,
      JSON.stringify(opts.spec),
      opts.trigger || "manual",
      opts.input,
      JSON.stringify({ messages: [{ role: "user", content: opts.input || "Begin." }], partial: [], steps: 0 }),
      opts.user.id,
    ],
  );
  await audit(opts.orgId, opts.user, "Started run", "run", run.id, { agentId: opts.agentId, input: opts.input });
  await advance(run.id, opts.user);
  return run.id as string;
}

/** Drives the plan–act–observe loop until the run completes or hits an approval gate. */
export async function advance(runId: string, user: { id: string; name: string }) {
  const run = await one<RunRow>(`select * from runs where id = $1`, [runId]);
  if (!run) throw new Error("Run not found");
  if (run.status !== "running") return;

  const spec = run.spec;
  // Resolved once per advance, so a key changed mid-run is picked up on resume.
  const { client, model, apiKey } = await anthropicFor(run.org_id);
  const ctx = await loadContext(run.org_id, run.started_by || user.id, spec, { apiKey, model });
  const connectionNames: Record<string, string> = {};
  for (const c of Object.values(ctx.connections)) connectionNames[c.id] = c.name;

  const system = buildSystemPrompt(spec, connectionNames);
  const tools = anthropicTools(spec.tools);
  const gateOf = (id: string) => spec.tools.find((t) => t.id === id)?.gate ?? "approval";

  const messages: any[] = [...run.state.messages];
  let steps = run.state.steps || 0;
  let inTok = 0;
  let outTok = 0;

  try {
    while (true) {
      if (steps >= spec.guardrails.maxSteps + 4) {
        await finish(runId, "failed", null, "The run exceeded its step budget.", inTok, outTok);
        return;
      }

      const t0 = Date.now();
      const res: any = await client.messages.create({
        model,
        max_tokens: 4000,
        system,
        messages,
        ...(tools.length ? { tools: tools as any } : {}),
      });
      inTok += res.usage?.input_tokens ?? 0;
      outTok += res.usage?.output_tokens ?? 0;
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
        await finish(runId, "completed", text, null, inTok, outTok);
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
          results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out).slice(0, 60000) });
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
          `update runs set status = 'awaiting_approval', state = $2, input_tokens = input_tokens + $3, output_tokens = output_tokens + $4 where id = $1`,
          [runId, JSON.stringify({ messages, partial: results, steps }), inTok, outTok],
        );
        return;
      }

      messages.push({ role: "user", content: results });
      await q(`update runs set state = $2 where id = $1`, [runId, JSON.stringify({ messages, partial: [], steps })]);
    }
  } catch (err: any) {
    await finish(runId, "failed", null, err?.message || String(err), inTok, outTok);
  }
}

/** Called once every approval on a paused run has a decision. */
export async function resumeAfterApprovals(runId: string, user: { id: string; name: string }) {
  const run = await one<RunRow>(`select * from runs where id = $1`, [runId]);
  if (!run || run.status !== "awaiting_approval") return;

  const pending = await q<any>(`select count(*)::int as n from approvals where run_id = $1 and status = 'pending'`, [runId]);
  if (pending[0]?.n > 0) return;

  const decided = await q<any>(
    `select * from approvals where run_id = $1 order by created_at asc`,
    [runId],
  );
  const { model, apiKey } = await anthropicFor(run.org_id);
  const ctx = await loadContext(run.org_id, run.started_by || user.id, run.spec, { apiKey, model });
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
  await q(`update runs set status = 'running', state = $2 where id = $1`, [
    runId,
    JSON.stringify({ messages, partial: [], steps: run.state.steps }),
  ]);
  await advance(runId, user);
}

async function finish(
  runId: string,
  status: string,
  output: string | null,
  error: string | null,
  inTok: number,
  outTok: number,
) {
  await q(
    `update runs set status = $2, output = $3, error = $4, ended_at = now(),
       input_tokens = input_tokens + $5, output_tokens = output_tokens + $6 where id = $1`,
    [runId, status, output, error, inTok, outTok],
  );
}

export { TOOLS };
