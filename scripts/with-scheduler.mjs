// Runs the web app and the scheduler as one unit.
//
//   node scripts/with-scheduler.mjs dev     local development   (npm run dev)
//   node scripts/with-scheduler.mjs start   production server   (the container's command)
//
// Extra arguments go to `next`, e.g. npm run dev -- -p 3001.
//
// The scheduler is started only once the web app answers its health check, so its
// first tick does not fail against a server that is still starting. It calls the app
// on 127.0.0.1, so it works behind any front door (IAP, a load balancer) without
// needing a public route. Stopping either process stops both.
//
// With several instances, each runs its own scheduler. That is safe: /api/cron claims
// due agents with `for update skip locked`, so an agent is fired exactly once.
import { spawn } from "child_process";
import path from "path";

const root = process.cwd();
const [mode = "dev", ...nextArgs] = process.argv.slice(2);
if (!["dev", "start"].includes(mode)) {
  console.error(`Unknown mode "${mode}". Use "dev" or "start".`);
  process.exit(1);
}

// Where the web app will listen: an explicit -p/--port wins, then PORT, then 3000.
const portFlag = nextArgs.findIndex((a) => a === "-p" || a === "--port");
const port = (portFlag >= 0 && nextArgs[portFlag + 1]) || process.env.PORT || "3000";
const localUrl = `http://127.0.0.1:${port}`;

const children = new Set();
let shuttingDown = false;

function start(name, args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: name === "web" ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (name !== "web") {
    const prefix = (stream, out) =>
      stream.on("data", (buf) => {
        for (const line of buf.toString().split(/\r?\n/)) if (line) out.write(`[${name}] ${line}\n`);
      });
    prefix(child.stdout, process.stdout);
    prefix(child.stderr, process.stderr);
  }
  children.add(child);
  child.on("exit", (code) => {
    children.delete(child);
    if (!shuttingDown) {
      console.log(`[launcher] ${name} exited${code != null ? ` with code ${code}` : ""}; stopping the rest.`);
      shutdown(code || 1);
    }
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill();
  setTimeout(() => process.exit(code), 500);
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => shutdown(0));

start("web", [path.join(root, "node_modules", "next", "dist", "bin", "next"), mode, ...nextArgs]);

// Wait for the web app, then start the scheduler against it.
const deadline = Date.now() + 5 * 60_000;
let healthy = false;
while (!shuttingDown && !healthy) {
  try {
    const res = await fetch(`${localUrl}/api/health`, { signal: AbortSignal.timeout(60_000) });
    healthy = res.ok;
  } catch {
    /* not listening yet */
  }
  if (healthy) break;
  if (Date.now() > deadline) {
    console.error(`[launcher] ${localUrl} did not become healthy within 5 minutes; the scheduler was not started.`);
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}

if (healthy && !shuttingDown) {
  start("scheduler", ["--env-file-if-exists=.env", path.join(root, "scripts", "scheduler.mjs")], {
    APP_URL: localUrl,
  });
}
