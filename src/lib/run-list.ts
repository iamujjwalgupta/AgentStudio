import { one, q } from "./db";

/**
 * The Runs list: filtered and paged on the server, with the numbers above it.
 * A run still "running" after STUCK_MINUTES is flagged — the orchestrator
 * works in short bursts, so a run that long without finishing has usually
 * stopped (a server restart, a crash) rather than still working.
 */

export const STUCK_MINUTES = 30;

export type RunFilters = {
  q?: string;
  status?: string; // running | awaiting_approval | completed | failed | rejected | stuck
  trigger?: string; // manual | schedule | api | team | rehearsal | test
  agentId?: string;
  days?: number; // 0 = all time
  page?: number;
  pageSize?: number;
};

export type RunRow = {
  id: string;
  status: string;
  trigger: string;
  trigger_kind: string;
  started_at: string;
  ended_at: string | null;
  input: string;
  version: number | null;
  agent_id: string;
  agent_name: string;
  started_by_name: string | null;
  cost_usd: number;
  tokens: number;
  dry_run: boolean;
  parent_run_id: string | null;
  steps: number;
  waiting: number;
  stuck: boolean;
};

/** Which of the plain-language groups a stored trigger belongs to. */
const TRIGGER_KIND = `case
  when r.dry_run or r.trigger = 'rehearsal' then 'rehearsal'
  when r.trigger like 'swarm%' or r.parent_run_id is not null then 'team'
  when r.trigger in ('manual','schedule','api','test') then r.trigger
  else 'other' end`;

function where(orgId: string, f: RunFilters, withStatus = true) {
  const args: any[] = [orgId];
  const cond = ["r.org_id = $1"];
  const add = (sql: string, v: any) => {
    args.push(v);
    cond.push(sql.replace(/\?/g, `$${args.length}`));
  };
  if (f.days && f.days > 0) add(`r.started_at >= now() - (? || ' days')::interval`, String(f.days));
  if (f.agentId && /^[0-9a-f-]{36}$/i.test(f.agentId)) add(`r.agent_id = ?::uuid`, f.agentId);
  if (f.trigger) add(`(${TRIGGER_KIND}) = ?`, f.trigger);
  if (f.q?.trim()) add(`(a.name ilike ? or r.input ilike ?)`, `%${f.q.trim().replace(/[%_\\]/g, (m) => "\\" + m)}%`);
  if (withStatus && f.status) {
    if (f.status === "stuck") cond.push(`r.status = 'running' and r.started_at < now() - interval '${STUCK_MINUTES} minutes'`);
    else if (f.status === "running") cond.push(`r.status = 'running' and r.started_at >= now() - interval '${STUCK_MINUTES} minutes'`);
    else add(`r.status = ?`, f.status);
  }
  return { args, cond: cond.join(" and ") };
}

export async function listRuns(orgId: string, f: RunFilters) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 100);
  const page = Math.max(f.page ?? 1, 1);
  const { args, cond } = where(orgId, f);
  const base = `from runs r join agents a on a.id = r.agent_id where ${cond}`;
  const [rows, total] = await Promise.all([
    q<any>(
      `select r.id, r.status, r.trigger, (${TRIGGER_KIND}) as trigger_kind, r.started_at, r.ended_at,
              left(coalesce(r.input, ''), 240) as input, r.version, r.agent_id, a.name as agent_name,
              (select name from users where id = r.started_by) as started_by_name,
              coalesce(r.cost_usd, 0)::float8 as cost_usd,
              (coalesce(r.input_tokens,0) + coalesce(r.output_tokens,0) + coalesce(r.cache_read_tokens,0) + coalesce(r.cache_write_tokens,0))::int as tokens,
              coalesce(r.dry_run, false) as dry_run, r.parent_run_id,
              (select count(*)::int from run_steps s where s.run_id = r.id) as steps,
              (select count(*)::int from approvals ap where ap.run_id = r.id and ap.status = 'pending') as waiting,
              (r.status = 'running' and r.started_at < now() - interval '${STUCK_MINUTES} minutes') as stuck
         ${base}
        order by r.started_at desc
        limit ${pageSize} offset ${(page - 1) * pageSize}`,
      args,
    ),
    one<any>(`select count(*)::int as n ${base}`, args),
  ]);
  return {
    runs: rows.map((r) => ({ ...r, started_at: new Date(r.started_at).toISOString(), ended_at: r.ended_at ? new Date(r.ended_at).toISOString() : null })) as RunRow[],
    total: total?.n ?? 0,
    page,
    pageSize,
  };
}

/** Counts for the period (and agent, trigger, search), whatever the status filter. */
export async function runSummary(orgId: string, f: RunFilters) {
  const { args, cond } = where(orgId, f, false);
  const [s, agents] = await Promise.all([
    one<any>(
      `select count(*)::int as total,
              count(*) filter (where r.status = 'running' and r.started_at >= now() - interval '${STUCK_MINUTES} minutes')::int as running,
              count(*) filter (where r.status = 'running' and r.started_at < now() - interval '${STUCK_MINUTES} minutes')::int as stuck,
              count(*) filter (where r.status = 'awaiting_approval')::int as waiting,
              count(*) filter (where r.status = 'failed')::int as failed,
              count(*) filter (where r.status = 'rejected')::int as rejected,
              count(*) filter (where r.status = 'completed')::int as completed,
              coalesce(sum(r.cost_usd), 0)::float8 as cost,
              coalesce(avg(extract(epoch from (r.ended_at - r.started_at))) filter (where r.ended_at is not null), 0)::float8 as avg_seconds
         from runs r join agents a on a.id = r.agent_id where ${cond}`,
      args,
    ),
    q<any>(
      `select a.id, a.name, count(*)::int as n from runs r join agents a on a.id = r.agent_id
        where r.org_id = $1 group by a.id, a.name order by a.name`,
      [orgId],
    ),
  ]);
  return { ...s, agents };
}

export function filtersFrom(sp: URLSearchParams): RunFilters {
  const days = Number(sp.get("days") ?? 30);
  return {
    q: sp.get("q")?.slice(0, 200) ?? "",
    status: sp.get("status") ?? "",
    trigger: sp.get("trigger") ?? "",
    agentId: sp.get("agent") ?? "",
    days: Number.isFinite(days) && days >= 0 ? days : 30,
    page: Number(sp.get("page") ?? 1) || 1,
    pageSize: Number(sp.get("pageSize") ?? 25) || 25,
  };
}
