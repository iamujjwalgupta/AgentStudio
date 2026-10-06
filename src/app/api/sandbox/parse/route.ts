import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { connectedKinds, parseAny, suggestTool, toolCatalog, type Framework } from "@/lib/sandbox-bench";

export const runtime = "nodejs";

/**
 * Reads agent code written for Google ADK, LangChain, OpenAI Agents or Palantir
 * Foundry. The framework is detected unless one is named. Returns what was
 * understood, the Agent Studio action each imported tool most likely maps to,
 * the catalogue to choose from, and which connections the workspace has.
 */
export async function POST(req: Request) {
  const u = await requireUser();
  const { code, language, framework = "auto" } = await req.json().catch(() => ({}));
  if (!String(code || "").trim()) return NextResponse.json({ error: "Paste or upload the agent's code first." }, { status: 400 });
  if (String(code).length > 400_000) return NextResponse.json({ error: "That file is too large to read here." }, { status: 413 });
  try {
    const agent = parseAny(String(code), framework as Framework | "auto", language || undefined);
    return NextResponse.json({
      agent,
      suggestions: agent.tools.map((t) => suggestTool(t)),
      catalog: toolCatalog(),
      connected: await connectedKinds(u.orgId),
    });
  } catch (e: any) {
    return NextResponse.json({ error: `The code could not be read: ${e?.message || e}` }, { status: 422 });
  }
}
