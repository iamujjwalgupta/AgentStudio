import { NextResponse } from "next/server";
import type { A2AMessage, A2AAgentCard } from "@/lib/a2a/types";

export const runtime = "nodejs";

/**
 * Discovery endpoint: returns the Agent Card for this mock external specialist.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const card: A2AAgentCard = {
    protocol: "a2a/1.0",
    agentId: "mock_external_specialist",
    name: "External Sentiment & Market Telemetry Agent",
    archetype: "analyst",
    description: "External autonomous specialist providing market signals, sentiment score, and risk indicators.",
    endpoint: `${url.origin}/api/a2a/mock-worker`,
    capabilities: {
      supportedPerformatives: ["REQUEST", "INFORM", "QUERY"],
      streaming: false,
      humanInTheLoop: false,
      maxConcurrentTasks: 10,
    },
    version: "1.0.0",
  };

  return NextResponse.json(card);
}

/**
 * Inbound A2A execution endpoint: receives A2A task delegation requests.
 */
export async function POST(req: Request) {
  try {
    const body: A2AMessage = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: "Invalid JSON or empty payload" },
        { status: 400 }
      );
    }

    const senderName = body.sender?.name || "Coordinator";
    const goal = body.payload?.goal || body.payload?.input || "Default specialist query";
    const context = body.payload?.context || {};

    // Simulate specialist computation and telemetry calculation
    const timestamp = new Date().toISOString();
    const sentimentScore = 0.84;
    const confidence = 0.92;

    const deliverable = [
      `### External Specialist Findings: Market & Sentiment Intelligence`,
      `**Task Objective**: ${goal}`,
      `**Dispatched By**: ${senderName}`,
      `**Sentiment Index**: Positive (+${sentimentScore}) with ${confidence * 100}% statistical confidence.`,
      `**Key Telemetry Signals**:`,
      `- Volatility Index: Stable (14.2)`,
      `- Social & Media Volume: +28% spike over rolling 24h baseline`,
      `- Anomaly Indicators: No regulatory flags or compliance deviations identified`,
      `**Recommendation**: Proceed with scheduled execution pipeline under standard risk parameters.`,
    ].join("\n\n");

    const reply: A2AMessage = {
      protocol: "a2a/1.0",
      messageId: `msg_${Math.random().toString(36).substring(2, 9)}`,
      conversationId: body.conversationId || `conv_${Math.random().toString(36).substring(2, 9)}`,
      parentMessageId: body.messageId,
      timestamp,
      sender: {
        id: "mock_external_specialist",
        name: "External Sentiment & Market Telemetry Agent",
        role: "External Market & Telemetry Specialist",
        endpoint: "/api/a2a/mock-worker",
      },
      recipient: body.sender,
      performative: "INFORM",
      payload: {
        status: "completed",
        deliverable,
        output: {
          sentimentScore,
          confidence,
          signals: ["volume_spike_28pct", "volatility_stable_14.2"],
          processedAt: timestamp,
        },
      },
      metadata: {
        traceId: body.metadata?.traceId,
        priority: "normal",
      },
    };

    return NextResponse.json(reply);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Internal server error processing A2A task" },
      { status: 500 }
    );
  }
}
