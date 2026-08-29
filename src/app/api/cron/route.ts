import { NextResponse } from "next/server";
import { pool, one } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { startRun } from "@/lib/orchestrator";
import { audit } from "@/lib/ai";
import { nextRun, type Schedule } from "@/lib/schedule";
import { budgetCheck } from "@/lib/spend";
import { composeRunInput } from "@/lib/run-input";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PER_TICK = 20;

type Claimed = {
  id: string;
  org_id: string;
  name: string;
  owner_id: string | null;
  published_ver: number | null;
  schedule: Schedule;
  timezone: string;
  owner_name: string | null;
};

/**
 * Fires every agent that has come due.
 *
 * Claiming happens in one transaction with `for update skip locked`, and the
 * next firing is written before any run starts. Two schedulers racing therefore
 * cannot fire the same agent twice, and a crash mid-tick loses at most the runs
 * it had already claimed rather than looping on them forever.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const presented = req.headers.get("x-cron-secret");
  let actor = "scheduler";

  if (!secret || presented !== secret) {
    // A workspace owner may also tick manually from the UI.
    const u = await getUser();
    if (!u?.isOwner) return NextResponse.json({ error: "Not authorised." }, { status: 401 });
    actor = u.name;
  }

  const client = await pool.connect();
  let claimed: Claimed[] = [];
  try {
    await client.query("begin");
    const due = await client.query(
      `select a.id, a.org_id, a.name, a.owner_id, a.published_ver, a.schedule, o.timezone,
              us.name as owner_name
         from agents a
         join orgs o on o.id = a.org_id
         left join users us on us.id = a.owner_id
        where a.status = 'published'
          and a.next_run_at is not null
          and a.next_run_at <= now()
          and a.schedule is not null
        order by a.next_run_at
        limit $1
        for update of a skip locked`,
      [MAX_PER_TICK],
    );
    claimed = due.rows as Claimed[];

    for (const a of claimed) {
      const next = nextRun(a.schedule, a.timezone || "UTC");
      await client.query(`update agents set next_run_at = $2, last_run_at = now() where id = $1`, [a.id, next]);
    }
    await client.query("commit");
  } catch (e: any) {
    await client.query("rollback").catch(() => {});
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    client.release();
  }

  const started: { agent: string; runId: string }[] = [];
  const failed: { agent: string; error: string }[] = [];

  for (const a of claimed) {
    try {
      // An unattended run is exactly the kind that quietly overspends.
      const budget = await budgetCheck(a.org_id);
      if (!budget.ok) throw new Error(budget.reason!);

      const v = a.published_ver
        ? await one<any>(`select spec, version from agent_versions where agent_id = $1 and version = $2`, [
            a.id,
            a.published_ver,
          ])
        : null;
      if (!v?.spec?.steps?.length) throw new Error("The published version has no instructions.");

      const runId = await startRun({
        orgId: a.org_id,
        agentId: a.id,
        spec: v.spec,
        version: v.version,
        // Nobody is at the keyboard, so the standing values stand in for the form.
        input: composeRunInput(v.spec, v.spec?.trigger?.inputs || {}, v.spec?.trigger?.input || ""),
        inputs: v.spec?.trigger?.inputs || {},
        user: { id: a.owner_id || "", name: a.owner_name || actor },
        trigger: "schedule",
      });
      started.push({ agent: a.name, runId });
    } catch (e: any) {
      failed.push({ agent: a.name, error: e?.message || String(e) });
      await audit(a.org_id, { name: actor }, "Scheduled run could not start", "agent", a.id, {
        agent: a.name,
        error: e?.message || String(e),
      });
    }
  }

  return NextResponse.json({ ok: true, claimed: claimed.length, started, failed });
}

/** What is due and what is next, without firing anything. */
export async function GET() {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  const rows = await one<any>(
    `select count(*) filter (where next_run_at <= now())::int as due,
            count(*)::int as armed,
            min(next_run_at) filter (where next_run_at > now()) as next
       from agents where org_id = $1 and status = 'published' and next_run_at is not null`,
    [u.orgId],
  );
  return NextResponse.json(rows);
}
