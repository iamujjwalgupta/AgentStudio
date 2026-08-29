import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { compileBrief, audit } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const u = await requireUser();
  const { brief } = await req.json();
  if (!brief?.trim()) return NextResponse.json({ error: "Describe the work first." }, { status: 400 });
  const connections = await q<any>(`select id, name, kind, config from connections where org_id = $1`, [u.orgId]);
  try {
    const spec = await compileBrief(brief, connections);
    await audit(u.orgId, u, "Compiled brief into a specification", "agent", null, { name: spec.name });
    return NextResponse.json({ spec });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "The brief could not be compiled." }, { status: 500 });
  }
}
