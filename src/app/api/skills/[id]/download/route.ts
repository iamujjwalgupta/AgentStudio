import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatSkillAsMarkdown } from "@/lib/skill-export";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const skill = await one<any>(
    `select id, name, label, description, instructions from skills where id = $1 and org_id = $2`,
    [id, u.orgId]
  );
  if (!skill) return NextResponse.json({ error: "Skill not found" }, { status: 404 });

  const mdContent = formatSkillAsMarkdown(skill);
  const slug = skill.name || "skill";

  return new Response(mdContent, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}.md"`,
    },
  });
}
