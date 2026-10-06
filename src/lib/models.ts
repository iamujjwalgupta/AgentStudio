import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { one } from "./db";
import { decrypt } from "./crypto";
import { assertWithinLimits, geminiUsage, meteredAnthropic, plainModelError, recordUsage, type MeterCtx } from "./metering";

/**
 * The models agents run on, and where their keys come from.
 *
 * An agent picks its engine (spec.engine): Claude through Anthropic, or Gemini
 * through Google. A run talks to its engine one step at a time through
 * modelStep(), which takes and returns the Anthropic message shape whichever
 * engine answers, so the run loop, approvals, rehearsals and resume work the
 * same on both. Gemini's own reply is kept beside each step (`gemini` on the
 * assistant message) and sent back verbatim, because it carries thought
 * signatures the next request must include.
 */

export type Engine = "anthropic" | "gemini";
export const ENGINE_LABEL: Record<Engine, string> = { anthropic: "Claude (Anthropic)", gemini: "Gemini (Google)" };

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
export const GEMINI_MODEL = "gemini-2.5-flash";

export const NO_KEY =
  "No Anthropic API key is available to this workspace. Add one under Connections, or set ANTHROPIC_API_KEY on the server.";
export const NO_GEMINI_KEY = "No Gemini key is available to this workspace. Add one under Connections.";

export type ModelAccess = { apiKey: string; model: string; source: "connection" | "environment" };

/**
 * Where the Anthropic credential comes from, in order: the workspace's own
 * Anthropic connection, then the server environment. The connection wins so a
 * workspace can bring its own key and its own model without a redeploy.
 */
export async function modelAccess(orgId: string): Promise<ModelAccess> {
  const row = await one<any>(`select config, secret_enc from connections where org_id = $1 and kind = 'anthropic' limit 1`, [orgId]);
  const fromConn = row?.secret_enc ? decrypt(row.secret_enc) : "";
  if (fromConn) return { apiKey: fromConn, model: row.config?.model?.trim() || MODEL, source: "connection" };
  const fromEnv = process.env.ANTHROPIC_API_KEY || "";
  if (fromEnv) return { apiKey: fromEnv, model: MODEL, source: "environment" };
  throw new Error(NO_KEY);
}

/** The same for Gemini: the workspace's Gemini connection, then GEMINI_API_KEY. */
export async function geminiAccess(orgId: string): Promise<ModelAccess> {
  const row = await one<any>(`select config, secret_enc from connections where org_id = $1 and kind = 'gemini' limit 1`, [orgId]);
  const fromConn = row?.secret_enc ? decrypt(row.secret_enc) : "";
  if (fromConn) return { apiKey: fromConn, model: row.config?.model?.trim() || GEMINI_MODEL, source: "connection" };
  const fromEnv = process.env.GEMINI_API_KEY || "";
  if (fromEnv) return { apiKey: fromEnv, model: GEMINI_MODEL, source: "environment" };
  throw new Error(NO_GEMINI_KEY);
}

// One client per distinct key, so switching the workspace key takes effect at once.
const clients = new Map<string, Anthropic>();
export function clientFor(apiKey: string) {
  if (!apiKey) throw new Error(NO_KEY);
  let c = clients.get(apiKey);
  if (!c) {
    c = new Anthropic({ apiKey });
    clients.set(apiKey, c);
  }
  return c;
}

/** Resolves the workspace's Anthropic credential and returns a client bound to it. */
export async function anthropicFor(orgId: string) {
  const access = await modelAccess(orgId);
  return { client: clientFor(access.apiKey), ...access };
}

/** The engine an agent runs on. Agents saved before the choice existed run on Claude. */
export function engineOf(spec: { engine?: string } | null | undefined): Engine {
  return spec?.engine === "gemini" ? "gemini" : "anthropic";
}

export type EngineAccess = ModelAccess & { engine: Engine };

/** The models an agent can be set to, per engine (all priced in lib/pricing). */
export const ENGINE_MODELS: Record<Engine, string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
};

/**
 * The key for an engine, and the model to run: the agent's own choice when it
 * names one this engine offers, otherwise the model set on the key.
 */
export async function engineAccess(orgId: string, engine: Engine, model?: string): Promise<EngineAccess> {
  const a = engine === "gemini" ? await geminiAccess(orgId) : await modelAccess(orgId);
  const own = model?.trim();
  return { ...a, engine, ...(own && ENGINE_MODELS[engine].includes(own) ? { model: own } : {}) };
}

/** Which engines this workspace has a key for, and the model each would use. */
export async function enginesFor(orgId: string): Promise<{ id: Engine; label: string; model: string }[]> {
  const out: { id: Engine; label: string; model: string }[] = [];
  for (const id of ["anthropic", "gemini"] as Engine[]) {
    try {
      out.push({ id, label: ENGINE_LABEL[id], model: (await engineAccess(orgId, id)).model });
    } catch {
      /* no key for this one */
    }
  }
  return out;
}

// ---- one step of a run ------------------------------------------------------------------

export type StepIn = {
  system: string;
  messages: any[];
  /** Anthropic tool definitions: { name, description, input_schema }. */
  tools: any[];
  maxTokens?: number;
};
export type StepOut = {
  content: any[];
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
  /** Gemini's own parts for this reply, to send back on the next step. */
  gemini?: any[];
};

/** One model step: the conversation so far in, the model's reply out, both in the Anthropic shape. */
export async function modelStep(access: EngineAccess, input: StepIn): Promise<StepOut> {
  return access.engine === "gemini" ? geminiStep(access, input) : anthropicStep(access, input);
}

/**
 * modelStep with the usage checks around it: refuses past a usage limit,
 * and records what the step used against the engine's own key.
 */
export async function meteredStep(access: EngineAccess, input: StepIn, meter: MeterCtx): Promise<StepOut> {
  await assertWithinLimits(meter.orgId, access.engine, meter.agentId);
  const out = await modelStep(access, input);
  await recordUsage(meter, access.engine, access.model, {
    input: out.usage.input_tokens,
    output: out.usage.output_tokens,
    cacheRead: out.usage.cache_read_input_tokens,
    cacheWrite: out.usage.cache_creation_input_tokens,
  });
  return out;
}

/** The assistant turn to keep in a transcript: the reply, plus Gemini's own parts when it was Gemini. */
export const assistantTurn = (out: StepOut) => ({ role: "assistant", content: out.content, ...(out.gemini ? { gemini: out.gemini } : {}) });

async function anthropicStep(access: EngineAccess, { system, messages, tools, maxTokens }: StepIn): Promise<StepOut> {
  const res: any = await clientFor(access.apiKey)
    .messages.create({
      model: access.model,
      max_tokens: maxTokens ?? 4000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] as any,
      // Gemini's saved parts are ours, not Anthropic's: never sent to it.
      messages: messages.map(({ gemini, ...m }: any) => m),
      ...(tools.length ? { tools } : {}),
    })
    .catch((e: any) => {
      throw plainModelError(e);
    });
  return {
    content: res.content,
    usage: {
      input_tokens: res.usage?.input_tokens ?? 0,
      output_tokens: res.usage?.output_tokens ?? 0,
      cache_read_input_tokens: res.usage?.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: res.usage?.cache_creation_input_tokens ?? 0,
    },
  };
}

/** The conversation in Gemini's terms: user/model turns of parts, tool results as functionResponse. */
function toGeminiContents(messages: any[]) {
  const nameOf = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const b of m.content) if (b.type === "tool_use") nameOf.set(b.id, b.name);
    }
  }
  const contents: any[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      const parts = Array.isArray(m.gemini) && m.gemini.length
        ? m.gemini
        : (Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content ?? "") }]).flatMap((b: any) =>
            b.type === "text" && b.text ? [{ text: b.text }] : b.type === "tool_use" ? [{ functionCall: { name: b.name, args: b.input ?? {} } }] : [],
          );
      if (parts.length) contents.push({ role: "model", parts });
      continue;
    }
    if (typeof m.content === "string") {
      contents.push({ role: "user", parts: [{ text: m.content || "Begin." }] });
      continue;
    }
    const parts = (m.content || []).flatMap((b: any) => {
      if (b.type === "tool_result") {
        const body = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
        return [{ functionResponse: { name: nameOf.get(b.tool_use_id) || "tool", response: b.is_error ? { error: body } : { result: body } } }];
      }
      if (b.type === "text" && b.text) return [{ text: b.text }];
      return [];
    });
    if (parts.length) contents.push({ role: "user", parts });
  }
  return contents;
}

function plainGeminiError(status: number, message: string): Error {
  let text: string;
  if (/API key not valid|API_KEY_INVALID/i.test(message) || status === 401) {
    text = "The workspace's Gemini key was rejected. An admin can check or replace it under Connections.";
  } else if (status === 403) {
    text = "The workspace's Gemini key is not allowed to use this model. An admin can check it in Google AI Studio.";
  } else if (status === 429) {
    text = "The Gemini key has hit its rate limit or quota. Wait a minute and try again, or raise the quota in Google AI Studio.";
  } else if (status >= 500) {
    text = "Gemini is unavailable right now. Try again in a few minutes.";
  } else {
    text = `The model call failed (${status}): ${message.slice(0, 300)}`;
  }
  return Object.assign(new Error(text), { status });
}

/**
 * Gemini sometimes answers with nothing usable: a function call it could not
 * format (MALFORMED_FUNCTION_CALL, most often with very long arguments) or an
 * empty reply late in a long run. That step is asked again, up to twice, with a
 * note to carry on; the note is for that request only and is not kept in the
 * run's transcript.
 */
async function geminiStep(access: EngineAccess, input: StepIn): Promise<StepOut> {
  let last: any;
  let unusable = 0;
  // Up to 2 retries for an unusable reply, and up to 4 for a passing network or
  // service fault (waiting a little longer each time), as the Claude client does.
  for (let attempt = 0, transient = 0; attempt < 7; attempt++) {
    try {
      const messages = unusable
        ? [
            ...input.messages,
            {
              role: "user",
              content:
                "Your last reply could not be used: it was empty, or its tool call was malformed. Carry on with the work: make the next tool call again with valid arguments, splitting very long ones into smaller calls.",
            },
          ]
        : input.messages;
      return await geminiOnce(access, { ...input, messages });
    } catch (e: any) {
      last = e;
      if (e?.transient && transient < 4) {
        transient++;
        await new Promise((r) => setTimeout(r, 1500 * 2 ** (transient - 1)));
        continue;
      }
      if (e?.retry && unusable < 2) {
        unusable++;
        continue;
      }
      throw e;
    }
  }
  throw last;
}

async function geminiOnce(access: EngineAccess, { system, messages, tools, maxTokens }: StepIn): Promise<StepOut> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(access.model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": access.apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: toGeminiContents(messages),
        ...(tools.length
          ? {
              tools: [
                {
                  functionDeclarations: tools.map((t: any) => ({
                    name: t.name,
                    description: t.description,
                    parametersJsonSchema: t.input_schema,
                  })),
                },
              ],
            }
          : {}),
        // Gemini's thinking counts against the output budget, so it gets more room than Claude.
        generationConfig: { temperature: 0.2, maxOutputTokens: Math.max(8192, maxTokens ?? 0) },
      }),
      signal: AbortSignal.timeout(180_000),
    },
  ).catch((e: any) => {
    throw Object.assign(new Error(`Could not reach Gemini: ${e?.message || e}`), { transient: true });
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = plainGeminiError(res.status, data?.error?.message || `HTTP ${res.status}`);
    if (res.status === 429 || res.status >= 500) err.transient = true;
    throw err;
  }

  const cand = data.candidates?.[0];
  const parts: any[] = cand?.content?.parts || [];
  if (!parts.length) {
    const why = cand?.finishReason || data.promptFeedback?.blockReason || "no reply";
    if (why === "MALFORMED_FUNCTION_CALL" || why === "STOP" || why === "no reply") {
      throw Object.assign(
        new Error(
          why === "MALFORMED_FUNCTION_CALL"
            ? "Gemini could not form a valid tool call, even after being asked again. Try the run again; if it repeats, the agent may be sending very long queries."
            : "Gemini kept returning empty replies. Try the run again.",
        ),
        { retry: true },
      );
    }
    throw new Error(
      why === "MAX_TOKENS"
        ? "Gemini ran out of room before answering. Try again, or give the agent fewer steps per run."
        : `Gemini returned no answer (${why}).`,
    );
  }
  const content: any[] = [];
  for (const p of parts) {
    if (p.functionCall) {
      content.push({
        type: "tool_use",
        id: "gm_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
        name: p.functionCall.name,
        input: p.functionCall.args ?? {},
      });
    } else if (p.text && !p.thought) {
      content.push({ type: "text", text: p.text });
    }
  }
  const u = geminiUsage(data);
  return {
    content,
    gemini: parts,
    usage: { input_tokens: u.input ?? 0, output_tokens: u.output ?? 0, cache_read_input_tokens: u.cacheRead ?? 0, cache_creation_input_tokens: 0 },
  };
}

// ---- drafting -------------------------------------------------------------------------------

/** Failures that mean "this engine can't be used right now", as opposed to a bad request. */
const unavailable = (e: any) =>
  /No (Anthropic API|Gemini) key|run out of credit|was rejected|not allowed|rate limit|rate-limiting|quota|unavailable|overloaded/i.test(String(e?.message || e));

/**
 * One piece of drafting text (an agent from a brief, a skill from a sentence):
 * tried on the preferred engine, then on the other if the first can't be used
 * at all — no key, out of credit, rejected, rate-limited. A real error in the
 * request is not retried elsewhere.
 */
export async function draftText(
  orgId: string,
  prompt: string,
  opts: { engine?: Engine; maxTokens?: number; meter: MeterCtx },
): Promise<{ text: string; engine: Engine; model: string }> {
  const order: Engine[] = opts.engine === "gemini" ? ["gemini", "anthropic"] : ["anthropic", "gemini"];
  let first: any = null;
  for (const engine of order) {
    let access: EngineAccess;
    try {
      access = await engineAccess(orgId, engine);
    } catch (e) {
      first ??= e;
      continue;
    }
    try {
      if (engine === "anthropic") {
        const res: any = await meteredAnthropic(
          clientFor(access.apiKey),
          { model: access.model, max_tokens: opts.maxTokens ?? 2000, messages: [{ role: "user", content: prompt }] },
          opts.meter,
        );
        const text = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
        return { text, engine, model: access.model };
      }
      await assertWithinLimits(orgId, "gemini", opts.meter.agentId);
      const out = await geminiStep(access, { system: "Follow the instructions exactly.", messages: [{ role: "user", content: prompt }], tools: [], maxTokens: opts.maxTokens });
      await recordUsage(opts.meter, "gemini", access.model, { input: out.usage.input_tokens, output: out.usage.output_tokens, cacheRead: out.usage.cache_read_input_tokens });
      const text = out.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
      return { text, engine, model: access.model };
    } catch (e) {
      if (!unavailable(e)) throw e;
      first ??= e;
    }
  }
  throw first ?? new Error(NO_KEY);
}
