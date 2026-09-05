// Seeds 50 domain skills corresponding to each finance agent into a workspace.
// Safe to re-run: updates existing skills if present and links them to matching agents.
//
//   node --env-file-if-exists=.env scripts/seed-skills.mjs [--org "<workspace name>"] [--dry-run]
//
import pg from "pg";
import { SKILLS } from "./finance-skills.mjs";

export function skillName(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const dryRun = process.argv.includes("--dry-run");
const orgName = argOf("--org");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run with: node --env-file-if-exists=.env scripts/seed-skills.mjs");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const org = orgName
    ? (await client.query(`select id, name from orgs where name = $1`, [orgName])).rows[0]
    : (await client.query(`select id, name from orgs order by created_at limit 1`)).rows[0];
  if (!org) throw new Error("No workspace found. Please log in or create a workspace first.");

  const owner = (
    await client.query(
      `select id, name from users where org_id = $1 order by (role = 'admin') desc, created_at limit 1`,
      [org.id],
    )
  ).rows[0];
  if (!owner) throw new Error(`Workspace "${org.name}" has no users.`);

  console.log(`Workspace: ${org.name}`);
  console.log(`Owner:     ${owner.name}`);
  console.log(`Skills:    ${SKILLS.length} skills to seed\n`);

  let createdCount = 0;
  let updatedCount = 0;
  let linkedCount = 0;

  for (const s of SKILLS) {
    const slug = skillName(s.label);
    const existing = (
      await client.query(`select id, label from skills where org_id = $1 and name = $2`, [org.id, slug])
    ).rows[0];

    let skillId;
    if (dryRun) {
      console.log(`  [dry-run] ${existing ? "Update" : "Create"} skill "${s.label}" (${slug})`);
      continue;
    }

    if (existing) {
      skillId = existing.id;
      await client.query(
        `update skills set label = $1, description = $2, instructions = $3, updated_at = now() where id = $4`,
        [s.label, s.description, s.instructions, skillId],
      );
      updatedCount++;
      console.log(`  ↻  Updated skill: "${s.label}"`);
    } else {
      const inserted = (
        await client.query(
          `insert into skills (org_id, name, label, description, instructions, created_by)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [org.id, slug, s.label, s.description, s.instructions, owner.id],
        )
      ).rows[0];
      skillId = inserted.id;
      createdCount++;
      await client.query(
        `insert into audit_events (org_id, actor_id, actor_name, action, entity, entity_id, detail)
         values ($1, $2, $3, 'Created skill', 'skill', $4, $5)`,
        [org.id, owner.id, owner.name, skillId, JSON.stringify({ name: slug, label: s.label, source: "finance skills seed" })],
      );
      console.log(`  ✓  Created skill: "${s.label}"`);
    }

    // Link skill to its corresponding agent if found
    const agent = (
      await client.query(
        `select id, name, draft_spec, published_ver from agents where org_id = $1 and name = $2`,
        [org.id, s.agentName],
      )
    ).rows[0];

    if (agent) {
      let draftSpec = agent.draft_spec || {};
      if (typeof draftSpec === "string") {
        try { draftSpec = JSON.parse(draftSpec); } catch {}
      }
      const existingSkills = Array.isArray(draftSpec.skills) ? draftSpec.skills : [];
      if (!existingSkills.includes(skillId)) {
        draftSpec.skills = [...existingSkills, skillId];
        await client.query(
          `update agents set draft_spec = $1, updated_at = now() where id = $2`,
          [JSON.stringify(draftSpec), agent.id],
        );
      }

      // If published version exists, also update latest version spec
      if (agent.published_ver) {
        const verRow = (
          await client.query(
            `select spec from agent_versions where agent_id = $1 and version = $2`,
            [agent.id, agent.published_ver],
          )
        ).rows[0];
        if (verRow) {
          let vSpec = verRow.spec || {};
          if (typeof vSpec === "string") {
            try { vSpec = JSON.parse(vSpec); } catch {}
          }
          const vSkills = Array.isArray(vSpec.skills) ? vSpec.skills : [];
          if (!vSkills.includes(skillId)) {
            vSpec.skills = [...vSkills, skillId];
            await client.query(
              `update agent_versions set spec = $1 where agent_id = $2 and version = $3`,
              [JSON.stringify(vSpec), agent.id, agent.published_ver],
            );
          }
        }
      }
      linkedCount++;
    }
  }

  console.log(`\nFinished! Created: ${createdCount}, Updated: ${updatedCount}, Attached to agents: ${linkedCount}.`);
} catch (err) {
  console.error("\nSkill seed failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
