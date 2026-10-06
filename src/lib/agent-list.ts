import { q } from "./db";

/**
 * One page of the Agents list, filtered, searched and sorted in the database.
 *
 * The list used to receive every agent with its full spec (about 1.7 MB for 500
 * agents) and filter in the browser. It needs a handful of small fields per row,
 * and only the rows on screen, so that is all this returns.
 *
 * Domains are written "Industry · CODE (function)", e.g. "Automobile · P2P (Vendor
 * Payment Excise)". They are split here into industry, process code and function,
 * which is what the list shows and filters on; a free-text domain ("financial
 * close") has no industry or code and is shown as written.
 */

export type AgentRow = {
  id: string;
  name: string;
  description: string;
  archetype: string;
  status: string;
  published_ver: number | null;
  run_count: number;
  domain: string | null;
  industry: string | null;
  process: string | null;
  process_name: string | null;
  next_run_at: string | null;
  schedule_caveat: string;
  last_run_at: string | null;
  last_run_status: string | null;
  pending_approvals: number;
  /** Who created it: they may delete it while it has never been published. */
  owner_id: string | null;
};

export type AgentListQuery = {
  q?: string;
  archetype?: string;
  status?: string;
  industry?: string;
  process?: string;
  /** A summary-bar shortcut: scheduled, recent (ran in the last 7 days) or awaiting (approval). */
  flag?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  /** Include the summary bar and filter counts. Off when only paging or filtering. */
  meta?: boolean;
};

export type AgentListSummary = {
  live: number;
  drafts: number;
  scheduled: number;
  ranThisWeek: number;
  awaiting: number;
  retired: number;
};

export type AgentListFacets = {
  types: Record<string, number>;
  industries: { name: string; count: number }[];
  processes: { code: string; count: number; live: number; functions: string[]; industries: string[] }[];
  /** Agents with a free-text domain and no process code. */
  otherProcess: number;
};

export type AgentListPage = {
  agents: AgentRow[];
  /** Rows matching the filters, across all pages. */
  total: number;
  /** Every agent in the workspace, for "n of N". */
  totalAll: number;
  retiredCount: number;
  page: number;
  pageSize: number;
  /** Present when requested with meta (the default); the list keeps the last ones otherwise. */
  summary?: AgentListSummary;
  facets?: AgentListFacets;
};

const ARCHETYPES = ["analyst", "author", "operator", "sentinel"];
const STATUSES = ["published", "draft", "retired", "all"];
const FLAGS = ["scheduled", "recent", "awaiting"];
export const PAGE_SIZES = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

const ORDER: Record<string, string> = {
  updated: "b.updated_at desc",
  name: "lower(b.name) asc, b.updated_at desc",
  lastrun: "lr.started_at desc nulls last, b.updated_at desc",
  runs: "run_count desc, b.updated_at desc",
  domain: "lower(coalesce(b.domain, '')) asc, b.updated_at desc",
};

// Parsing the domain once, in SQL, so filters and facets agree with what is shown.
const BASE = `
  select a.id, a.name, a.description, a.archetype, a.status, a.published_ver, a.next_run_at,
         a.schedule_caveat, a.updated_at, a.owner_id,
         a.draft_spec->>'domain' as domain,
         nullif(split_part(a.draft_spec->>'domain', ' · ', 1), coalesce(a.draft_spec->>'domain', '')) as industry,
         substring(a.draft_spec->>'domain' from '· *([A-Za-z0-9]{2,6}) *(?:\\(|$)') as process,
         substring(a.draft_spec->>'domain' from '· *[A-Za-z0-9]{2,6} *\\(([^)]*)\\)') as process_name
    from agents a
   where a.org_id = $1`;

/** Escapes LIKE wildcards so a search for "50%" means the text, not a pattern. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listAgentsPage(orgId: string, query: AgentListQuery): Promise<AgentListPage> {
  const status = STATUSES.includes(query.status ?? "") ? query.status! : "all";
  const archetype = ARCHETYPES.includes(query.archetype ?? "") ? query.archetype! : "all";
  const flag = FLAGS.includes(query.flag ?? "") ? query.flag! : "";
  const sort = ORDER[query.sort ?? ""] ? query.sort! : "updated";
  const pageSize = PAGE_SIZES.includes(Number(query.pageSize)) ? Number(query.pageSize) : DEFAULT_PAGE_SIZE;
  const needle = String(query.q ?? "").trim().slice(0, 200);
  const industry = String(query.industry ?? "").trim().slice(0, 100);
  const process = String(query.process ?? "").trim().slice(0, 20);

  const where: string[] = [];
  const params: any[] = [orgId];
  const add = (v: any) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (status !== "all") where.push(`b.status = ${add(status)}`);
  if (archetype !== "all") where.push(`b.archetype = ${add(archetype)}`);
  if (industry) where.push(`b.industry = ${add(industry)}`);
  if (process === "other") where.push("b.process is null");
  else if (process) where.push(`b.process = ${add(process)}`);
  if (flag === "scheduled") where.push("b.next_run_at is not null and b.status = 'published'");
  if (flag === "recent") where.push("exists (select 1 from runs r where r.agent_id = b.id and r.started_at > now() - interval '7 days')");
  if (flag === "awaiting") {
    where.push(`exists (select 1 from approvals ap join runs r on r.id = ap.run_id
                         where r.agent_id = b.id and ap.status = 'pending')`);
  }
  if (needle) {
    const p = add(`%${likeEscape(needle)}%`);
    where.push(`(b.name ilike ${p} or b.description ilike ${p} or coalesce(b.domain, '') ilike ${p} or b.archetype ilike ${p})`);
  }
  const filter = where.length ? where.join(" and ") : "true";

  const counts = await q<any>(
    `with b as (${BASE})
     select count(*) filter (where ${filter})::int as total,
            count(*)::int as total_all,
            count(*) filter (where b.status = 'retired')::int as retired
       from b`,
    params,
  );
  const total = counts[0]?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(Number(query.page) || 1)), totalPages);

  const limit = add(pageSize);
  const offset = add((page - 1) * pageSize);
  const agents = await q<AgentRow>(
    `with b as (${BASE})
     select b.id, b.name, b.description, b.archetype, b.status, b.published_ver, b.next_run_at, b.owner_id,
            b.schedule_caveat, b.domain, b.industry, b.process, b.process_name,
            (select count(*)::int from runs r where r.agent_id = b.id) as run_count,
            lr.started_at as last_run_at, lr.status as last_run_status,
            (select count(*)::int from approvals ap join runs r on r.id = ap.run_id
              where r.agent_id = b.id and ap.status = 'pending') as pending_approvals
       from b
       left join lateral (
         select r.started_at, r.status from runs r where r.agent_id = b.id order by r.started_at desc limit 1
       ) lr on true
      where ${filter}
      order by ${ORDER[sort]}
      limit ${limit} offset ${offset}`,
    params,
  );

  const [summary, facets] =
    query.meta === false ? [undefined, undefined] : await Promise.all([summaryFor(orgId), facetsFor(orgId)]);
  return {
    agents,
    total,
    totalAll: counts[0]?.total_all ?? 0,
    retiredCount: counts[0]?.retired ?? 0,
    page,
    pageSize,
    summary,
    facets,
  };
}

/** The numbers in the summary bar, across the whole workspace. */
async function summaryFor(orgId: string): Promise<AgentListSummary> {
  const r = await q<any>(
    `select count(*) filter (where a.status = 'published')::int as live,
            count(*) filter (where a.status = 'draft')::int as drafts,
            count(*) filter (where a.status = 'published' and a.next_run_at is not null)::int as scheduled,
            count(*) filter (where a.status = 'retired')::int as retired,
            count(*) filter (where exists (
              select 1 from runs r where r.agent_id = a.id and r.started_at > now() - interval '7 days'))::int as ran_this_week,
            count(*) filter (where exists (
              select 1 from approvals ap join runs r on r.id = ap.run_id
               where r.agent_id = a.id and ap.status = 'pending'))::int as awaiting
       from agents a where a.org_id = $1`,
    [orgId],
  );
  const s = r[0] ?? {};
  return {
    live: s.live ?? 0,
    drafts: s.drafts ?? 0,
    scheduled: s.scheduled ?? 0,
    ranThisWeek: s.ran_this_week ?? 0,
    awaiting: s.awaiting ?? 0,
    retired: s.retired ?? 0,
  };
}

/** Counts for the type, industry and process filters, over every agent, as the default list shows retired ones too. */
async function facetsFor(orgId: string): Promise<AgentListFacets> {
  const [types, industries, processes, other] = await Promise.all([
    q<any>(`select archetype, count(*)::int as n from agents where org_id = $1 group by 1`, [orgId]),
    q<any>(
      `with b as (${BASE}) select industry as name, count(*)::int as count
         from b where industry is not null group by 1 order by 2 desc, 1`,
      [orgId],
    ),
    // Each process's most common functions and industries, not the first ones alphabetically.
    q<any>(
      `with b as (${BASE}),
            live as (select * from b where b.process is not null)
       select p.process as code, count(*)::int as count,
              count(*) filter (where p.status = 'published')::int as live,
              (select array_agg(x.process_name order by x.n desc, x.process_name) from (
                 select process_name, count(*) as n from live l
                  where l.process = p.process and l.process_name is not null
                  group by 1 order by 2 desc, 1 limit 3) x) as functions,
              (select array_agg(y.industry order by y.n desc, y.industry) from (
                 select industry, count(*) as n from live l
                  where l.process = p.process and l.industry is not null
                  group by 1 order by 2 desc, 1 limit 4) y) as industries
         from live p group by p.process order by 2 desc, 1`,
      [orgId],
    ),
    q<any>(`with b as (${BASE}) select count(*)::int as n from b where process is null`, [orgId]),
  ]);
  return {
    types: Object.fromEntries(types.map((t) => [t.archetype, t.n])),
    industries,
    processes: processes.map((p) => ({ ...p, functions: p.functions ?? [], industries: p.industries ?? [] })),
    otherProcess: other[0]?.n ?? 0,
  };
}

/* ── for the Brief step's pickers ──────────────────────────── */

export type TaxonomyRow = { industry: string | null; process: string | null; process_name: string | null; n: number };

/**
 * Every industry, process and function combination in use, with how many agents
 * use it. The Brief step builds its Industry, Process and Function choices from
 * this, so a new agent is described the way the list already parses.
 */
export async function domainTaxonomy(orgId: string): Promise<TaxonomyRow[]> {
  return q<TaxonomyRow>(
    `with b as (${BASE})
     select industry, process, process_name, count(*)::int as n
       from b
      where b.status <> 'retired' and (industry is not null or process is not null)
      group by 1, 2, 3
      order by n desc`,
    [orgId],
  );
}

/** Live agents in the same industry and/or process, whose brief can be copied. */
export async function similarAgents(
  orgId: string,
  { industry, process, exclude }: { industry?: string; process?: string; exclude?: string },
): Promise<{ id: string; name: string; brief: string; domain: string | null }[]> {
  const params: any[] = [orgId];
  const where = ["b.status = 'published'", "coalesce(a2.draft_spec->>'brief', '') <> ''"];
  if (industry) {
    params.push(industry);
    where.push(`b.industry = $${params.length}`);
  }
  if (process) {
    params.push(process);
    where.push(`b.process = $${params.length}`);
  }
  if (exclude) {
    params.push(exclude);
    where.push(`b.id <> $${params.length}::uuid`);
  }
  return q<any>(
    `with b as (${BASE})
     select b.id, b.name, a2.draft_spec->>'brief' as brief, b.domain
       from b join agents a2 on a2.id = b.id
      where ${where.join(" and ")}
      order by b.updated_at desc
      limit 12`,
    params,
  );
}

/** Another agent in the workspace with this name, ignoring case and outer spaces. */
export async function agentNamed(orgId: string, name: string, exclude?: string): Promise<{ id: string; name: string } | null> {
  const rows = await q<any>(
    `select id, name from agents
      where org_id = $1 and lower(trim(name)) = lower(trim($2)) and ($3::uuid is null or id <> $3::uuid)
      limit 1`,
    [orgId, name, exclude || null],
  );
  return rows[0] ?? null;
}

/* ── for the Instructions step's skill suggestions ─────────── */

export type SkillUsageRow = { skill_id: string; process: string | null; n: number };

/**
 * How many agents that are not retired hold each skill, split by process code.
 * Summed it is "used by N agents"; for one process it is what agents doing the
 * same work reach for, which is the best hint for a new one.
 */
export async function skillUsage(orgId: string): Promise<SkillUsageRow[]> {
  return q<SkillUsageRow>(
    `with b as (${BASE})
     select s.skill_id, b.process, count(*)::int as n
       from b
       join agents a2 on a2.id = b.id
       cross join lateral jsonb_array_elements_text(
         case when jsonb_typeof(a2.draft_spec->'skills') = 'array' then a2.draft_spec->'skills' else '[]'::jsonb end
       ) as s(skill_id)
      where b.status <> 'retired'
      group by 1, 2`,
    [orgId],
  );
}
