import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { executeSandboxRun } from "@/lib/adk-sandbox";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const u = await requireUser();
  try {
    const { spec, tools, input, engine, model, geminiApiKey } = await req.json();

    if (!spec) {
      return NextResponse.json({ error: "Missing agent specification." }, { status: 400 });
    }

    // Check if workspace has an Anthropic key
    const anthropicConn = await one<any>(
      `select secret_enc from connections where org_id = $1 and kind = 'anthropic' limit 1`,
      [u.orgId]
    );
    const claudeApiKey = anthropicConn?.secret_enc ? decrypt(anthropicConn.secret_enc) : process.env.ANTHROPIC_API_KEY || "";

    // Check if workspace has a Gemini connection
    let resolvedGeminiKey = geminiApiKey || process.env.GEMINI_API_KEY || "";
    if (!resolvedGeminiKey) {
      const geminiConn = await one<any>(
        `select secret_enc from connections where org_id = $1 and kind = 'gemini' limit 1`,
        [u.orgId]
      );
      if (geminiConn?.secret_enc) {
        resolvedGeminiKey = decrypt(geminiConn.secret_enc);
      }
    }

    const result = await executeSandboxRun({
      spec,
      tools: tools || [],
      input: input || "Execute the agent procedure.",
      preferredEngine: engine || "auto",
      geminiApiKey: resolvedGeminiKey,
      claudeApiKey,
      model,
    });

    return NextResponse.json({ result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
