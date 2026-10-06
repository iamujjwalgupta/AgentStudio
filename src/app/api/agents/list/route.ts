import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listAgentsPage } from "@/lib/agent-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One page of the Agents list: ?q=&archetype=&status=&industry=&process=&flag=&sort=&page=&pageSize= */
export async function GET(req: Request) {
  const u = await requireUser();
  const p = new URL(req.url).searchParams;
  const result = await listAgentsPage(u.orgId, {
    q: p.get("q") ?? undefined,
    archetype: p.get("archetype") ?? undefined,
    status: p.get("status") ?? undefined,
    industry: p.get("industry") ?? undefined,
    process: p.get("process") ?? undefined,
    flag: p.get("flag") ?? undefined,
    sort: p.get("sort") ?? undefined,
    page: Number(p.get("page")) || 1,
    pageSize: Number(p.get("pageSize")) || undefined,
    meta: p.get("meta") !== "0",
  });
  return NextResponse.json(result);
}
