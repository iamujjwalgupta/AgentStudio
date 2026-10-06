import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { filtersFrom, listRuns, runSummary } from "@/lib/run-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Runs for the Runs page: one page of rows, plus the summary when asked for. */
export async function GET(req: Request) {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const f = filtersFrom(sp);
  const [page, summary] = await Promise.all([listRuns(u.orgId, f), sp.get("summary") === "1" ? runSummary(u.orgId, f) : Promise.resolve(null)]);
  return NextResponse.json({ ...page, summary, timezone: u.timezone || "UTC" });
}
