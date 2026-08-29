// The scheduler. Wakes once a minute and asks the app to fire whatever is due.
//
//   node --env-file=.env scripts/scheduler.mjs
//
// Deliberately thin: it holds no schedule logic and touches no database. All it
// does is provide a heartbeat, so the same endpoint works behind a system cron,
// a platform scheduler, or this process — whichever the deployment has.
const url = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "") + "/api/cron";
const secret = process.env.CRON_SECRET;
const every = Number(process.env.SCHEDULER_INTERVAL_MS || 60_000);

if (!secret) {
  console.error("CRON_SECRET is not set. Add it to .env — the endpoint will refuse the call without it.");
  process.exit(1);
}

const stamp = () => new Date().toISOString().slice(11, 19);
let stop = false;

async function tick() {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-cron-secret": secret },
      signal: AbortSignal.timeout(280_000),
    });
    if (!res.ok) {
      console.error(`${stamp()}  ${res.status} ${await res.text().catch(() => "")}`.trim());
      return;
    }
    const j = await res.json();
    if (j.claimed) {
      for (const s of j.started) console.log(`${stamp()}  started  ${s.agent}  run ${s.runId}`);
      for (const f of j.failed) console.error(`${stamp()}  FAILED   ${f.agent}: ${f.error}`);
    }
  } catch (e) {
    console.error(`${stamp()}  ${e.message}`);
  }
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stop = true;
    console.log(`\n${stamp()}  scheduler stopped`);
    process.exit(0);
  });
}

console.log(`Scheduler running. Polling ${url} every ${Math.round(every / 1000)}s. Ctrl-C to stop.`);
await tick();
while (!stop) {
  await new Promise((r) => setTimeout(r, every));
  if (!stop) await tick();
}
