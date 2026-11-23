import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { resolveCaller } from "@/lib/api-keys";
import { originOf, runResult, unfinished } from "@/lib/api-runs";

export const runtime = "nodejs";

/**
 * GET /api/v1/runs/{id}: where a run has got to, and its answer once it has one.
 * A key sees only the runs it started; a signed-in person, any run in the
 * workspace they are viewing. 202 while the run is going or waiting for an
 * approval, 200 once it has finished.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await resolveCaller(req);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: 401 });

  const found = /^[0-9a-f-]{36}$/i.test(id)
    ? await one<any>(
        `select id from runs where id = $1 and org_id = $2 and ($3::uuid is null or api_key_id = $3)`,
        [id, caller.orgId, caller.kind === "key" ? caller.key.id : null],
      )
    : null;
  if (!found) return NextResponse.json({ error: "No such run for this key." }, { status: 404 });

  const result = await runResult(id, originOf(req));
  if (!result) return NextResponse.json({ error: "No such run for this key." }, { status: 404 });
  return NextResponse.json(result, { status: unfinished(result.status) ? 202 : 200 });
}
