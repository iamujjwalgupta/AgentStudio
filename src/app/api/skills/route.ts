import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { skillName, LABEL_MAX, DESCRIPTION_MAX, INSTRUCTIONS_MAX } from "@/lib/skills";
import { myLatestRequests, DOWNLOAD_WINDOW_DAYS } from "@/lib/skill-downloads";

export const runtime = "nodejs";

/**
 * Skills are workspace-wide and hold no credentials, so any member may read
 * them and any member may write a new one. Editing an existing skill changes how
 * every published agent holding it behaves on its next run, without going through
 * publish, so edits (and copying a skill out as a download) are reserved for the
 * owner and admins, and writes are audited.
 */
export async function GET() {
  const u = await requireUser();
  const rows = await q(
    `select s.id, s.name, s.label, s.description, s.instructions, s.created_at, s.updated_at,
            s.status, s.retired_at,
            us.name as author,
            -- Agents holding this skill, in their draft or in the version that is
            -- live. Both matter: one is what a builder would lose, the other is
            -- what would change under a running agent.
            (select count(*)::int from agents a
              where a.org_id = s.org_id
                and (
                  (jsonb_typeof(a.draft_spec -> 'skills') = 'array' and a.draft_spec -> 'skills' ? s.id::text)
                  or exists (
                    select 1 from agent_versions v
                     where v.agent_id = a.id and v.version = a.published_ver
                       and jsonb_typeof(v.spec -> 'skills') = 'array' and v.spec -> 'skills' ? s.id::text
                  )
                )) as used_by
       from skills s
       left join users us on us.id = s.created_by
      where s.org_id = $1
      order by s.label`,
    [u.orgId],
  );
  // Restoring a retired skill, editing one and copying one out (download) are for the
  // owner and admins; the page hides those controls from everyone else. Anyone else
  // requests a download, so each skill carries that person's latest request.
  const mine = u.canPublish ? new Map() : await myLatestRequests(u.orgId, u.id);
  const skills = rows.map((r: any) => ({ ...r, myRequest: mine.get(r.id) ?? null }));
  return NextResponse.json({
    skills,
    canRestore: u.canPublish,
    canEdit: u.canPublish,
    downloadWindowDays: DOWNLOAD_WINDOW_DAYS,
  });
}

export async function POST(req: Request) {
  const u = await requireUser();
  const { label, description, instructions } = await req.json();

  if (!String(label || "").trim()) {
    return NextResponse.json({ error: "Give the skill a name." }, { status: 400 });
  }
  if (!String(instructions || "").trim()) {
    return NextResponse.json({ error: "A skill with no instructions has nothing to teach. Write the body." }, { status: 400 });
  }

  const name = skillName(label);
  if (!name) {
    return NextResponse.json({ error: "The name needs at least one letter or digit." }, { status: 400 });
  }

  const clash = await one<any>(`select label, status from skills where org_id = $1 and name = $2`, [u.orgId, name]);
  if (clash) {
    return NextResponse.json(
      {
        error:
          clash.status === "retired"
            ? `A retired skill, "${clash.label}", already answers to the name "${name}". Restore it, or pick another name.`
            : `"${clash.label}" already answers to the name "${name}". Agents call a skill by that name, so pick another.`,
      },
      { status: 409 },
    );
  }

  const row = await one<any>(
    `insert into skills (org_id, name, label, description, instructions, created_by)
     values ($1,$2,$3,$4,$5,$6)
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
  await audit(u.orgId, u, "Created skill", "skill", row.id, { name, label: row.label });
  return NextResponse.json({ skill: row });
}
