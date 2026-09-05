// Seeds the finance agent library into a workspace. Safe to re-run: an agent
// whose name already exists in the org is skipped, never duplicated or overwritten.
//
//   node --env-file=.env scripts/seed-agents.mjs [--org "<workspace name>"] [--dry-run]
//
// Gates are derived from tool risk, never taken from the definitions, and an
// agent is only published if it passes the same checks the /publish route runs.
import pg from "pg";
import { AGENTS } from "./finance-agents.mjs";

// Mirrors the registry in src/lib/tools.ts. Verified against it at startup.
const TOOLS = {
  web_search: { label: "Search the web", risk: "low" },
  fetch_url: { label: "Fetch a web page", risk: "low" },
  sql_query: { label: "Query a database", risk: "low", needs: "postgres" },
  read_document: { label: "Read an uploaded document", risk: "low" },
  http_request: { label: "Call an API", risk: "medium", needs: "http" },
  send_email: { label: "Send an email", risk: "medium", needs: "smtp" },
  post_message: { label: "Post to Slack", risk: "medium", needs: "slack" },
  write_file: { label: "Write a file", risk: "low" },
  invoke_agent: { label: "Delegate to another agent", risk: "low" },
};

const gateFor = (risk) => (risk === "low" ? "auto" : "approval");

function buildSpec(a) {
  return {
    name: a.name,
    archetype: a.archetype,
    purpose: a.purpose,
    brief: a.brief,
    domain: a.domain,
    sources: [], // no connections provisioned yet; the user grants them in the builder
    steps: a.steps,
    tools: a.tools.map((id) => ({ id, gate: gateFor(TOOLS[id].risk) })),
    inputs: a.inputs || [],
    output: a.output,
    trigger: a.trigger,
    guardrails: {
      maxSteps: 12,
      requireCitations: true,
      escalateOnAmbiguity: true,
      stayInScope: true,
      extra: "",
      ...(a.guardrails || {}),
    },
  };
}

/** The same checks src/app/api/agents/[id]/publish/route.ts applies. */
function blockers(spec) {
  const fails = [];
  if (!spec.name?.trim()) fails.push("The agent needs a name.");
  if (!spec.steps?.length || spec.steps.some((s) => !s.trim())) fails.push("Every instruction step must be filled in.");
  if (!spec.tools?.length) fails.push("Grant the agent at least one tool.");
  for (const t of spec.tools || []) {
    const def = TOOLS[t.id];
    if (!def) fails.push(`Unknown tool ${t.id}.`);
    else if (def.risk !== "low" && t.gate !== "approval") fails.push(`${def.label} is ${def.risk} risk and must require approval.`);
    else if (def.needs && !spec.sources.length) fails.push(`${def.label} needs a ${def.needs} connection.`);
  }
  if (spec.trigger?.type === "schedule" && !spec.trigger.schedule) fails.push("Set the schedule.");
  return fails;
}

const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const dryRun = process.argv.includes("--dry-run");
const orgName = argOf("--org");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run with: node --env-file=.env scripts/seed-agents.mjs");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  // Fail loudly if the tool registry has moved on since this table was written.
  const names = new Set(Object.keys(TOOLS));
  for (const a of AGENTS) {
    for (const id of a.tools) {
      if (!names.has(id)) throw new Error(`"${a.name}" uses unknown tool "${id}".`);
    }
  }
  const dupes = AGENTS.map((a) => a.name).filter((n, i, all) => all.indexOf(n) !== i);
  if (dupes.length) throw new Error(`Duplicate agent names in the library: ${dupes.join(", ")}`);

  const org = orgName
    ? (await client.query(`select id, name from orgs where name = $1`, [orgName])).rows[0]
    : (await client.query(`select id, name from orgs order by created_at limit 1`)).rows[0];
  if (!org) throw new Error("No workspace found. Sign up at http://localhost:3000 first.");

  const owner = (
    await client.query(
      `select id, name from users where org_id = $1 order by (role = 'admin') desc, created_at limit 1`,
      [org.id],
    )
  ).rows[0];
  if (!owner) throw new Error(`Workspace "${org.name}" has no users.`);

  console.log(`Workspace: ${org.name}`);
  console.log(`Owner:     ${owner.name}`);
  console.log(`Library:   ${AGENTS.length} agents\n`);

  let created = 0,
    published = 0,
    skipped = 0;
  const held = [];

  for (const a of AGENTS) {
    const spec = buildSpec(a);
    const fails = blockers(spec);

    const exists = (await client.query(`select id from agents where org_id = $1 and name = $2`, [org.id, spec.name]))
      .rows[0];
    if (exists) {
      skipped++;
      console.log(`  ·  ${spec.name} — already exists, left alone`);
      continue;
    }
    if (fails.length) held.push({ name: spec.name, reason: fails.join(" ") });

    if (dryRun) {
      console.log(`  ${fails.length ? "◦" : "✓"}  ${spec.name}${fails.length ? `  — draft: ${fails.join(" ")}` : ""}`);
      created++;
      if (!fails.length) published++;
      continue;
    }

    const agent = (
      await client.query(
        `insert into agents (org_id, name, description, archetype, owner_id, draft_spec, status)
         values ($1,$2,$3,$4,$5,$6,'draft') returning id`,
        [org.id, spec.name, spec.purpose, spec.archetype, owner.id, JSON.stringify(spec)],
      )
    ).rows[0];
    created++;
    await client.query(
      `insert into audit_events (org_id, actor_id, actor_name, action, entity, entity_id, detail)
       values ($1,$2,$3,'Created agent','agent',$4,$5)`,
      [org.id, owner.id, owner.name, agent.id, JSON.stringify({ name: spec.name, source: "finance library seed" })],
    );

    if (!fails.length) {
      await client.query(
        `insert into agent_versions (agent_id, version, spec, note, created_by) values ($1,1,$2,$3,$4)`,
        [agent.id, JSON.stringify(spec), "First published version.", owner.id],
      );
      await client.query(`update agents set status = 'published', published_ver = 1, updated_at = now() where id = $1`, [
        agent.id,
      ]);
      await client.query(
        `insert into audit_events (org_id, actor_id, actor_name, action, entity, entity_id, detail)
         values ($1,$2,$3,'Published agent','agent',$4,$5)`,
        [org.id, owner.id, owner.name, agent.id, JSON.stringify({ version: 1, name: spec.name })],
      );
      published++;
      console.log(`  ✓  ${spec.name}  —  v1 live`);
    } else {
      console.log(`  ◦  ${spec.name}  —  draft: ${fails.join(" ")}`);
    }
  }

  console.log(`\n${dryRun ? "Would create" : "Created"} ${created}, published ${published}, skipped ${skipped}.`);

  if (held.length) {
    const byConn = {};
    for (const h of held) {
      const kind =
        [...h.reason.matchAll(/needs a (postgres|http|smtp|slack) connection/g)].map((m) => m[1]).join(" + ") ||
        "other";
      (byConn[kind] ||= []).push(h.name);
    }
    console.log(`\n${held.length} agents are drafts until a connection exists. Add it under Connections, grant it in the`);
    console.log(`agent's Data step, then publish:\n`);
    for (const [kind, list] of Object.entries(byConn)) {
      console.log(`  ${kind}`);
      for (const n of list) console.log(`      ${n}`);
    }
  }
} catch (e) {
  console.error("\nSeed failed:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
