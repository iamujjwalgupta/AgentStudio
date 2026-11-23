import { assertSafeUrl } from "./ssrf";
import crypto from "crypto";
import { one, q } from "./db";
import { decrypt } from "./crypto";
import { assertWithinLimits, geminiUsage, recordUsage, type MeterCtx } from "./metering";
import { DEFAULT_PROVIDER, PROVIDERS, PROVIDER_IDS, isProvider, providerOf, type EngineInfo, type ProviderId } from "./providers";

/**
 * The models agents run on, and where their keys come from.
 *
 * Each agent picks a provider (spec.provider: Gemini, Anthropic, OpenAI, Azure
 * OpenAI or an OpenAI-compatible service) and a model; one that picks none runs
 * on Gemini. The keys are the workspace's AI model connections. A run talks to
 * its model one step at a time through modelStep(), which takes and returns the
 * message shape the rest of the app uses (text and tool_use blocks from the
 * assistant, tool_result blocks back), so the run loop, approvals, rehearsals
 * and resume are the same on every provider. Gemini's own reply is kept beside
 * each step (`gemini` on the assistant message) and sent back verbatim, because
 * it carries thought signatures the next request must include.
 *
 * Agents saved before providers were offered may carry an old `engine` field and
 * a model of another provider; both are ignored and they run on Gemini.
 */

export type Engine = ProviderId;
export const ENGINE_LABEL: Record<Engine, string> = Object.fromEntries(PROVIDER_IDS.map((p) => [p, PROVIDERS[p].label])) as Record<Engine, string>;

export const GEMINI_MODEL = "gemini-2.5-flash";
/** The default model, for places that show or export one. */
export const MODEL = GEMINI_MODEL;

const DEFAULT_MODEL: Partial<Record<Engine, string>> = {
  gemini: GEMINI_MODEL,
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-4.1",
};

export const NO_GEMINI_KEY = "No Gemini key is available to this workspace. An admin can add one under Connections.";
export const NO_KEY = NO_GEMINI_KEY;
const noKey = (e: Engine) => `This agent runs on ${ENGINE_LABEL[e]}, and the workspace has no ${ENGINE_LABEL[e]} key. An admin can add one under Connections, or choose another provider in the builder.`;

export type ModelAccess = {
  apiKey: string;
  model: string;
  source: "connection" | "environment";
  /** OpenAI-family: where requests go. Azure: the deployment URL without the operation. */
  baseUrl?: string;
  /** Azure OpenAI: the api-version to send. */
  apiVersion?: string;
  connectionId?: string;
};
export type EngineAccess = ModelAccess & { engine: Engine };

/**
 * Where the Gemini key comes from, in order: the workspace's Gemini connection,
 * then GEMINI_API_KEY on the server. The connection wins so a workspace can
 * bring its own key and its own default model without a redeploy.
 */
export async function geminiAccess(orgId: string): Promise<ModelAccess> {
  const row = await one<any>(`select id, config, secret_enc from connections where org_id = $1 and kind = 'gemini' limit 1`, [orgId]);
  const fromConn = row?.secret_enc ? decrypt(row.secret_enc) : "";
  if (fromConn) return { apiKey: fromConn, model: row.config?.model?.trim() || GEMINI_MODEL, source: "connection", connectionId: row.id };
  const fromEnv = process.env.GEMINI_API_KEY || "";
  if (fromEnv) return { apiKey: fromEnv, model: GEMINI_MODEL, source: "environment" };
  throw new Error(NO_GEMINI_KEY);
}

/** The provider an agent runs on: its own choice, else Gemini. */
export function engineOf(spec?: { provider?: string } | null): Engine {
  return providerOf(spec);
}

/** The Gemini models an agent can be set to; other providers take any model id they serve. */
export const ENGINE_MODELS = { gemini: PROVIDERS.gemini.models.map((m) => m.id) };

const trimSlash = (u: string) => String(u || "").trim().replace(/\/+$/, "");

/**
 * An address an admin typed for a model service (Azure, OpenAI-compatible) may
 * not point inside the network the app runs in, unless ALLOW_PRIVATE_MODEL_URLS
 * is set (a self-hosted Ollama on the same machine or VPC).
 */
export async function assertModelUrl(url: string): Promise<void> {
  if (process.env.ALLOW_PRIVATE_MODEL_URLS === "true") return;
  try {
    await assertSafeUrl(url);
  } catch (e: any) {
    throw new Error(`The model service address is not allowed: ${e?.message || e}. For a self-hosted model on a private address, the platform admin can set ALLOW_PRIVATE_MODEL_URLS=true.`);
  }
}

/**
 * The key, and the model to run, for a provider: the agent's own model when it
 * is one this provider can take (any id for most; only Gemini models for Gemini,
 * so a model saved for another provider falls back), else the default set on
 * the key. `connectionId` picks one OpenAI-compatible connection among several.
 */
export async function engineAccess(orgId: string, engine: Engine = DEFAULT_PROVIDER, model?: string, connectionId?: string): Promise<EngineAccess> {
  const own = model?.trim();
  if (engine === "gemini") {
    const a = await geminiAccess(orgId);
    return { ...a, engine, ...(own && ENGINE_MODELS.gemini.includes(own) ? { model: own } : {}) };
  }
  const row = await one<any>(
    `select id, config, secret_enc from connections
      where org_id = $1 and kind = $2 ${connectionId ? "and id = $3" : ""}
      order by created_at limit 1`,
    connectionId ? [orgId, engine, connectionId] : [orgId, engine],
  );
  const key = row?.secret_enc ? decrypt(row.secret_enc) : "";
  // A self-hosted OpenAI-compatible service (Ollama) may need no key.
  if (!row || (!key && engine !== "openai_compatible")) throw new Error(noKey(engine));
  const c = row.config || {};
  // A model saved for another provider is not sent here; an OpenAI-compatible
  // service (a proxy such as LiteLLM or OpenRouter) may serve any name.
  const ownForThis =
    own && (engine === "openai_compatible" || (!own.startsWith("gemini") && !(engine !== "anthropic" && own.startsWith("claude")))) ? own : "";
  if (engine === "azure_openai") {
    const endpoint = trimSlash(c.endpoint);
    if (!endpoint || !c.deployment) throw new Error("The Azure OpenAI connection needs its endpoint and deployment. An admin can complete it under Connections.");
    await assertModelUrl(endpoint);
    return {
      engine, apiKey: key, source: "connection", connectionId: row.id,
      model: String(c.deployment),
      baseUrl: `${endpoint}/openai/deployments/${encodeURIComponent(String(c.deployment))}`,
      apiVersion: String(c.apiVersion || "2024-10-21"),
    };
  }
  if (engine === "openai_compatible") {
    const baseUrl = trimSlash(c.baseUrl);
    if (!baseUrl) throw new Error("The OpenAI-compatible connection needs its address. An admin can complete it under Connections.");
    await assertModelUrl(baseUrl);
    const m = ownForThis || String(c.model || "").trim();
    if (!m) throw new Error("Choose a model for this agent: the OpenAI-compatible connection has no default model.");
    return { engine, apiKey: key, source: "connection", connectionId: row.id, model: m, baseUrl };
  }
  return {
    engine, apiKey: key, source: "connection", connectionId: row.id,
    model: ownForThis || String(c.model || "").trim() || DEFAULT_MODEL[engine]!,
    ...(engine === "openai" ? { baseUrl: "https://api.openai.com/v1" } : {}),
  };
}

export type { EngineInfo } from "./providers";

/** The providers this workspace has keys for, each with the model it would use by default. */
export async function enginesFor(orgId: string): Promise<EngineInfo[]> {
  const out: EngineInfo[] = [];
  try {
    out.push({ id: "gemini", label: ENGINE_LABEL.gemini, model: (await geminiAccess(orgId)).model });
  } catch {
    /* no Gemini key */
  }
  const rows = await q<any>(
    `select id, name, kind, config from connections
      where org_id = $1 and kind in ('anthropic', 'openai', 'azure_openai', 'openai_compatible') and (secret_enc is not null or kind = 'openai_compatible')
      order by kind, created_at`,
    [orgId],
  );
  for (const r of rows) {
    const e = r.kind as Engine;
    const c = r.config || {};
    out.push({
      id: e,
      label: e === "openai_compatible" ? r.name : ENGINE_LABEL[e],
      model: e === "azure_openai" ? String(c.deployment || "") : String(c.model || DEFAULT_MODEL[e] || ""),
      connectionId: r.id,
      connectionName: r.name,
      ...(c.preset ? { preset: String(c.preset) } : {}),
    });
  }
  return out;
}

// ---- one step of a run ------------------------------------------------------------------

export type StepIn = {
  system: string;
  messages: any[];
  /** Tool definitions: { name, description, input_schema } (lib/tools modelTools). */
  tools: any[];
  maxTokens?: number;
};
export type StepOut = {
  content: any[];
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
  /** Gemini's own parts for this reply, to send back on the next step. */
  gemini?: any[];
  /** Set when this step was answered by a different model from the agent's (see geminiStep). */
  model?: string;
};

/** One model step: the conversation so far in, the model's reply out. */
export async function modelStep(access: EngineAccess, input: StepIn): Promise<StepOut> {
  if (access.engine === "anthropic") return withRetries(() => anthropicOnce(access, input), input, (i) => anthropicOnce(access, i));
  if (access.engine === "openai" || access.engine === "azure_openai" || access.engine === "openai_compatible") {
    return withRetries(() => openaiOnce(access, input), input, (i) => openaiOnce(access, i));
  }
  return geminiStep(access, input);
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

/** The conversation in Gemini's terms: user/model turns of parts, tool results as functionResponse. */
function toGeminiContents(messages: any[], plain = false) {
  const nameOf = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const b of m.content) if (b.type === "tool_use") nameOf.set(b.id, b.name);
    }
  }
  const contents: any[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      // Gemini's own parts carry thought signatures, which only the model that wrote them accepts.
      const parts = !plain && Array.isArray(m.gemini) && m.gemini.length
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
  // service fault (waiting a little longer each time).
  for (let attempt = 0, transient = 0; attempt < 7; attempt++) {
    try {
      const messages = unusable
        ? [
            ...input.messages,
            {
              role: "user",
              content:
                "Your last reply could not be used: it was empty, or its tool call was malformed. Carry on with the work: make the next tool call again with valid arguments, using only the tools you were given. If the arguments were very long, shorten them — for example refer to work you saved earlier instead of repeating it.",
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
      // A Flash model that cannot form a large tool call after being asked
      // twice usually can on Pro. That one step goes to Pro, so the run is not
      // lost at its last step; the next step is back on the agent's own model.
      if (e?.retry && /flash/.test(access.model) && unusable === 2) {
        unusable++;
        const stronger = "gemini-2.5-pro";
        const out = await geminiOnce({ ...access, model: stronger }, input, true).catch(() => null);
        if (out) return { ...out, gemini: undefined, model: stronger };
      }
      throw e;
    }
  }
  throw last;
}

async function geminiOnce(access: EngineAccess, { system, messages, tools, maxTokens }: StepIn, plain = false): Promise<StepOut> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(access.model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": access.apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: toGeminiContents(messages, plain),
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
              // Held to the declared functions and their schemas. Without this,
              // Flash splits a large call into made-up ones ("PresentResultKpis")
              // or returns a malformed call about one time in three; with it,
              // it still answers in plain text when it is done.
              toolConfig: { functionCallingConfig: { mode: "VALIDATED" } },
            }
          : {}),
        // Gemini's thinking counts against the output budget, so it gets plenty of room.
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


// ---- Anthropic and the OpenAI family ------------------------------------------------------

const RETRY_NOTE =
  "Your last reply could not be used: it was empty, or its tool call was malformed. Carry on with the work: make the next tool call again with valid arguments, using only the tools you were given. If the arguments were very long, shorten them — for example refer to work you saved earlier instead of repeating it.";

/**
 * The same patience as Gemini's: a passing network or service fault is retried
 * up to 4 times, waiting a little longer each time; an unusable reply (empty,
 * or a tool call whose arguments are not valid JSON) is asked again, up to
 * twice, with a note that is not kept in the transcript.
 */
async function withRetries(first: () => Promise<StepOut>, input: StepIn, again: (i: StepIn) => Promise<StepOut>): Promise<StepOut> {
  let transient = 0;
  let unusable = 0;
  let call = first;
  for (;;) {
    try {
      return await call();
    } catch (e: any) {
      if (e?.transient && transient < 4) {
        transient++;
        await new Promise((r) => setTimeout(r, 1500 * 2 ** (transient - 1)));
        continue;
      }
      if (e?.retry && unusable < 2) {
        unusable++;
        const withNote = { ...input, messages: [...input.messages, { role: "user", content: RETRY_NOTE }] };
        call = () => again(withNote);
        continue;
      }
      throw e;
    }
  }
}

function plainProviderError(label: string, status: number, message: string): Error {
  let text: string;
  const m = message || "";
  if (/credit balance is too low|insufficient_quota|exceeded your current quota|billing/i.test(m)) {
    text = `The ${label} account behind this workspace's key has run out of credit or quota. An admin can add credit with ${label}, or choose another provider for the agent.`;
  } else if (status === 401 || /invalid.*(api.?key|x-api-key)|incorrect api key|authentication/i.test(m)) {
    text = `The workspace's ${label} key was rejected. An admin can check or replace it under Connections.`;
  } else if (status === 403) {
    text = `The workspace's ${label} key is not allowed to do this (${m.slice(0, 160)}).`;
  } else if (status === 404) {
    text = `${label} does not know that model or deployment (${m.slice(0, 160)}). Check the model in the builder, or the deployment under Connections.`;
  } else if (status === 429) {
    text = `${label} is rate-limiting this workspace's key. Wait a minute and try again.`;
  } else if (status >= 500) {
    text = `${label} is unavailable right now. Try again in a few minutes.`;
  } else {
    text = `The model call failed (${status}): ${m.slice(0, 300)}`;
  }
  return Object.assign(new Error(text), { status, transient: status === 429 || status >= 500 });
}

async function postJson(url: string, headers: Record<string, string>, body: any, label: string): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  }).catch((e: any) => {
    throw Object.assign(new Error(`Could not reach ${label}: ${e?.message || e}`), { transient: true });
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw plainProviderError(label, res.status, data?.error?.message || data?.message || `HTTP ${res.status}`);
  return data;
}

/** Anthropic's Messages API. The app's message shape is Anthropic's, so little changes. */
async function anthropicOnce(access: EngineAccess, { system, messages, tools, maxTokens }: StepIn): Promise<StepOut> {
  const data = await postJson(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": access.apiKey, "anthropic-version": "2023-06-01" },
    {
      model: access.model,
      max_tokens: Math.max(4096, maxTokens ?? 0),
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      // Gemini's saved parts are ours, not Anthropic's: never sent.
      messages: messages.map(({ gemini, ...m }: any) => m),
      ...(tools.length ? { tools } : {}),
    },
    "Anthropic",
  );
  const content = (data.content || []).filter((b: any) => b.type === "text" || b.type === "tool_use");
  if (!content.length) throw Object.assign(new Error("Anthropic returned an empty reply. Try the run again."), { retry: true });
  return {
    content,
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
      cache_read_input_tokens: data.usage?.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: data.usage?.cache_creation_input_tokens ?? 0,
    },
  };
}

/** The conversation as OpenAI chat messages: tool calls on the assistant turn, one tool message per result. */
function toOpenAIMessages(system: string, messages: any[]) {
  const out: any[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "assistant") {
      const blocks: any[] = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content ?? "") }];
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const calls = blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else if (typeof m.content === "string") {
      out.push({ role: "user", content: m.content || "Begin." });
    } else {
      for (const b of m.content || []) {
        if (b.type === "tool_result") {
          const body = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
          out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.is_error ? `Error: ${body}` : body });
        } else if (b.type === "text" && b.text) {
          out.push({ role: "user", content: b.text });
        }
      }
    }
  }
  return out;
}

/** OpenAI's Chat Completions, and the services that speak it (Azure OpenAI, Mistral, Groq, Ollama …). */
async function openaiOnce(access: EngineAccess, { system, messages, tools, maxTokens }: StepIn): Promise<StepOut> {
  const label = access.engine === "azure_openai" ? "Azure OpenAI" : access.engine === "openai" ? "OpenAI" : "The model service";
  const body: any = {
    messages: toOpenAIMessages(system, messages),
    ...(tools.length
      ? { tools: tools.map((t: any) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })) }
      : {}),
  };
  let url: string;
  const headers: Record<string, string> = {};
  if (access.engine === "azure_openai") {
    url = `${access.baseUrl}/chat/completions?api-version=${encodeURIComponent(access.apiVersion || "2024-10-21")}`;
    headers["api-key"] = access.apiKey;
    // Newer models (o-series, GPT-5) take only max_completion_tokens, and only the default temperature.
    body.max_completion_tokens = Math.max(8192, maxTokens ?? 0);
  } else {
    url = `${access.baseUrl}/chat/completions`;
    if (access.apiKey) headers.authorization = `Bearer ${access.apiKey}`;
    body.model = access.model;
    if (access.engine === "openai") body.max_completion_tokens = Math.max(8192, maxTokens ?? 0);
    else {
      body.max_tokens = Math.max(4096, maxTokens ?? 0);
      body.temperature = 0.2;
    }
  }
  const data = await postJson(url, headers, body, label);
  const msg = data.choices?.[0]?.message || {};
  const content: any[] = [];
  if (typeof msg.content === "string" && msg.content.trim()) content.push({ type: "text", text: msg.content });
  for (const c of msg.tool_calls || []) {
    let input: any = {};
    try {
      input = c.function?.arguments ? JSON.parse(c.function.arguments) : {};
    } catch {
      throw Object.assign(new Error(`${label} sent a tool call whose arguments were not valid JSON.`), { retry: true });
    }
    content.push({ type: "tool_use", id: c.id || "call_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), name: c.function?.name, input });
  }
  if (!content.length) {
    const why = data.choices?.[0]?.finish_reason;
    throw Object.assign(new Error(`${label} returned an empty reply${why && why !== "stop" ? ` (${why})` : ""}. Try the run again.`), { retry: true, finish: why });
  }
  const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    content,
    usage: {
      input_tokens: Math.max(0, (data.usage?.prompt_tokens ?? 0) - cached),
      output_tokens: data.usage?.completion_tokens ?? 0,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0,
    },
  };
}

// ---- drafting -------------------------------------------------------------------------------

/** Failures that mean "this key can't be used right now", as opposed to a bad request. */
const unavailable = (e: any) =>
  /has no .* key|No Gemini key|run out of credit|was rejected|not allowed|rate-limiting|rate limit|quota|unavailable|needs its/i.test(String(e?.message || e));

// ---- the workspace AI key ---------------------------------------------------------------------

/**
 * The one model key the platform's own drafting runs on (an agent from a brief,
 * a skill from a sentence or a correction), chosen by a workspace admin. Strict:
 * when it can't be used, drafting stops rather than trying another key, so an
 * admin decides where the workspace's briefs are sent. Agents still run on the
 * key they were set to; this is only their starting choice.
 *
 * Stored on orgs.ai_key: null until first read, {} when none is chosen, else
 * {"provider":"anthropic","connectionId":"…"} or {"provider":"gemini","source":"environment"}
 * for the server's own GEMINI_API_KEY.
 */
export type WorkspaceKey = { provider: Engine; connectionId?: string; source?: "environment" };

/** A workspace key option for the admin picker: "env" or a connection id. */
export type WorkspaceKeyOption = { value: string; provider: Engine; label: string; model: string };

const WORKSPACE_KEY_MEMBER_MSG = "Drafting is unavailable because the workspace AI key isn't working. Ask a workspace admin.";

/** Drafting could not use the workspace key. The message is for anyone; `adminDetail` names the cause, for admins. */
export class WorkspaceKeyError extends Error {
  adminDetail: string;
  constructor(adminDetail: string) {
    super(WORKSPACE_KEY_MEMBER_MSG);
    this.adminDetail = adminDetail;
  }
}

/** What a route shows when drafting failed: the cause to admins, the generic line to everyone else. */
export function draftingError(e: any, isAdmin: boolean, fallback: string): string {
  if (e?.adminDetail) return isAdmin ? String(e.adminDetail) : String(e.message || WORKSPACE_KEY_MEMBER_MSG);
  return e?.message || fallback;
}

const asWorkspaceKey = (v: any): WorkspaceKey | null =>
  v && isProvider(v.provider) && (v.source === "environment" || typeof v.connectionId === "string")
    ? { provider: v.provider, ...(v.source === "environment" ? { source: "environment" as const } : { connectionId: v.connectionId }) }
    : null;

/**
 * Before an admin has chosen, a workspace keeps drafting where it did before
 * the setting existed: its Gemini key, the server's Gemini key, then its first
 * other model key. Recorded once, so from then on only an admin changes it.
 */
async function seedWorkspaceKey(orgId: string): Promise<WorkspaceKey | null> {
  let seed: WorkspaceKey | null = null;
  const gemini = await one<any>(
    `select id from connections where org_id = $1 and kind = 'gemini' and secret_enc is not null order by created_at limit 1`,
    [orgId],
  );
  if (gemini) seed = { provider: "gemini", connectionId: gemini.id };
  else if (process.env.GEMINI_API_KEY) seed = { provider: "gemini", source: "environment" };
  else {
    const other = await one<any>(
      `select id, kind from connections
        where org_id = $1 and kind in ('anthropic', 'openai', 'azure_openai', 'openai_compatible')
          and (secret_enc is not null or kind = 'openai_compatible')
        order by array_position(array['anthropic', 'openai', 'azure_openai', 'openai_compatible'], kind), created_at
        limit 1`,
      [orgId],
    );
    if (other) seed = { provider: other.kind, connectionId: other.id };
  }
  // Only the first reader seeds; a concurrent one takes what was written.
  const row = await one<any>(`update orgs set ai_key = $2 where id = $1 and ai_key is null returning ai_key`, [orgId, JSON.stringify(seed ?? {})]);
  if (row) return asWorkspaceKey(row.ai_key);
  const now = await one<any>(`select ai_key from orgs where id = $1`, [orgId]);
  return asWorkspaceKey(now?.ai_key);
}

/** The workspace key an admin chose (or the one it was seeded with), or null when there is none. */
export async function workspaceKey(orgId: string): Promise<WorkspaceKey | null> {
  const row = await one<any>(`select ai_key from orgs where id = $1`, [orgId]);
  if (row && row.ai_key == null) return seedWorkspaceKey(orgId);
  return asWorkspaceKey(row?.ai_key);
}

/** Records an admin's choice. */
export async function setWorkspaceKey(orgId: string, key: WorkspaceKey): Promise<void> {
  await q(`update orgs set ai_key = $2 where id = $1`, [orgId, JSON.stringify(key)]);
}

/** The keys an admin can choose from: the server's Gemini key when set, and each usable model connection. */
export async function workspaceKeyOptions(orgId: string): Promise<WorkspaceKeyOption[]> {
  const out: WorkspaceKeyOption[] = [];
  if (process.env.GEMINI_API_KEY) out.push({ value: "env", provider: "gemini", label: "Server Gemini key (GEMINI_API_KEY)", model: GEMINI_MODEL });
  const rows = await q<any>(
    `select id, name, kind, config from connections
      where org_id = $1 and kind in ('gemini', 'anthropic', 'openai', 'azure_openai', 'openai_compatible')
        and (secret_enc is not null or kind = 'openai_compatible')
      order by array_position(array['gemini', 'anthropic', 'openai', 'azure_openai', 'openai_compatible'], kind), created_at`,
    [orgId],
  );
  for (const r of rows) {
    const e = r.kind as Engine;
    const c = r.config || {};
    out.push({
      value: r.id,
      provider: e,
      label: `${ENGINE_LABEL[e]} · ${r.name}`,
      model: e === "azure_openai" ? String(c.deployment || "") : String(c.model || DEFAULT_MODEL[e] || ""),
    });
  }
  return out;
}

/** The key an option value stands for, or null when it is not one of this workspace's model keys. */
export async function workspaceKeyFor(orgId: string, value: string): Promise<WorkspaceKey | null> {
  if (value === "env") return process.env.GEMINI_API_KEY ? { provider: "gemini", source: "environment" } : null;
  const row = await one<any>(
    `select id, kind from connections where id::text = $1 and org_id = $2 and kind in ('gemini', 'anthropic', 'openai', 'azure_openai', 'openai_compatible')`,
    [value, orgId],
  );
  return row ? { provider: row.kind, connectionId: row.id } : null;
}

/** Credentials for exactly this key: that connection, or the server's Gemini key. Never another. */
export async function workspaceKeyAccess(orgId: string, key: WorkspaceKey): Promise<EngineAccess> {
  if (key.source === "environment") {
    const apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("the server's Gemini key (GEMINI_API_KEY) is no longer set");
    return { engine: "gemini", apiKey, model: GEMINI_MODEL, source: "environment" };
  }
  const row = await one<any>(`select id, kind, config, secret_enc from connections where id::text = $1 and org_id = $2`, [key.connectionId, orgId]);
  if (!row || row.kind !== key.provider) throw new Error("the chosen connection no longer exists");
  if (row.kind === "gemini") {
    // engineAccess would fall back to the server key; the workspace key must not.
    const apiKey = row.secret_enc ? decrypt(row.secret_enc) : "";
    if (!apiKey) throw new Error("the chosen Gemini connection has no key");
    return { engine: "gemini", apiKey, model: row.config?.model?.trim() || GEMINI_MODEL, source: "connection", connectionId: row.id };
  }
  return engineAccess(orgId, row.kind as Engine, undefined, row.id);
}

/** Proves a workspace key before an admin saves it. Gemini is proved by listing models, as on Connections. */
export async function testWorkspaceKey(access: EngineAccess): Promise<{ ok: boolean; detail: string }> {
  if (access.engine !== "gemini") return testModelKey(access);
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": access.apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return { ok: true, detail: `Google Gemini accepted the key on ${access.model}` };
    return { ok: false, detail: res.status === 400 || res.status === 403 ? "The API key was rejected." : `Gemini returned HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, detail: String(e?.message || e).slice(0, 300) };
  }
}

/**
 * One piece of drafting text (an agent from a brief, a skill from a sentence):
 * on the workspace AI key and nothing else. A key that can't be used (none
 * chosen, removed, out of credit, rejected) stops drafting with a
 * WorkspaceKeyError; a real error in the request passes through as it is.
 */
export async function draftText(
  orgId: string,
  prompt: string,
  opts: { maxTokens?: number; meter: MeterCtx },
): Promise<{ text: string; engine: Engine; model: string }> {
  const key = await workspaceKey(orgId);
  if (!key) throw new WorkspaceKeyError("No workspace AI key is chosen, so drafting is off. Choose one under Connections → Workspace AI key.");
  const label = key.source === "environment" ? "the server's Gemini key" : ENGINE_LABEL[key.provider];
  let access: EngineAccess;
  try {
    access = await workspaceKeyAccess(orgId, key);
  } catch (e: any) {
    throw new WorkspaceKeyError(`The workspace AI key (${label}) can't be used: ${e?.message || e}. Change it under Connections → Workspace AI key.`);
  }
  await assertWithinLimits(orgId, access.engine, opts.meter.agentId);
  let out: StepOut;
  try {
    out = await modelStep(access, { system: "Follow the instructions exactly.", messages: [{ role: "user", content: prompt }], tools: [], maxTokens: opts.maxTokens });
  } catch (e: any) {
    if (!unavailable(e)) throw e;
    throw new WorkspaceKeyError(`The workspace AI key (${label}) is unavailable: ${String(e?.message || e).slice(0, 300)} Change it under Connections → Workspace AI key.`);
  }
  await recordUsage(opts.meter, access.engine, out.model ?? access.model, {
    input: out.usage.input_tokens,
    output: out.usage.output_tokens,
    cacheRead: out.usage.cache_read_input_tokens,
    cacheWrite: out.usage.cache_creation_input_tokens,
  });
  const text = out.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  return { text, engine: access.engine, model: access.model };
}

/**
 * Proves a model key works the way an agent run will use it: one tiny request
 * to the provider, on the model (or deployment) agents get by default. A reply
 * that comes back empty still proves the key, address and model were accepted.
 */
export async function testModelKey(access: EngineAccess): Promise<{ ok: boolean; detail: string }> {
  const label = access.engine === "openai_compatible" ? "The service" : ENGINE_LABEL[access.engine];
  const step: StepIn = { system: "Reply with the single word OK.", messages: [{ role: "user", content: "Connection test." }], tools: [], maxTokens: 256 };
  try {
    if (access.engine === "anthropic") await anthropicOnce(access, step);
    else await openaiOnce(access, step);
    return { ok: true, detail: `${label} answered on ${access.model}` };
  } catch (e: any) {
    if (e?.retry) return { ok: true, detail: `${label} accepted the key on ${access.model}` };
    return { ok: false, detail: String(e?.message || e).slice(0, 300) };
  }
}
