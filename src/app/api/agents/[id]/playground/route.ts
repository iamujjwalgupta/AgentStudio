import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

interface StepTrace {
  idx: number;
  thought: string;
  toolCall?: {
    tool: string;
    input: any;
    output: any;
    status: "ok" | "held" | "error";
    durationMs: number;
  };
  outputSummary?: string;
  isComplete?: boolean;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;

  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { prompt, mode = "normal", step = 0, history = [] } = body;

  const userGoal = prompt || "Analyze workspace telemetry and draft summary.";
  const spec = agent.draft_spec || {};
  const tools = spec.tools || [];
  const primaryTool = tools[0]?.id || "database_query";

  // Synthesize realistic execution trace steps based on user prompt and agent tools
  const simulatedSteps: StepTrace[] = [
    {
      idx: 1,
      thought: `Deconstructing user directive: "${userGoal}". Formulating verification plan against connected data sources and guardrails.`,
      toolCall: {
        tool: primaryTool,
        input: {
          query: userGoal,
          scope: spec.domain || "workspace-data",
          maxRecords: 50,
        },
        output: {
          status: "success",
          recordsFound: 24,
          metrics: { anomaliesDetected: 2, variancePercent: "+3.4%" },
          summary: "Retrieved relevant records from connected data source.",
        },
        status: "ok",
        durationMs: 38,
      },
    },
    {
      idx: 2,
      thought: `Data extracted successfully. Correlating metrics and evaluating against agent guardrail policies (stayInScope: true, maxSteps: ${spec.guardrails?.maxSteps || 12}).`,
      toolCall: {
        tool: tools[1]?.id || "semantic_knowledge_search",
        input: {
          topic: spec.purpose || userGoal,
          top_k: 3,
        },
        output: {
          citations: ["Q3 Policy Manual §4.2", "Internal Variance SOP v2"],
          status: "verified",
        },
        status: "ok",
        durationMs: 52,
      },
    },
    {
      idx: 3,
      thought: `Synthesizing final executive deliverable according to output specification ("${spec.output?.format || "Markdown summary"}").`,
      outputSummary: `### Executive Analysis & Findings\n\n- **Directive**: ${userGoal}\n- **Verified Records**: 24 transactions reviewed\n- **Key Highlights**: Telemetry variance remains within established threshold (+3.4%). Two minor deviations isolated and cataloged for audit trail.\n- **Status**: Completed successfully under guardrail compliance.`,
      isComplete: true,
    },
  ];

  // In step-by-step breakpoint mode, return up to the requested step
  if (mode === "step") {
    const currentTrace = simulatedSteps[Math.min(step, simulatedSteps.length - 1)];
    const isLast = step >= simulatedSteps.length - 1;

    return NextResponse.json({
      ok: true,
      mode: "step",
      currentStep: step,
      totalSteps: simulatedSteps.length,
      trace: currentTrace,
      isPausedAtBreakpoint: !isLast,
      isComplete: isLast,
      tokens: { prompt: 840 + step * 120, completion: 180 + step * 60 },
    });
  }

  // Normal mode returns the full executed sequence
  return NextResponse.json({
    ok: true,
    mode: "normal",
    steps: simulatedSteps,
    finalDeliverable: simulatedSteps[simulatedSteps.length - 1].outputSummary,
    tokens: { prompt: 1140, completion: 360 },
    totalDurationMs: 142,
  });
}
