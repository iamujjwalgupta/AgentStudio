import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { allExamples } from "@/lib/sandbox-bench";

export const runtime = "nodejs";

/** Example agents for every supported framework, each with a couple of test prompts. */
export async function GET() {
  await requireUser();
  return NextResponse.json({ examples: allExamples() });
}
