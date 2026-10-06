import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { LimitError } from "@/lib/metering";
import { availableEngines, benchStep, type Engine } from "@/lib/sandbox-bench";

export const runtime = "nodejs";
export const maxDuration = 90;

/** Which models this workspace can test with. */
export async function GET() {
  const u = await requireUser();
  return NextResponse.json({ engines: await availableEngines(u.orgId) });
}

/**
 * One step of a test: the conversation so far goes to the model, and what it
 * said comes back with any tool calls it made. Nothing is executed; the tester
 * supplies each tool's result and calls again.
 */
export async function POST(req: Request) {
  const u = await requireUser();
  const { engine, agent, tools, transcript } = await req.json().catch(() => ({}));
  if (engine !== "anthropic" && engine !== "gemini") return NextResponse.json({ error: "Choose a model to test with." }, { status: 400 });
  if (!agent?.name || !Array.isArray(transcript) || !transcript.length) return NextResponse.json({ error: "Nothing to send yet." }, { status: 400 });
  if (transcript.length > 80) return NextResponse.json({ error: "This test has gone on long enough. Start a new one." }, { status: 400 });
  try {
    const step = await benchStep({
      orgId: u.orgId,
      userId: u.id,
      engine: engine as Engine,
      agent: {
        name: String(agent.name).slice(0, 120),
        purpose: String(agent.purpose || "").slice(0, 2000),
        instruction: String(agent.instruction || "").slice(0, 20000),
        steps: Array.isArray(agent.steps) ? agent.steps.map(String).slice(0, 40) : [],
      },
      tools: Array.isArray(tools) ? tools.slice(0, 40) : [],
      transcript,
    });
    return NextResponse.json(step);
  } catch (e: any) {
    if (e instanceof LimitError) return NextResponse.json({ error: e.message }, { status: 429 });
    return NextResponse.json({ error: e?.message || "The model could not be reached." }, { status: 502 });
  }
}
