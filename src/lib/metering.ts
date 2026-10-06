import { one, q } from "./db";
import { notify, approverEmails } from "./notify";
import { costOf } from "./pricing";

/**
 * Token metering: every model call is recorded in usage_events, and checked
 * against the workspace's limits before it is made.
 *
 * Limits sit on a model key (the Anthropic or the Gemini key) or on one agent,
 * per calendar month or day in the workspace timezone, in tokens and/or dollars;
 * whichever is reached first applies. At a limit, new calls on that key or by
 * that agent are refused until the limit is raised or the period turns.
 *
 * "Tokens" counts everything the model processed: input, output, and cached
 * input read or written.
 */

export type Provider = "anthropic" | "gemini";
export type Feature = "agent_run" | "drafting" | "skill_writing" | "web_search" | "sandbox" | "key_test";

export const FEATURE_LABEL: Record<Feature, string> = {
  agent_run: "Agent runs",
  drafting: "Drafting agents",
  skill_writing: "Writing skills",
  web_search: "Web search action",
  sandbox: "Sandbox",
  key_test: "Key tests",
};
export const PROVIDER_LABEL: Record<Provider, string> = { anthropic: "Anthropic (Claude)", gemini: "Google Gemini" };

export type MeterCtx = {
  orgId: string;
  feature: Feature;
  agentId?: string | null;
  runId?: string | null;
  userId?: string | null;
};

export type TokenUsage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };

export type LimitRow = {
  scope: "provider" | "agent";
  target: string;
  period: "month" | "day";
  max_tokens: number | null;
  max_usd: number | null;
  updated_by?: string | null;
  updated_at?: string;
};

export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

/** Starts of the current month and day, as instants, in the workspace timezone. */
export async function periodStarts(orgId: string): Promise<{ month: Date; day: Date; nextMonth: Date; nextDay: Date }> {
  const r = await one<any>(
    `select date_trunc('month', now() at time zone tz) at time zone tz as month,
            date_trunc('day', now() at time zone tz) at time zone tz as day,
            (date_trunc('month', now() at time zone tz) + interval '1 month') at time zone tz as next_month,
            (date_trunc('day', now() at time zone tz) + interval '1 day') at time zone tz as next_day
       from (select coalesce(timezone, 'UTC') as tz from orgs where id = $1) o`,
    [orgId],
  );
  const now = new Date();
  return {
    month: r?.month ?? new Date(now.getFullYear(), now.getMonth(), 1),
    day: r?.day ?? new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    nextMonth: r?.next_month ?? new Date(now.getFullYear(), now.getMonth() + 1, 1),
    nextDay: r?.next_day ?? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
  };
}

export async function limitsFor(orgId: string): Promise<LimitRow[]> {
  return q<LimitRow>(
    `select scope, target, period, max_tokens::float8 as max_tokens, max_usd::float8 as max_usd, updated_by, updated_at
       from usage_limits where org_id = $1 order by scope, target, period`,
    [orgId],
  );
}

/** Tokens and dollars used against one limit since a moment. */
export async function usedSince(orgId: string, l: Pick<LimitRow, "scope" | "target">, from: Date): Promise<{ tokens: number; usd: number }> {
  const r = await one<any>(
    `select coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0)::float8 as tokens,
            coalesce(sum(cost_usd), 0)::float8 as usd
       from usage_events
      where org_id = $1 and at >= $2 and ${l.scope === "provider" ? "provider = $3" : "agent_id = $3::uuid"}`,
    [orgId, from, l.target],
  );
  return { tokens: r?.tokens ?? 0, usd: r?.usd ?? 0 };
}

/** How far into a limit usage is, 0–1+; the larger of the token and dollar shares. */
export const shareOf = (l: Pick<LimitRow, "max_tokens" | "max_usd">, used: { tokens: number; usd: number }) =>
  Math.max(l.max_tokens ? used.tokens / l.max_tokens : 0, l.max_usd ? used.usd / l.max_usd : 0);

function describe(l: LimitRow, agentName?: string) {
  const who = l.scope === "provider" ? `The ${PROVIDER_LABEL[l.target as Provider] ?? l.target} key` : `The agent “${agentName ?? "this agent"}”`;
  return `${who} has reached its ${l.period === "day" ? "daily" : "monthly"} usage limit`;
}

/**
 * Whether a call on this key, by this agent, may go ahead. Checked before every
 * model call, so a long run cannot carry the workspace past a limit.
 */
export async function checkLimits(
  orgId: string,
  provider: Provider,
  agentId?: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const limits = (await limitsFor(orgId)).filter(
    (l) => (l.scope === "provider" && l.target === provider) || (l.scope === "agent" && !!agentId && l.target === agentId),
  );
  if (!limits.length) return { ok: true };
  const starts = await periodStarts(orgId);
  for (const l of limits) {
    const from = l.period === "day" ? starts.day : starts.month;
    const used = await usedSince(orgId, l, from);
    if (shareOf(l, used) >= 1) {
      const agentName = l.scope === "agent" ? (await one<any>(`select name from agents where id = $1`, [l.target]))?.name : undefined;
      await announce(orgId, l, 100, from, used, agentName);
      return {
        ok: false,
        reason: `${describe(l, agentName)}, so the call was stopped. An admin can raise it under Usage & limits, or it resets ${l.period === "day" ? "tomorrow" : "next month"}.`,
      };
    }
  }
  return { ok: true };
}

export async function assertWithinLimits(orgId: string, provider: Provider, agentId?: string | null) {
  const r = await checkLimits(orgId, provider, agentId);
  if (!r.ok) throw new LimitError(r.reason);
}

/** Tells the owner and admins once per threshold per period. */
async function announce(orgId: string, l: LimitRow, level: 80 | 100, from: Date, used: { tokens: number; usd: number }, agentName?: string) {
  const detail =
    `${Math.round(used.tokens).toLocaleString("en-US")} tokens · $${used.usd.toFixed(2)}` +
    ` of ${[l.max_tokens ? `${Math.round(l.max_tokens).toLocaleString("en-US")} tokens` : "", l.max_usd ? `$${Number(l.max_usd).toFixed(2)}` : ""].filter(Boolean).join(" / ")}`;
  const row = await one<any>(
    `insert into usage_alerts (org_id, scope, target, period, level, period_start, detail)
     values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing returning id`,
    [orgId, l.scope, l.target, l.period, level, from, detail],
  );
  if (!row) return;
  const name = l.scope === "provider" ? `The ${PROVIDER_LABEL[l.target as Provider] ?? l.target} key` : `The agent “${agentName ?? "an agent"}”`;
  await notify(orgId, {
    event: "spend_cap",
    to: await approverEmails(orgId),
    subject: level === 100 ? `${name} has reached its usage limit` : `${name} has used 80% of its usage limit`,
    body:
      `${name} has used ${detail} this ${l.period}.\n\n` +
      (level === 100
        ? "New model calls on it are being refused until the limit is raised under Usage & limits, or the period turns."
        : "Nothing is blocked yet. Review it under Usage & limits if this is more than expected."),
  }).catch(() => {});
}

/** Records one model call, then checks whether it crossed a warning threshold. */
export async function recordUsage(ctx: MeterCtx, provider: Provider, model: string, u: TokenUsage) {
  const usage = {
    inputTokens: u.input ?? 0,
    outputTokens: u.output ?? 0,
    cacheReadTokens: u.cacheRead ?? 0,
    cacheWriteTokens: u.cacheWrite ?? 0,
  };
  if (!usage.inputTokens && !usage.outputTokens && !usage.cacheReadTokens && !usage.cacheWriteTokens) return;
  const cost = costOf({ model, ...usage });
  try {
    await q(
      `insert into usage_events (org_id, provider, model, feature, agent_id, run_id, user_id,
                                 input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        ctx.orgId, provider, model || "", ctx.feature, ctx.agentId || null, ctx.runId || null, ctx.userId || null,
        usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, cost,
      ],
    );
    // Warnings at 80%; the 100% notice comes from the check that refuses the next call.
    const limits = (await limitsFor(ctx.orgId)).filter(
      (l) => (l.scope === "provider" && l.target === provider) || (l.scope === "agent" && !!ctx.agentId && l.target === ctx.agentId),
    );
    if (!limits.length) return;
    const starts = await periodStarts(ctx.orgId);
    for (const l of limits) {
      const from = l.period === "day" ? starts.day : starts.month;
      const used = await usedSince(ctx.orgId, l, from);
      const share = shareOf(l, used);
      if (share >= 0.8 && share < 1) {
        const agentName = l.scope === "agent" ? (await one<any>(`select name from agents where id = $1`, [l.target]))?.name : undefined;
        await announce(ctx.orgId, l, 80, from, used, agentName);
      }
    }
  } catch {
    // Metering must never break the work it measures.
  }
}

/** An Anthropic Messages call, checked against the limits first and recorded after. */
/**
 * An Anthropic API failure in words a workspace admin can act on, instead of
 * the raw "400 {"type":"error",...}" the SDK puts in its message.
 */
export function plainModelError(e: any): Error {
  const status = Number(e?.status) || 0;
  const detail = String(e?.error?.error?.message || e?.message || e || "");
  let text: string;
  if (/credit balance is too low/i.test(detail)) {
    text = "The Anthropic account behind this workspace's key has run out of credit. An admin can add credit in the Anthropic Console (Plans & Billing), or set a different key under Connections.";
  } else if (status === 401 || /invalid x-api-key|authentication/i.test(detail)) {
    text = "The workspace's Anthropic key was rejected. An admin can check or replace it under Connections.";
  } else if (status === 403) {
    text = "The workspace's Anthropic key is not allowed to do this. An admin can check its permissions in the Anthropic Console.";
  } else if (status === 429) {
    text = "Anthropic is rate-limiting this workspace's key. Wait a minute and try again.";
  } else if (status === 529 || /overloaded/i.test(detail)) {
    text = "Anthropic is overloaded right now. Try again in a few minutes.";
  } else if (status) {
    text = `The model call failed (${status}): ${detail.replace(/^\d{3}\s+/, "").slice(0, 300)}`;
  } else {
    return e instanceof Error ? e : new Error(detail || "The model call failed.");
  }
  return Object.assign(new Error(text), { status });
}

export async function meteredAnthropic<T = any>(client: any, params: any, ctx: MeterCtx): Promise<T> {
  await assertWithinLimits(ctx.orgId, "anthropic", ctx.agentId);
  const res = await client.messages.create(params).catch((e: any) => {
    throw plainModelError(e);
  });
  await recordUsage(ctx, "anthropic", params.model, {
    input: res?.usage?.input_tokens,
    output: res?.usage?.output_tokens,
    cacheRead: res?.usage?.cache_read_input_tokens,
    cacheWrite: res?.usage?.cache_creation_input_tokens,
  });
  return res as T;
}

/** Usage out of a raw Anthropic HTTP response body (for calls made with fetch). */
export const anthropicUsage = (body: any): TokenUsage => ({
  input: body?.usage?.input_tokens,
  output: body?.usage?.output_tokens,
  cacheRead: body?.usage?.cache_read_input_tokens,
  cacheWrite: body?.usage?.cache_creation_input_tokens,
});

/** Usage out of a Gemini generateContent response body. */
export const geminiUsage = (body: any): TokenUsage => ({
  input: (body?.usageMetadata?.promptTokenCount ?? 0) - (body?.usageMetadata?.cachedContentTokenCount ?? 0),
  output: (body?.usageMetadata?.candidatesTokenCount ?? 0) + (body?.usageMetadata?.thoughtsTokenCount ?? 0),
  cacheRead: body?.usageMetadata?.cachedContentTokenCount ?? 0,
});
