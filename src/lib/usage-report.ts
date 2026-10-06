import { one, q } from "./db";
import { rateFor } from "./pricing";
import { FEATURE_LABEL, limitsFor, periodStarts, shareOf, usedSince, type Feature, type LimitRow, type Provider } from "./metering";

/**
 * What the Usage & limits page shows, from usage_events: this month's totals per
 * model key, each limit and how far into it the workspace is, a daily series,
 * breakdowns by agent, feature, person and model, the heaviest runs, and the
 * alerts that have been sent.
 */

export type LimitStatus = LimitRow & {
  name: string;
  used: { tokens: number; usd: number };
  share: number;
  resetsAt: string;
};

export type ProviderSummary = {
  provider: Provider;
  configured: boolean;
  calls: number;
  runs: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  usd: number;
  /** Straight-line projection to the end of the month. */
  projectedTokens: number;
  projectedUsd: number;
  /** Dollars saved by cached input, against paying the full input rate. */
  cacheSavingsUsd: number;
  today: { tokens: number; usd: number };
};

export type UsageOverview = {
  monthStart: string;
  nextMonth: string;
  providers: ProviderSummary[];
  limits: LimitStatus[];
  daily: { day: string; provider: Provider; input: number; output: number; cache: number; usd: number }[];
  byAgent: { id: string; name: string; status: string; tokens: number; usd: number; calls: number; runs: number }[];
  byFeature: { feature: Feature; label: string; tokens: number; usd: number; calls: number }[];
  byUser: { id: string | null; name: string; tokens: number; usd: number; calls: number }[];
  byModel: { provider: Provider; model: string; tokens: number; usd: number; calls: number }[];
  heaviestRuns: { id: string; agent_id: string | null; agent: string; status: string; started_at: string; tokens: number; usd: number }[];
  alerts: { scope: string; target: string; name: string; period: string; level: number; detail: string; at: string }[];
  agents: { id: string; name: string }[];
};

const TOKENS = "(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens)";

export async function usageOverview(orgId: string, days = 30): Promise<UsageOverview> {
  const starts = await periodStarts(orgId);
  const from = starts.month;
  const monthMs = starts.nextMonth.getTime() - starts.month.getTime();
  const elapsed = Math.max(0.02, Math.min(1, (Date.now() - starts.month.getTime()) / monthMs));

  const [keys, perProvider, perModelMonth, today, daily, byAgent, byFeature, byUser, byModel, heaviest, alerts, agents, limits] =
    await Promise.all([
      q<any>(`select kind from connections where org_id = $1 and kind in ('anthropic', 'gemini') and secret_enc is not null`, [orgId]),
      q<any>(
        `select provider, count(*)::int as calls, count(distinct run_id)::int as runs,
                coalesce(sum(input_tokens), 0)::float8 as input, coalesce(sum(output_tokens), 0)::float8 as output,
                coalesce(sum(cache_read_tokens), 0)::float8 as cache_read, coalesce(sum(cache_write_tokens), 0)::float8 as cache_write,
                coalesce(sum(${TOKENS}), 0)::float8 as tokens, coalesce(sum(cost_usd), 0)::float8 as usd
           from usage_events where org_id = $1 and at >= $2 group by provider`,
        [orgId, from],
      ),
      q<any>(
        `select model, coalesce(sum(cache_read_tokens), 0)::float8 as cache_read, provider
           from usage_events where org_id = $1 and at >= $2 group by model, provider`,
        [orgId, from],
      ),
      q<any>(
        `select provider, coalesce(sum(${TOKENS}), 0)::float8 as tokens, coalesce(sum(cost_usd), 0)::float8 as usd
           from usage_events where org_id = $1 and at >= $2 group by provider`,
        [orgId, starts.day],
      ),
      q<any>(
        `with tz as (select coalesce(timezone, 'UTC') as tz from orgs where id = $1),
              d as (select generate_series(date_trunc('day', now() at time zone (select tz from tz)) - ($2::int - 1) * interval '1 day',
                                           date_trunc('day', now() at time zone (select tz from tz)), interval '1 day') as day)
         select to_char(d.day, 'YYYY-MM-DD') as day, p.provider,
                coalesce(sum(e.input_tokens), 0)::float8 as input, coalesce(sum(e.output_tokens), 0)::float8 as output,
                coalesce(sum(e.cache_read_tokens + e.cache_write_tokens), 0)::float8 as cache, coalesce(sum(e.cost_usd), 0)::float8 as usd
           from d cross join (values ('anthropic'), ('gemini')) as p(provider)
           left join usage_events e
             on e.org_id = $1 and e.provider = p.provider
            and date_trunc('day', e.at at time zone (select tz from tz)) = d.day
          group by d.day, p.provider order by d.day`,
        [orgId, days],
      ),
      q<any>(
        `select a.id, a.name, a.status, coalesce(sum(${TOKENS.replace(/(\w+_tokens)/g, "e.$1")}), 0)::float8 as tokens,
                coalesce(sum(e.cost_usd), 0)::float8 as usd, count(*)::int as calls, count(distinct e.run_id)::int as runs
           from usage_events e join agents a on a.id = e.agent_id
          where e.org_id = $1 and e.at >= $2
          group by a.id, a.name, a.status order by tokens desc limit 25`,
        [orgId, from],
      ),
      q<any>(
        `select feature, coalesce(sum(${TOKENS}), 0)::float8 as tokens, coalesce(sum(cost_usd), 0)::float8 as usd, count(*)::int as calls
           from usage_events where org_id = $1 and at >= $2 group by feature order by tokens desc`,
        [orgId, from],
      ),
      q<any>(
        `select e.user_id as id, coalesce(us.name, 'Scheduled or system') as name,
                coalesce(sum(${TOKENS.replace(/(\w+_tokens)/g, "e.$1")}), 0)::float8 as tokens,
                coalesce(sum(e.cost_usd), 0)::float8 as usd, count(*)::int as calls
           from usage_events e left join users us on us.id = e.user_id
          where e.org_id = $1 and e.at >= $2
          group by e.user_id, us.name order by tokens desc limit 15`,
        [orgId, from],
      ),
      q<any>(
        `select provider, model, coalesce(sum(${TOKENS}), 0)::float8 as tokens, coalesce(sum(cost_usd), 0)::float8 as usd, count(*)::int as calls
           from usage_events where org_id = $1 and at >= $2 group by provider, model order by tokens desc`,
        [orgId, from],
      ),
      q<any>(
        `select r.id, r.agent_id, coalesce(a.name, 'Deleted agent') as agent, r.status, r.started_at,
                coalesce(sum(${TOKENS.replace(/(\w+_tokens)/g, "e.$1")}), 0)::float8 as tokens, coalesce(sum(e.cost_usd), 0)::float8 as usd
           from usage_events e join runs r on r.id = e.run_id left join agents a on a.id = r.agent_id
          where e.org_id = $1 and e.at >= $2
          group by r.id, r.agent_id, a.name, r.status, r.started_at order by tokens desc limit 10`,
        [orgId, from],
      ),
      q<any>(
        `select al.scope, al.target, al.period, al.level, al.detail, al.at,
                case when al.scope = 'agent' then coalesce(a.name, 'Deleted agent')
                     when al.target = 'gemini' then 'Google Gemini key' else 'Anthropic key' end as name
           from usage_alerts al left join agents a on al.scope = 'agent' and a.id::text = al.target
          where al.org_id = $1 order by al.at desc limit 20`,
        [orgId],
      ),
      q<any>(`select id, name from agents where org_id = $1 and status <> 'retired' order by name`, [orgId]),
      limitsFor(orgId),
    ]);

  const configured = new Set(keys.map((k) => k.kind));
  const providers: ProviderSummary[] = (["anthropic", "gemini"] as Provider[]).map((p) => {
    const r = perProvider.find((x) => x.provider === p) ?? {};
    const t = today.find((x) => x.provider === p) ?? {};
    const savings = perModelMonth
      .filter((m) => m.provider === p)
      .reduce((sum, m) => sum + (m.cache_read * rateFor(m.model || "").rate.input * 0.9) / 1_000_000, 0);
    const tokens = r.tokens ?? 0;
    const usd = r.usd ?? 0;
    return {
      provider: p,
      configured: configured.has(p) || (p === "anthropic" && !!process.env.ANTHROPIC_API_KEY) || (p === "gemini" && !!process.env.GEMINI_API_KEY),
      calls: r.calls ?? 0,
      runs: r.runs ?? 0,
      input: r.input ?? 0,
      output: r.output ?? 0,
      cacheRead: r.cache_read ?? 0,
      cacheWrite: r.cache_write ?? 0,
      tokens,
      usd,
      projectedTokens: tokens / elapsed,
      projectedUsd: usd / elapsed,
      cacheSavingsUsd: savings,
      today: { tokens: t.tokens ?? 0, usd: t.usd ?? 0 },
    };
  });

  const names = new Map(agents.map((a) => [a.id, a.name]));
  const limitStatuses: LimitStatus[] = [];
  for (const l of limits) {
    const since = l.period === "day" ? starts.day : starts.month;
    const used = await usedSince(orgId, l, since);
    let name = l.target === "gemini" ? "Google Gemini key" : "Anthropic key";
    if (l.scope === "agent") {
      name = names.get(l.target) ?? (await one<any>(`select name from agents where id = $1`, [l.target]))?.name ?? "Deleted agent";
    }
    limitStatuses.push({
      ...l,
      name,
      used,
      share: shareOf(l, used),
      resetsAt: (l.period === "day" ? starts.nextDay : starts.nextMonth).toISOString(),
    });
  }

  return {
    monthStart: starts.month.toISOString(),
    nextMonth: starts.nextMonth.toISOString(),
    providers,
    limits: limitStatuses,
    daily,
    byAgent,
    byFeature: byFeature.map((f) => ({ ...f, label: FEATURE_LABEL[f.feature as Feature] ?? f.feature })),
    byUser,
    byModel,
    heaviestRuns: heaviest.map((h) => ({ ...h, started_at: new Date(h.started_at).toISOString() })),
    alerts: alerts.map((a) => ({ ...a, at: new Date(a.at).toISOString() })),
    agents,
  };
}
