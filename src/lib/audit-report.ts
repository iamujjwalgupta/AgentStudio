import { one, q } from "./db";

/**
 * Reading the audit trail: filtered, paged newest first, with the name of what
 * each event was about (from the event, or from the agent, run, skill or
 * connection it points at), and the numbers above the list.
 */

export const AUDIT_CATEGORIES = {
  agents: { label: "Agents", entities: ["agent"] },
  runs: { label: "Runs", entities: ["run", "cfo_run"] },
  skills: { label: "Skills", entities: ["skill"] },
  connections: { label: "Connections", entities: ["connection"] },
  access: { label: "People & access", entities: ["user"] },
  workspace: { label: "Workspace & limits", entities: ["org", "usage_limit", "document"] },
  apps: { label: "Apps", entities: ["app"] },
} as const;
export type AuditCategory = keyof typeof AUDIT_CATEGORIES;

/** Removing or retiring something. */
const DESTRUCTIVE = `(e.action ~* '^(deleted|removed|retired|withdrew)' or e.action ~* '\\.delete$')`;
/** Who can get in and with what rights, and refused or failed checks. */
const SECURITY = `(e.action ~* '(password|signed in|role|invited|joined|removed a member|withdrew an invitation|refused)')`;

export type AuditFilters = {
  q?: string;
  category?: AuditCategory | "";
  actor?: string;
  flag?: "destructive" | "security" | "";
  days?: number; // 0 = all time
  entity?: string;
  entityId?: string;
  cursor?: string; // "<iso at>|<id>"
  limit?: number;
};

export type AuditEvent = {
  id: string;
  at: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: Record<string, any>;
  target: string | null;
  /** Where the thing it is about can be opened, if it still exists. */
  href: string | null;
  destructive: boolean;
  security: boolean;
};

function where(orgId: string, f: AuditFilters) {
  const args: any[] = [orgId];
  const cond = ["e.org_id = $1"];
  const add = (sql: string, v: any) => {
    args.push(v);
    cond.push(sql.replace(/\?/g, `$${args.length}`));
  };
  if (f.days && f.days > 0) add(`e.at >= now() - (? || ' days')::interval`, String(f.days));
  if (f.category && AUDIT_CATEGORIES[f.category]) add(`e.entity = any(?)`, [...AUDIT_CATEGORIES[f.category].entities]);
  if (f.actor) add(`coalesce(e.actor_id::text, 'name:' || e.actor_name) = ?`, f.actor);
  if (f.flag === "destructive") cond.push(DESTRUCTIVE);
  if (f.flag === "security") cond.push(SECURITY);
  if (f.entity) add(`e.entity = ?`, f.entity);
  if (f.entityId) add(`e.entity_id = ?`, f.entityId);
  if (f.q?.trim()) {
    add(
      `(e.action ilike ? or e.actor_name ilike ? or e.detail::text ilike ? or coalesce(a.name, ra.name, s.label, c.name, ap.name, '') ilike ?)`,
      `%${f.q.trim().replace(/[%_\\]/g, (m) => "\\" + m)}%`,
    );
  }
  return { args, cond };
}

const JOINS = `
  left join agents a on e.entity = 'agent' and a.id::text = e.entity_id
  left join runs r on e.entity = 'run' and r.id::text = e.entity_id
  left join agents ra on ra.id = r.agent_id
  left join skills s on e.entity = 'skill' and s.id::text = e.entity_id
  left join connections c on e.entity = 'connection' and c.id::text = e.entity_id
  left join apps ap on e.entity = 'app' and ap.id::text = e.entity_id`;

export async function auditEvents(orgId: string, f: AuditFilters): Promise<{ events: AuditEvent[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 10000);
  const { args, cond } = where(orgId, f);
  if (f.cursor) {
    const [at, id] = f.cursor.split("|");
    if (at && /^\d+$/.test(id ?? "")) {
      args.push(at, id);
      cond.push(`(e.at, e.id) < ($${args.length - 1}::timestamptz, $${args.length}::bigint)`);
    }
  }
  const rows = await q<any>(
    `select e.id::text, e.at, e.actor_id, e.actor_name, e.action, e.entity, e.entity_id, e.detail,
            coalesce(e.detail->>'name', e.detail->>'label', a.name, ra.name, s.label, c.name, ap.name, e.detail->>'member', e.detail->>'email') as target,
            (a.id is not null) as agent_exists, r.id is not null as run_exists, s.id is not null as skill_exists,
            c.id is not null as conn_exists, ap.id is not null as app_exists,
            ${DESTRUCTIVE} as destructive, ${SECURITY} as security
       from audit_events e ${JOINS}
      where ${cond.join(" and ")}
      order by e.at desc, e.id desc
      limit ${limit + 1}`,
    args,
  );
  const more = rows.length > limit;
  const events: AuditEvent[] = rows.slice(0, limit).map((r) => ({
    id: r.id,
    at: new Date(r.at).toISOString(),
    actor_id: r.actor_id,
    actor_name: r.actor_name,
    action: r.action,
    entity: r.entity,
    entity_id: r.entity_id,
    detail: r.detail ?? {},
    target: r.target,
    href:
      r.entity === "agent" && r.agent_exists ? `/agents/${r.entity_id}`
      : r.entity === "run" && r.run_exists ? `/runs/${r.entity_id}`
      : r.entity === "skill" && r.skill_exists ? `/skills`
      : r.entity === "connection" && r.conn_exists ? `/connections`
      : r.entity === "app" && r.app_exists ? `/apps/${r.entity_id}`
      : r.entity === "usage_limit" ? `/usage`
      : r.entity === "user" && r.action !== "Signed in" ? `/members`
      : null,
    destructive: r.destructive,
    security: r.security,
  }));
  const last = events[events.length - 1];
  return { events, nextCursor: more && last ? `${last.at}|${last.id}` : null };
}

export type AuditSummary = {
  total: number;
  people: number;
  publishes: number;
  destructive: number;
  security: number;
  failedChecks: number;
  categories: Record<string, number>;
  actors: { key: string; name: string; count: number; system: boolean }[];
};

/** The numbers above the list, for the chosen period (other filters aside, so the chips keep their counts). */
export async function auditSummary(orgId: string, days: number): Promise<AuditSummary> {
  const { args, cond } = where(orgId, { days });
  const w = cond.join(" and ");
  const [head, cats, actors] = await Promise.all([
    one<any>(
      `select count(*)::int as total, count(distinct e.actor_id)::int as people,
              count(*) filter (where e.action = 'Published agent')::int as publishes,
              count(*) filter (where ${DESTRUCTIVE})::int as destructive,
              count(*) filter (where ${SECURITY})::int as security,
              count(*) filter (where e.action ~* '(failed|refused)')::int as failed
         from audit_events e where ${w}`,
      args,
    ),
    q<any>(`select e.entity, count(*)::int as n from audit_events e where ${w} group by e.entity`, args),
    q<any>(
      `select coalesce(e.actor_id::text, 'name:' || e.actor_name) as key, max(e.actor_name) as name,
              count(*)::int as count, bool_and(e.actor_id is null) as system
         from audit_events e where ${w} group by 1 order by count desc limit 50`,
      args,
    ),
  ]);
  const categories: Record<string, number> = {};
  for (const [k, c] of Object.entries(AUDIT_CATEGORIES)) {
    categories[k] = cats.filter((x) => (c.entities as readonly string[]).includes(x.entity)).reduce((s, x) => s + x.n, 0);
  }
  return {
    total: head?.total ?? 0,
    people: head?.people ?? 0,
    publishes: head?.publishes ?? 0,
    destructive: head?.destructive ?? 0,
    security: head?.security ?? 0,
    failedChecks: head?.failed ?? 0,
    categories,
    actors,
  };
}

/** Reads a request's query string into filters. */
export function filtersFrom(sp: URLSearchParams): AuditFilters {
  const cat = sp.get("category") ?? "";
  const flag = sp.get("flag") ?? "";
  const days = Number(sp.get("days") ?? 30);
  return {
    q: sp.get("q")?.slice(0, 200) ?? "",
    category: cat in AUDIT_CATEGORIES ? (cat as AuditCategory) : "",
    actor: sp.get("actor")?.slice(0, 200) ?? "",
    flag: flag === "destructive" || flag === "security" ? flag : "",
    days: Number.isFinite(days) && days >= 0 && days <= 3650 ? days : 30,
    entity: sp.get("entity")?.slice(0, 40) ?? "",
    entityId: sp.get("entityId")?.slice(0, 200) ?? "",
    cursor: sp.get("cursor") ?? "",
    limit: Number(sp.get("limit") ?? 100) || 100,
  };
}
