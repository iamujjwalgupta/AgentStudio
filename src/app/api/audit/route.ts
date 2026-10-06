import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { auditEvents, auditSummary, filtersFrom } from "@/lib/audit-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The audit trail, filtered and paged. With format=csv, the same filtered list
 * (up to 10,000 events) as a download. summary=1 adds the numbers for the period.
 */
export async function GET(req: Request) {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const f = filtersFrom(sp);

  if (sp.get("format") === "csv") {
    const { events } = await auditEvents(u.orgId, { ...f, cursor: "", limit: 10000 });
    const cell = (v: unknown) => {
      const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ["time_utc", "actor", "action", "about", "entity", "entity_id", "detail"].join(","),
      ...events.map((e) => [e.at, e.actor_name, e.action, e.target, e.entity, e.entity_id, e.detail].map(cell).join(",")),
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(lines.join("\r\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="audit-trail-${stamp}.csv"`,
      },
    });
  }

  const [page, summary] = await Promise.all([
    auditEvents(u.orgId, f),
    sp.get("summary") === "1" ? auditSummary(u.orgId, f.days ?? 30) : Promise.resolve(null),
  ]);
  return NextResponse.json({ ...page, summary, timezone: u.timezone || "UTC" });
}
