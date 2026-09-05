import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { audit } from "@/lib/ai";
import { skillName, LABEL_MAX, DESCRIPTION_MAX, INSTRUCTIONS_MAX } from "@/lib/skills";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const u = await requireUser();
  const { label, description, instructions, agentId, attachImmediately = true } = await req.json();

  if (!String(label || "").trim()) {
    return NextResponse.json({ error: "Give the skill a name." }, { status: 400 });
  }
  if (!String(instructions || "").trim()) {
    return NextResponse.json({ error: "A skill with no instructions has nothing to teach." }, { status: 400 });
  }

  let baseName = skillName(label);
  if (!baseName) baseName = "corrective-policy";

  // If a skill with this slug already exists in this org, append a random suffix to prevent collisions
  let name = baseName;
  const existing = await one<any>(`select id from skills where org_id = $1 and name = $2`, [u.orgId, name]);
  if (existing) {
    name = `${baseName.slice(0, 50)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const skill = await one<any>(
    `insert into skills (org_id, name, label, description, instructions, created_by)
     values ($1, $2, $3, $4, $5, $6)
     returning id, name, label, description, instructions, created_at, updated_at`,
    [
      u.orgId,
      name,
      String(label).trim().slice(0, LABEL_MAX),
      String(description || "").trim().slice(0, DESCRIPTION_MAX),
      String(instructions).slice(0, INSTRUCTIONS_MAX),
      u.id,
    ],
  );

  let attached = false;
  let agentName: string | null = null;

  if (agentId && attachImmediately) {
    const agent = await one<any>(`select id, name, draft_spec from agents where id = $1 and org_id = $2`, [
      agentId,
      u.orgId,
    ]);
    if (agent) {
      agentName = agent.name;
      let draftSpec = agent.draft_spec || {};
      if (typeof draftSpec === "string") {
        try { draftSpec = JSON.parse(draftSpec); } catch {}
      }
      const existingSkills = Array.isArray(draftSpec.skills) ? draftSpec.skills : [];
      if (!existingSkills.includes(skill.id)) {
        draftSpec.skills = [...existingSkills, skill.id];
        await one(
          `update agents set draft_spec = $1, updated_at = now() where id = $2 and org_id = $3 returning id`,
          [JSON.stringify(draftSpec), agent.id, u.orgId],
        );
        attached = true;
      }
    }
  }

  await audit(u.orgId, u, "Created skill from human feedback", "skill", skill.id, {
    name: skill.name,
    label: skill.label,
    attachedToAgentId: attached ? agentId : null,
    attachedToAgentName: attached ? agentName : null,
  });

  return NextResponse.json({
    skill,
    attached,
    agentName,
  });
}
