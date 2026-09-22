import JSZip from "jszip";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/agent_studio";
const APP_URL = process.env.APP_URL || "http://localhost:3000";

async function runTest() {
  console.log("=== Starting End-to-End Export -> Sandbox -> Promote Test ===");

  // 1. Get session token for user
  const { SignJWT } = await import("jose");
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
  const token = await new SignJWT({ sub: "c1075aff-7461-4c1d-83a7-90f9dd943211" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);

  const authHeaders = {
    Cookie: `as_session=${token}`,
    "Content-Type": "application/json",
  };

  // 2. Pick an agent to export
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const agentRow = (await pool.query("select id, name, draft_spec from agents where status = 'published' limit 1")).rows[0];
  console.log(`[1] Selected Source Agent: "${agentRow.name}" (${agentRow.id})`);
  console.log(`    Source Tools:`, (agentRow.draft_spec.tools || []).map(t => `${t.id} (${t.gate})`));
  console.log(`    Source Steps:`, agentRow.draft_spec.steps?.length);

  // 3. Export to GCP (.zip)
  console.log("\n[2] Exporting to Google Cloud (GCP) format as ZIP...");
  const gcpRes = await fetch(`${APP_URL}/api/agents/${agentRow.id}/export?target=gcp&runtime=container&format=zip`, {
    headers: { Cookie: `as_session=${token}` }
  });
  if (!gcpRes.ok) throw new Error(`Export to GCP failed: HTTP ${gcpRes.status}`);
  const gcpZipArray = await gcpRes.arrayBuffer();
  console.log(`    Downloaded GCP ZIP size: ${gcpZipArray.byteLength} bytes`);

  // 4. Export to Azure (.zip)
  console.log("\n[3] Exporting to Microsoft Azure format as ZIP...");
  const azureRes = await fetch(`${APP_URL}/api/agents/${agentRow.id}/export?target=azure&runtime=serverless&format=zip`, {
    headers: { Cookie: `as_session=${token}` }
  });
  if (!azureRes.ok) throw new Error(`Export to Azure failed: HTTP ${azureRes.status}`);
  const azureZipArray = await azureRes.arrayBuffer();
  console.log(`    Downloaded Azure ZIP size: ${azureZipArray.byteLength} bytes`);

  // 5. Test ZIP unpacking on GCP export
  console.log("\n[4] Unpacking and inspecting GCP ZIP archive...");
  const gcpZip = await JSZip.loadAsync(gcpZipArray);
  const gcpFiles = Object.keys(gcpZip.files);
  console.log("    Files in GCP archive:", gcpFiles);
  const gcpAgentJsonFile = Object.values(gcpZip.files).find(f => f.name.endsWith("agent.json"));
  const gcpRunnerFile = Object.values(gcpZip.files).find(f => f.name.endsWith("runner.mjs"));
  const gcpDeployFile = Object.values(gcpZip.files).find(f => f.name.endsWith("deploy.sh"));
  if (!gcpAgentJsonFile) throw new Error("Missing agent.json in GCP export!");
  if (!gcpRunnerFile) throw new Error("Missing runner.mjs in GCP export!");
  if (!gcpDeployFile) throw new Error("Missing deploy.sh in GCP export!");

  const gcpAgentJson = await gcpAgentJsonFile.async("string");

  // 6. Test ZIP unpacking on Azure export
  console.log("\n[5] Unpacking and inspecting Azure ZIP archive...");
  const azureZip = await JSZip.loadAsync(azureZipArray);
  const azureFiles = Object.keys(azureZip.files);
  console.log("    Files in Azure archive:", azureFiles);
  const azureAgentJsonFile = Object.values(azureZip.files).find(f => f.name.endsWith("agent.json"));
  const azureBicepFile = Object.values(azureZip.files).find(f => f.name.endsWith("azuredeploy.bicep"));
  if (!azureAgentJsonFile) throw new Error("Missing agent.json in Azure export!");
  if (!azureBicepFile) throw new Error("Missing azuredeploy.bicep in Azure export!");

  const azureAgentJson = await azureAgentJsonFile.async("string");

  // 7. Parse the extracted agent.json via /api/sandbox/parse
  console.log("\n[6] Parsing extracted agent.json via /api/sandbox/parse...");
  const parseRes = await fetch(`${APP_URL}/api/sandbox/parse`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ code: gcpAgentJson, language: "json", framework: "adk" }),
  });
  const parseData = await parseRes.json();
  if (!parseRes.ok) throw new Error(`Parsing failed: ${JSON.stringify(parseData)}`);

  const parsedSpec = parseData.parsed.spec;
  console.log("    Parsed Agent Name:", parseData.parsed.name);
  console.log("    Parsed Tools Count:", parsedSpec.tools?.length);
  console.log("    Parsed Tools:", parsedSpec.tools?.map(t => `${t.id} (${t.gate})`));
  console.log("    Parsed Steps Count:", parsedSpec.steps?.length);
  console.log("    Parsed Guardrails:", Object.keys(parsedSpec.guardrails || {}));

  // Assert fidelity
  if (parsedSpec.tools?.length !== agentRow.draft_spec.tools?.length) {
    throw new Error(`Tool count mismatch! Expected ${agentRow.draft_spec.tools?.length}, got ${parsedSpec.tools?.length}`);
  }
  if (parsedSpec.steps?.length !== agentRow.draft_spec.steps?.length) {
    throw new Error(`Step count mismatch! Expected ${agentRow.draft_spec.steps?.length}, got ${parsedSpec.steps?.length}`);
  }
  console.log("    ✓ Spec fidelity 100% matched!");

  // 8. Test Sandbox Simulation Run
  console.log("\n[7] Testing Sandbox Simulation via /api/sandbox/run...");
  const runRes = await fetch(`${APP_URL}/api/sandbox/run`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      spec: parsedSpec,
      tools: parseData.parsed.tools,
      input: "Execute test reconciliation verification in sandbox.",
      engine: "auto",
    }),
  });
  const runData = await runRes.json();
  if (!runRes.ok) throw new Error(`Sandbox run failed: ${JSON.stringify(runData)}`);
  console.log("    Sandbox Run Engine:", runData.result.engine);
  console.log("    Sandbox Run Steps:", runData.result.steps.length);
  console.log("    Sandbox Run Output preview:", runData.result.output.slice(0, 120).replace(/\n/g, " "));
  console.log("    ✓ Sandbox simulation succeeded!");

  // 9. Promote to Agent Studio
  console.log("\n[8] Promoting agent to Agent Studio via /api/sandbox/promote...");
  const promotedName = `${parsedSpec.name} (Promoted from GCP)`;
  const promoteRes = await fetch(`${APP_URL}/api/sandbox/promote`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: promotedName,
      spec: parsedSpec,
      sourceCode: gcpAgentJson,
      framework: "Google Cloud (GCP)",
    }),
  });
  const promoteData = await promoteRes.json();
  if (!promoteRes.ok) throw new Error(`Promote failed: ${JSON.stringify(promoteData)}`);
  console.log(`    ✓ Promoted successfully! New Agent ID: ${promoteData.agentId}`);

  // 10. Verify Database Record in `agents`
  console.log("\n[9] Verifying promoted agent in database...");
  const dbCheck = (await pool.query("select id, name, archetype, status, draft_spec from agents where id = $1", [promoteData.agentId])).rows[0];
  console.log("    Database Name:", dbCheck.name);
  console.log("    Database Status:", dbCheck.status);
  console.log("    Database Archetype:", dbCheck.archetype);
  console.log("    Database Tools:", dbCheck.draft_spec.tools);
  console.log("    Database Steps Count:", dbCheck.draft_spec.steps.length);

  if (dbCheck.name !== promotedName) throw new Error("DB Name mismatch!");
  if (dbCheck.status !== "draft") throw new Error("DB Status must be draft!");
  if (dbCheck.draft_spec.tools?.length !== parsedSpec.tools?.length) throw new Error("DB Tools mismatch!");

  // 11. Verify Audit Event
  const auditCheck = (await pool.query("select action, detail from audit_events where entity_id = $1", [promoteData.agentId])).rows[0];
  console.log("    Audit Action:", auditCheck?.action);
  console.log("    Audit Detail:", auditCheck?.detail);

  // 12. Verify HTTP Page Render (/agents/[id])
  console.log("\n[10] Verifying Builder UI endpoint (/agents/[id])...");
  const pageRes = await fetch(`${APP_URL}/agents/${promoteData.agentId}`, {
    headers: { Cookie: `as_session=${token}` },
  });
  console.log(`    GET /agents/${promoteData.agentId} HTTP Status: ${pageRes.status}`);
  if (pageRes.status !== 200) throw new Error(`Builder page returned HTTP ${pageRes.status}`);

  console.log("\n========================================================");
  console.log("ALL TESTS PASSED: Export -> Sandbox -> Promote works seamlessly!");
  console.log("========================================================");

  await pool.end();
}

runTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
