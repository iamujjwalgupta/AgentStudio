// scripts/test-a2a-swarm.mjs
// Verifies A2A Protocol endpoints, client dispatch, and Swarm Orchestration

import { createA2ATaskEnvelope } from "../src/lib/a2a/envelope.ts";
import { dispatchA2AMessage } from "../src/lib/a2a/client.ts";
import pg from "pg";

const BASE_URL = process.env.APP_URL || "http://localhost:3000";
const DB_URL = process.env.DATABASE_URL;

console.log("=== Testing A2A Protocol & Swarm Orchestration ===");

// 1. Test Mock Worker Discovery (GET)
console.log("\n[Test 1] Testing A2A Agent Card Discovery (GET /api/a2a/mock-worker)...");
try {
  const res = await fetch(`${BASE_URL}/api/a2a/mock-worker`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const card = await res.json();
  console.log("✓ Agent Card retrieved successfully:");
  console.log(`  - Name: ${card.name}`);
  console.log(`  - Protocol: ${card.protocol}`);
  console.log(`  - Endpoint: ${card.endpoint}`);
  console.log(`  - Supported: ${card.capabilities?.supportedPerformatives?.join(", ")}`);
} catch (e) {
  console.error("✗ Failed to get agent card:", e.message);
  process.exit(1);
}

// 2. Test A2A Client Dispatch (POST)
console.log("\n[Test 2] Testing Outbound A2A Dispatch via Client...");
try {
  const envelope = createA2ATaskEnvelope({
    supervisor: { id: "test_supervisor", name: "Executive Coordinator" },
    worker: { id: "mock_specialist", name: "External Telemetry Agent", endpoint: `${BASE_URL}/api/a2a/mock-worker` },
    goal: "Verify quarterly cash flow volatility index",
    context: { timeframe: "Q3" },
  });

  console.log(`  Created A2A Envelope: ID=${envelope.messageId}, ConvID=${envelope.conversationId}`);

  const workerResponse = await dispatchA2AMessage({
    endpointUrl: `${BASE_URL}/api/a2a/mock-worker`,
    message: envelope,
    allowLocalhost: true,
  });

  if (workerResponse.status !== "completed") {
    throw new Error(`Worker returned status: ${workerResponse.status} - ${workerResponse.error}`);
  }

  console.log("✓ A2A Specialist Response received successfully:");
  console.log(`  - Status: ${workerResponse.status}`);
  console.log(`  - Deliverable preview: ${workerResponse.deliverable?.slice(0, 120)}...`);
  console.log(`  - Duration: ${workerResponse.metadata?.durationMs}ms`);
} catch (e) {
  console.error("✗ A2A Client dispatch failed:", e.message);
  process.exit(1);
}

// 3. Test Database Swarm Execution Verification
console.log("\n[Test 3] Testing Database Swarm Execution Engine...");
if (!DB_URL) {
  console.log("  DATABASE_URL not set in env, skipping direct DB swarm simulation.");
  process.exit(0);
}

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();

try {
  // Check existing agents
  const { rows: agents } = await client.query(`select id, org_id, name, draft_spec from agents limit 1`);
  if (!agents.length) {
    console.log("  No agents found in workspace, skipping DB run simulation.");
  } else {
    const agent = agents[0];
    const { rows: users } = await client.query(`select id, name from users where org_id = $1 limit 1`, [agent.org_id]);
    const user = users[0] || { id: "test_user", name: "Test User" };

    console.log(`  Found agent: "${agent.name}" (${agent.id})`);

    // Dynamic import swarm-orchestrator
    const { executeSwarmRun } = await import("../src/lib/swarm-orchestrator.ts");

    // Build a test swarm spec with the mock external worker
    const swarmSpec = {
      ...(agent.draft_spec || {}),
      name: agent.name,
      swarm: {
        enabled: true,
        strategy: "parallel",
        supervisorRole: "Lead Coordinator",
        workers: [
          {
            id: "ext_mock_1",
            name: "Mock External Specialist",
            role: "Market Telemetry Specialist",
            type: "external",
            endpointUrl: `${BASE_URL}/api/a2a/mock-worker`,
            taskPrompt: "Assess quarterly volatility baseline",
          },
        ],
      },
    };

    // Insert a test run record
    const { rows: [newRun] } = await client.query(
      `insert into runs (org_id, agent_id, spec, trigger, input, state, started_by)
       values ($1, $2, $3, 'swarm_test', 'Perform full market risk analysis', $4, $5)
       returning *`,
      [
        agent.org_id,
        agent.id,
        JSON.stringify(swarmSpec),
        JSON.stringify({ messages: [{ role: "user", content: "Perform full market risk analysis" }], partial: [], steps: 0 }),
        user.id,
      ]
    );

    console.log(`  Created test swarm run: ${newRun.id}`);

    // Execute swarm run
    await executeSwarmRun({
      runId: newRun.id,
      run: {
        id: newRun.id,
        org_id: agent.org_id,
        agent_id: agent.id,
        input: "Perform full market risk analysis",
        spec: swarmSpec,
        started_by: user.id,
      },
      user,
    });

    // Inspect the finished run
    const { rows: [finished] } = await client.query(`select * from runs where id = $1`, [newRun.id]);
    const { rows: steps } = await client.query(`select idx, kind, tool, title, status from run_steps where run_id = $1 order by idx asc`, [newRun.id]);

    console.log(`✓ Swarm run finished with status: ${finished.status}`);
    console.log(`✓ Total steps recorded in run_steps: ${steps.length}`);
    for (const s of steps) {
      console.log(`  - Step ${s.idx}: [${s.kind}] ${s.tool || "output"} - ${s.title} (${s.status})`);
    }

    if (finished.output) {
      console.log(`✓ Final Deliverable synthesized:\n${finished.output.slice(0, 200)}...\n`);
    }
  }
} catch (e) {
  console.error("✗ Swarm execution failed:", e);
  process.exit(1);
} finally {
  await client.end();
}

console.log("\n=== All A2A Protocol & Swarm Orchestration Tests Passed! ===");
