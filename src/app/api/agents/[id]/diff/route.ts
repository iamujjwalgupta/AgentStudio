import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { diffSpecs } from "@/lib/spec-diff";
import { toolById } from "@/lib/tools";
import type { AgentSpec } from "@/lib/types";

export const runtime = "nodejs";

/**
 * What changed between two versions of an agent, or between the live version
 * and the draft about to be published.
 *
 *   ?from=2&to=3        compare two published versions
 *   ?from=2&to=draft    what publishing would change  (the default)
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const url = new URL(req.url);

  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const to = url.searchParams.get("to") || "draft";
  const from = url.searchParams.get("from") || (agent.published_ver ? String(agent.published_ver) : "");

  async function specOf(ref: string): Promise<{ spec: AgentSpec; label: string } | null> {
    if (ref === "draft") return { spec: agent.draft_spec, label: "the draft" };
    const n = Number(ref);
    if (!Number.isInteger(n)) return null;
    const v = await one<any>(`select spec, version from agent_versions where agent_id = $1 and version = $2`, [id, n]);
    return v ? { spec: v.spec, label: `v${v.version}` } : null;
  }

  if (!from) {
    return NextResponse.json({
      error: "There is no published version to compare against yet.",
      unavailable: true,
    });
  }

  const a = await specOf(from);
  const b = await specOf(to);
  if (!a || !b) return NextResponse.json({ error: "That version does not exist." }, { status: 404 });

  const diff = diffSpecs(a.spec, b.spec, (toolId) => toolById(toolId)?.risk ?? "low");
  return NextResponse.json({ from: a.label, to: b.label, ...diff });
}
