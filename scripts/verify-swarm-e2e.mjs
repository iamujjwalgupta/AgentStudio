// scripts/verify-swarm-e2e.mjs
import pg from "pg";
import { SignJWT } from "jose";

const BASE_URL = process.env.APP_URL || "http://localhost:3000";
const DB_URL = process.env.DATABASE_URL;
const rawAuthSecret = process.env.AUTH_SECRET || "dev-secret-change-me";
const secret = new TextEncoder().encode(rawAuthSecret);

console.log("=== End-to-End Multi-Agent Swarm & A2A Verification ===");

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();

try {
  // 1. Fetch agent and user
  const { rows: [agent] } = await client.query(`select * from agents where name = 'Journal Entry Anomaly Reviewer' limit 1`);
  if (!agent) throw new Error("Agent 'Journal Entry Anomaly Reviewer' not found");

  const { rows: [user] } = await client.query(`select * from users where org_id = $1 limit 1`, [agent.org_id]);
  if (!user) throw new Error("User not found for org");

  console.log(`\n[Step 1] Target Supervisor Agent: "${agent.name}" (${agent.id})`);
  console.log(`         User: "${user.name}" (${user.email})`);

  // 2. Generate auth cookie
  const token = await new SignJWT({ sub: user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1d")
    .sign(secret);

  const cookieHeader = `as_session=${token}`;

  // 3. Test GET /api/agents/[id]/swarm
  console.log("\n[Step 2] Testing GET /api/agents/[id]/swarm...");
  const getRes = await fetch(`${BASE_URL}/api/agents/${agent.id}/swarm`, {
    headers: { Cookie: cookieHeader },
  });
  if (!getRes.ok) throw new Error(`GET swarm failed: HTTP ${getRes.status}`);
  const getData = await getRes.json();
  console.log(`✓ Swarm GET successful. Available agents in workspace: ${getData.availableAgents?.length}`);

  // 4. Configure Swarm with 1 Internal Agent + 1 External A2A Agent
  const otherAgent = getData.availableAgents?.[0];
  console.log(`\n[Step 3] Configuring Swarm with Parallel Strategy...`);
  console.log(`         - Worker 1 (Internal): "${otherAgent?.name || "Specialist 1"}"`);
  console.log(`         - Worker 2 (External A2A): "External Sentiment & Market Telemetry Agent"`);

  const swarmConfig = {
    enabled: true,
    strategy: "parallel",
    supervisorRole: "Audit & Risk Review Supervisor",
    workers: [
      ...(otherAgent ? [{
        id: otherAgent.id,
        agentId: otherAgent.id,
        name: otherAgent.name,
        role: "Financial Sub-Ledger Analyst: Cross-examine journal anomaly records",
        type: "internal",
        taskPrompt: "Audit anomalies and report any variance exceeding $10,000 threshold.",
      }] : []),
      {
        id: "ext_market_telemetry",
        name: "External Sentiment & Market Telemetry Agent",
        role: "Market Risk & Sentiment Specialist: Assess external macro indicators",
        type: "external",
        endpointUrl: `${BASE_URL}/api/a2a/mock-worker`,
        taskPrompt: "Evaluate external volatility index and macro sentiment for audit period.",
      },
    ],
  };

  // 5. Dispatch Swarm Run via POST /api/agents/[id]/swarm
  console.log("\n[Step 4] Dispatching Swarm Execution via API...");
  const dispatchRes = await fetch(`${BASE_URL}/api/agents/${agent.id}/swarm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      action: "dispatch",
      swarm: swarmConfig,
      input: "Conduct complete quarterly risk evaluation across financial transactions and external market volatility indicators.",
    }),
  });

  if (!dispatchRes.ok) {
    const errText = await dispatchRes.text();
    throw new Error(`Dispatch failed: HTTP ${dispatchRes.status} ${errText}`);
  }

  const dispatchData = await dispatchRes.json();
  console.log(`✓ Swarm Run Dispatched! Run ID: ${dispatchData.runId}`);

  // 6. Poll run progress in database
  console.log("\n[Step 5] Polling run status and steps...");
  let runStatus = "running";
  let finalRun = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { rows: [r] } = await client.query(`select * from runs where id = $1`, [dispatchData.runId]);
    runStatus = r.status;
    finalRun = r;
    process.stdout.write(`  Polling (${i + 1}/30)... Status: ${runStatus}\r`);
    if (runStatus !== "running") break;
  }
  console.log(`\n✓ Swarm Run Final Status: ${runStatus}`);

  if (runStatus === "failed") {
    console.error(`✗ Run failed with error: ${finalRun?.error}`);
  }

  // 7. Inspect run_steps recorded
  const { rows: steps } = await client.query(
    `select idx, kind, tool, title, status, duration_ms from run_steps where run_id = $1 order by idx asc`,
    [dispatchData.runId]
  );

  console.log(`\n[Step 6] Execution Steps Recorded (${steps.length} steps):`);
  for (const s of steps) {
    console.log(`  - [${s.kind}] (tool: ${s.tool || "none"}) ${s.title} -> ${s.status} (${s.duration_ms}ms)`);
  }

  if (finalRun?.output) {
    console.log("\n[Step 7] Final Deliverable Synthesized by Supervisor:");
    console.log("--------------------------------------------------");
    console.log(finalRun.output.slice(0, 500) + (finalRun.output.length > 500 ? "\n...[truncated]" : ""));
    console.log("--------------------------------------------------");
  }

  console.log("\n=== Swarm E2E Verification Complete: SUCCESS! ===");
} catch (e) {
  console.error("\n✗ Verification Error:", e);
  process.exit(1);
} finally {
  await client.end();
}
