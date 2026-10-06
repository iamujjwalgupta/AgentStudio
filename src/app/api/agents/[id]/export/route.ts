import { NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { skillsFor } from "@/lib/skills";
import { specSkillIds, type AgentSpec } from "@/lib/types";
import {
  generateExportBundle,
  createExportZip,
  type ExportTarget,
  type ExportRuntime,
} from "@/lib/agent-exporter";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;

  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const url = new URL(req.url);
  const rawTarget = url.searchParams.get("target") || "gcp";
  const rawRuntime = url.searchParams.get("runtime") || "container";
  const format = url.searchParams.get("format") || "zip";

  const target: ExportTarget = ["gcp", "aws", "azure", "docker", "python"].includes(rawTarget)
    ? (rawTarget as ExportTarget)
    : "gcp";

  const runtime: ExportRuntime = ["container", "serverless"].includes(rawRuntime)
    ? (rawRuntime as ExportRuntime)
    : "container";

  // Prefer published version spec; fallback to draft
  let spec = agent.draft_spec as AgentSpec;
  const ver = agent.published_ver;
  if (ver) {
    const verRow = await one<any>(`select spec from agent_versions where agent_id = $1 and version = $2`, [
      id,
      ver,
    ]);
    if (verRow?.spec) spec = verRow.spec;
  }

  if (!spec) {
    return NextResponse.json({ error: "No agent spec found to export." }, { status: 400 });
  }

  // Attached skills
  const skillIds = specSkillIds(spec);
  const granted = await skillsFor(u.orgId, skillIds);
  // Skill content leaves the workspace only with an admin's say-so (see skill download
  // requests). For anyone else the bundle keeps each skill's name and summary, so the
  // agent still knows what it had, but the instructions are withheld.
  const skills = u.canPublish
    ? granted
    : granted.map((s) => ({
        ...s,
        instructions:
          `_Instructions withheld from this export: only workspace admins can export skill content._\n\n` +
          `Request a download of "${s.label}" on the Skills page of Agent Studio; an admin must approve it.`,
      }));

  // Available connections for mapping names
  const connections = await q<any>(`select id, name, kind from connections where org_id = $1`, [u.orgId]);

  const bundle = generateExportBundle({
    spec,
    agentName: agent.name || spec.name,
    version: ver || null,
    target,
    runtime,
    skills,
    skillsWithheld: !u.canPublish && granted.length > 0,
    connections,
  });

  if (format === "json") {
    return NextResponse.json({ bundle });
  }

  const zipBuffer = await createExportZip(bundle);
  await audit(u.orgId, u, "Exported agent", "agent", id, {
    name: bundle.agentName,
    version: bundle.version,
    target: bundle.target,
    runtime: bundle.runtime,
    skillsWithheld: !u.canPublish && granted.length > 0,
  });

  return new Response(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${bundle.slug}-${bundle.target}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
