import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { skillName, LABEL_MAX, DESCRIPTION_MAX, INSTRUCTIONS_MAX } from "@/lib/skills";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const skill = await one(
    `select id, name, label, description, instructions, created_at, updated_at
       from skills where id = $1 and org_id = $2`,
    [id, u.orgId],
  );
  if (!skill) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ skill });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const { label, description, instructions } = await req.json();

  const current = await one<any>(`select * from skills where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nextLabel = String(label ?? current.label).trim().slice(0, LABEL_MAX);
  if (!nextLabel) return NextResponse.json({ error: "Give the skill a name." }, { status: 400 });

  const nextName = skillName(nextLabel);
  if (!nextName) return NextResponse.json({ error: "The name needs at least one letter or digit." }, { status: 400 });

  if (nextName !== current.name) {
    const clash = await one<any>(`select label from skills where org_id = $1 and name = $2 and id <> $3`, [
      u.orgId,
      nextName,
      id,
    ]);
    if (clash) {
      return NextResponse.json(
        { error: `"${clash.label}" already answers to the name "${nextName}". Pick another.` },
        { status: 409 },
      );
    }
  }

  const row = await one<any>(
    `update skills set name = $3, label = $4, description = $5, instructions = $6, updated_at = now()
      where id = $1 and org_id = $2
      returning id, name, label, description, instructions, created_at, updated_at`,
    [
      id,
      u.orgId,
      nextName,
      nextLabel,
      String(description ?? current.description).trim().slice(0, DESCRIPTION_MAX),
      String(instructions ?? current.instructions).slice(0, INSTRUCTIONS_MAX),
    ],
  );

  // An edit here reaches every agent holding the skill on its next run, without
  // passing through publish. Recorded with both sides so the change is legible
  // later, when an agent's behaviour is being explained.
  await audit(u.orgId, u, "Edited skill", "skill", id, {
    name: nextName,
    label: nextLabel,
    renamedFrom: nextName !== current.name ? current.name : undefined,
    instructionsChanged: String(instructions ?? current.instructions) !== current.instructions,
  });
  return NextResponse.json({ skill: row });
}

/**
 * Agents keep the id in their spec. skillsFor drops what no longer resolves, so
 * an agent whose skill was deleted loses that know-how and carries on rather
 * than failing — but it is a real change to how it behaves, so the caller is
 * told how many agents were holding it.
 */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;

  const skill = await one<any>(`select name, label from skills where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!skill) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const held = await one<any>(
    `select count(*)::int as n from agents a
      where a.org_id = $1
        and jsonb_typeof(a.draft_spec -> 'skills') = 'array'
        and a.draft_spec -> 'skills' ? $2::text`,
    [u.orgId, id],
  );

  await one(`delete from skills where id = $1 and org_id = $2 returning id`, [id, u.orgId]);
  await audit(u.orgId, u, "Deleted skill", "skill", id, {
    name: skill.name,
    label: skill.label,
    agentsAffected: held?.n ?? 0,
  });
  return NextResponse.json({ ok: true, label: skill.label, agentsAffected: held?.n ?? 0 });
}
