import { one, q } from "./db";
import { notify, approverEmails } from "./notify";

/**
 * What a workspace has spent, and what it is allowed to spend.
 *
 * The month is the calendar month in the workspace's own timezone, so a cap
 * resets when the team's month does rather than at an arbitrary UTC boundary.
 */

export const OVER_CAP =
  "This workspace has reached its monthly spending limit, so the run was stopped. Raise the limit under Spend, or wait for the new month.";

/** Start of the current month, as an instant, in the workspace timezone. */
async function monthStart(orgId: string): Promise<Date> {
  const row = await one<any>(
    `select date_trunc('month', now() at time zone coalesce(o.timezone, 'UTC'))
              at time zone coalesce(o.timezone, 'UTC') as start
       from orgs o where o.id = $1`,
    [orgId],
  );
  return row?.start ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1);
}

/** Dollars spent by this workspace so far this month. */
export async function spendThisMonth(orgId: string): Promise<number> {
  const from = await monthStart(orgId);
  const row = await one<any>(
    `select coalesce(sum(cost_usd), 0)::float8 as total from runs where org_id = $1 and started_at >= $2`,
    [orgId, from],
  );
  return row?.total ?? 0;
}

/** The workspace's monthly ceiling in dollars, or null when uncapped. */
export async function capFor(orgId: string): Promise<number | null> {
  const row = await one<any>(`select monthly_cap_usd::float8 as cap from orgs where id = $1`, [orgId]);
  return row?.cap ?? null;
}

/** Whether a new run may start, and why not when it may not. */
export async function budgetCheck(orgId: string): Promise<{ ok: boolean; reason?: string; spent: number; cap: number | null }> {
  const [spent, cap] = await Promise.all([spendThisMonth(orgId), capFor(orgId)]);
  if (cap !== null && spent >= cap) {
    // Announced once a day at most, so a blocked schedule does not become a siren.
    const already = await one<any>(
      `select 1 from notifications
        where org_id = $1 and event = 'spend_cap' and created_at > now() - interval '24 hours' limit 1`,
      [orgId],
    );
    if (!already) {
      await notify(orgId, {
        event: "spend_cap",
        to: await approverEmails(orgId),
        subject: "The workspace has reached its spending limit",
        body:
          `Spend this month is $${spent.toFixed(2)} against a limit of $${cap.toFixed(2)}.\n\n` +
          `New runs are being refused until the limit is raised under Spend, or the month turns.`,
      });
    }
    return { ok: false, reason: OVER_CAP, spent, cap };
  }
  return { ok: true, spent, cap };
}

/** Month-to-date spend broken down by agent, biggest first. */
export async function spendByAgent(orgId: string) {
  const from = await monthStart(orgId);
  return q<any>(
    `select a.id, a.name, a.status,
            count(r.id)::int as runs,
            coalesce(sum(r.cost_usd), 0)::float8 as cost,
            coalesce(sum(r.input_tokens + r.output_tokens), 0)::bigint as tokens
       from runs r join agents a on a.id = r.agent_id
      where r.org_id = $1 and r.started_at >= $2
      group by a.id, a.name, a.status
      order by cost desc, runs desc`,
    [orgId, from],
  );
}

/** Totals for the month, including the cache split that explains the cost. */
export async function spendSummary(orgId: string) {
  const from = await monthStart(orgId);
  const row = await one<any>(
    `select count(*)::int as runs,
            coalesce(sum(cost_usd), 0)::float8 as cost,
            coalesce(sum(input_tokens), 0)::bigint as input_tokens,
            coalesce(sum(output_tokens), 0)::bigint as output_tokens,
            coalesce(sum(cache_read_tokens), 0)::bigint as cache_read_tokens,
            coalesce(sum(cache_write_tokens), 0)::bigint as cache_write_tokens
       from runs where org_id = $1 and started_at >= $2`,
    [orgId, from],
  );
  const cap = await capFor(orgId);
  return { ...row, cap, from };
}
