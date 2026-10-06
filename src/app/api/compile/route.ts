import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { compileBrief, audit } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const u = await requireUser();
  const { brief, engine } = await req.json();
  if (!brief?.trim()) return NextResponse.json({ error: "Describe the work first." }, { status: 400 });
  // The model key is not a data source, so it is never offered to the compiler.
  const connections = await q<any>(
    `select id, name, kind, config from connections where org_id = $1 and kind not in ('anthropic', 'gemini')`,
    [u.orgId],
  );
  try {
    const spec = await compileBrief(u.orgId, brief, connections, u.id, engine === "gemini" ? "gemini" : engine === "anthropic" ? "anthropic" : undefined);
    await audit(u.orgId, u, "Compiled brief into a specification", "agent", null, { name: spec.name });
    return NextResponse.json({ spec });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "The brief could not be compiled." }, { status: 500 });
  }
}
