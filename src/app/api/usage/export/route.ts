import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { periodStarts } from "@/lib/metering";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cell = (v: any) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every model call this month (or ?month=previous), one row each, as CSV. */
export async function GET(req: Request) {
  const u = await requireUser();
  const starts = await periodStarts(u.orgId);
  const previous = new URL(req.url).searchParams.get("month") === "previous";
  const to = previous ? starts.month : starts.nextMonth;
  const from = previous ? new Date(new Date(starts.month).setMonth(new Date(starts.month).getMonth() - 1)) : starts.month;
  const rows = await q<any>(
    `select e.at, e.provider, e.model, e.feature, a.name as agent, e.run_id, us.name as person,
            e.input_tokens, e.output_tokens, e.cache_read_tokens, e.cache_write_tokens, e.cost_usd::float8 as cost_usd
       from usage_events e left join agents a on a.id = e.agent_id left join users us on us.id = e.user_id
      where e.org_id = $1 and e.at >= $2 and e.at < $3 order by e.at`,
    [u.orgId, from, to],
  );
  const head = ["time", "provider", "model", "feature", "agent", "run_id", "person", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd"];
  const body = [head.join(","), ...rows.map((r) => [new Date(r.at).toISOString(), r.provider, r.model, r.feature, r.agent, r.run_id, r.person, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens, r.cost_usd].map(cell).join(","))].join("\n");
  const stamp = from.toISOString().slice(0, 7);
  return new Response(body, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="usage-${stamp}.csv"` },
  });
}
