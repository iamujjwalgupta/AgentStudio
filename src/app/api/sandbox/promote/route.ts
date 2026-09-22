import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { audit } from "@/lib/ai";
import type { AgentSpec } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const u = await requireUser();
  try {
    const { name, spec, sourceCode, framework = "sandbox" } = await req.json();

    if (!spec || !spec.name) {
      return NextResponse.json({ error: "Invalid agent specification to promote." }, { status: 400 });
    }

    const agentName = (name || spec.name).trim();
    const archetype = spec.archetype || "analyst";
    const description = spec.purpose || spec.brief || "Imported agent from sandbox environment.";

    const draftSpec: AgentSpec = {
      ...spec,
      name: agentName,
      archetype,
      domain: spec.domain || "General",
      purpose: spec.purpose || description,
      brief: spec.brief || description,
      steps: spec.steps || [],
      tools: spec.tools || [],
      guardrails: spec.guardrails || {
        maxSteps: 12,
        requireCitations: true,
        escalateOnAmbiguity: true,
        stayInScope: true,
        extra: "",
      },
      output: spec.output || {
        format: "Markdown summary report",
        instructions: "Detail reasoning steps and action outcomes.",
      },
      inputs: spec.inputs || [],
      skills: spec.skills || [],
      sources: spec.sources || [],
      trigger: spec.trigger || { type: "manual" },
    };

    const row = await one<any>(
      `insert into agents (org_id, name, description, archetype, status, owner_id, draft_spec)
       values ($1, $2, $3, $4, 'draft', $5, $6)
       returning id, name`,
      [u.orgId, agentName, description, archetype, u.id, JSON.stringify(draftSpec)]
    );

    const frameworkLabels: Record<string, string> = {
      gcp: "Google Cloud (GCP)",
      azure: "Microsoft Azure",
      aws: "Amazon Web Services (AWS)",
      docker: "Docker Container",
      adk: "Google ADK",
      langchain: "LangChain",
      foundry: "Palantir Foundry AIP",
      openai: "OpenAI Swarm",
      sandbox: "Sandbox",
    };
    const frameworkLabel = frameworkLabels[framework.toLowerCase()] || framework;

    await audit(u.orgId, u, `Promoted ${frameworkLabel} agent to workspace`, "agent", row.id, {
      name: row.name,
      archetype,
      framework: frameworkLabel,
      toolsCount: spec.tools?.length || 0,
      hasSource: Boolean(sourceCode),
    });

    return NextResponse.json({ ok: true, agentId: row.id, name: row.name });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
