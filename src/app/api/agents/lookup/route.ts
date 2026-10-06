import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { agentNamed, similarAgents } from "@/lib/agent-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Small lookups for the Brief step:
 *   ?name=…            is that name already taken by another agent?
 *   ?industry=…&process=…   live agents in that area, to copy a brief from.
 * `exclude` leaves out the agent being edited.
 */
export async function GET(req: Request) {
  const u = await requireUser();
  const p = new URL(req.url).searchParams;
  const exclude = UUID.test(p.get("exclude") ?? "") ? p.get("exclude")! : undefined;
  const name = (p.get("name") ?? "").trim().slice(0, 200);
  if (name) {
    return NextResponse.json({ taken: await agentNamed(u.orgId, name, exclude) });
  }
  const industry = (p.get("industry") ?? "").trim().slice(0, 100) || undefined;
  const process = (p.get("process") ?? "").trim().slice(0, 20) || undefined;
  if (!industry && !process) return NextResponse.json({ similar: [] });
  return NextResponse.json({ similar: await similarAgents(u.orgId, { industry, process, exclude }) });
}
