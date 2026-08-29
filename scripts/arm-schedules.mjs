// Arms scheduling for agents published before the scheduler existed.
// Safe to re-run: it recomputes from the published spec every time.
//
//   node --env-file=.env scripts/arm-schedules.mjs [--dry-run]
import pg from "pg";
import { build } from "esbuild";
import { tmpdir } from "os";
import path from "path";
import fs from "fs";

// The schedule rules live in TypeScript so the app and this script cannot drift.
const out = path.join(tmpdir(), `schedule-${process.pid}.mjs`);
await build({
  entryPoints: ["src/lib/schedule.ts"],
  outfile: out,
  format: "esm",
  logLevel: "error",
  bundle: false,
});
const { parseSchedule, nextRun, describeSchedule, unattendedNotes } = await import(`file://${out}`);
fs.unlinkSync(out);

const dry = process.argv.includes("--dry-run");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const { rows } = await client.query(
    `select a.id, a.name, a.status, a.published_ver, a.org_id, o.timezone,
            coalesce(v.spec, a.draft_spec) as spec
       from agents a
       join orgs o on o.id = a.org_id
       left join agent_versions v on v.agent_id = a.id and v.version = a.published_ver
      order by a.name`,
  );

  let armed = 0, cleared = 0, unreadable = 0;
  for (const a of rows) {
    const trig = a.spec?.trigger || {};
    const wants = a.status === "published" && trig.type === "schedule";

    if (!wants) {
      if (!dry) await client.query(`update agents set schedule=null, schedule_caveat='', next_run_at=null where id=$1`, [a.id]);
      cleared++;
      continue;
    }

    const tz = a.timezone || "UTC";
    const { schedule, caveat } = parseSchedule(trig.schedule || "");
    if (!schedule) {
      unreadable++;
      const msg = "This schedule could not be understood, so the agent will not run on its own.";
      if (!dry) await client.query(`update agents set schedule=null, next_run_at=null, schedule_caveat=$2 where id=$1`, [a.id, msg]);
      console.log(`  ✗  ${a.name}\n         "${trig.schedule}" — not understood`);
      continue;
    }

    const notes = [caveat, ...unattendedNotes(a.spec)].filter(Boolean).join("; ");
    const next = nextRun(schedule, tz);
    if (!dry) {
      await client.query(`update agents set schedule=$2, schedule_caveat=$3, next_run_at=$4 where id=$1`,
        [a.id, JSON.stringify(schedule), notes, next]);
    }
    armed++;
    console.log(`  ✓  ${a.name}`);
    console.log(`         "${trig.schedule}"`);
    console.log(`         ${describeSchedule(schedule, tz)} · next ${next?.toISOString() ?? "never"}`);
    if (notes) console.log(`         caveat: ${notes}`);
  }

  console.log(`\n${dry ? "Would arm" : "Armed"} ${armed}, cleared ${cleared}, could not read ${unreadable}.`);
} catch (e) {
  console.error("Failed:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
