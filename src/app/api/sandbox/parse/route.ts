import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { parseAdkAgent } from "@/lib/adk-parser";
import { parseLangChainAgent } from "@/lib/langchain-parser";
import { parseFoundryAgent } from "@/lib/foundry-parser";
import { parseOpenAIAgent } from "@/lib/openai-parser";

export const runtime = "nodejs";

export async function POST(req: Request) {
  await requireUser();
  try {
    const { code, language, framework = "adk" } = await req.json();
    if (!code || !code.trim()) {
      return NextResponse.json({ error: "No code provided to parse." }, { status: 400 });
    }

    let parsed: any;
    if (framework === "langchain") {
      parsed = parseLangChainAgent(code, language);
    } else if (framework === "foundry") {
      parsed = parseFoundryAgent(code, language);
    } else if (framework === "openai") {
      parsed = parseOpenAIAgent(code, language);
    } else {
      parsed = parseAdkAgent(code, language);
    }

    return NextResponse.json({ parsed });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 400 });
  }
}
