import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { draftSkill } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Drafts a skill from a sentence about it. Nothing is stored: the draft lands
 * in the editor, and the person saves it themselves once they have read it.
 */
export async function POST(req: Request) {
  const u = await requireUser();
  const { brief } = await req.json();
  if (!String(brief || "").trim()) {
    return NextResponse.json({ error: "Describe the skill you want drafted." }, { status: 400 });
  }
  try {
    const draft = await draftSkill(u.orgId, String(brief).slice(0, 4000));
    return NextResponse.json({ draft });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "The skill could not be drafted." }, { status: 400 });
  }
}
