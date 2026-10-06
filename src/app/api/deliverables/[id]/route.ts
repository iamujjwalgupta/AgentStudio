import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { normalizeDeliverable } from "@/lib/deliverable";

export const runtime = "nodejs";

/** One presented result, with the run and agent it came from. Another workspace's reads as not found. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = await one<any>(
    `select d.id, d.spec, d.created_at, d.run_id, d.agent_id, a.name as agent_name
       from deliverables d left join agents a on a.id = d.agent_id
      where d.id = $1 and d.org_id = $2`,
    [id, u.orgId],
  );
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...row, spec: normalizeDeliverable(row.spec) });
}
