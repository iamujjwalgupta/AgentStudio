import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ADK_TEMPLATES } from "@/lib/adk-parser";
import { LANGCHAIN_TEMPLATES } from "@/lib/langchain-parser";
import { FOUNDRY_TEMPLATES } from "@/lib/foundry-parser";
import { OPENAI_TEMPLATES } from "@/lib/openai-parser";

export const runtime = "nodejs";

export async function GET(req: Request) {
  await requireUser();
  const { searchParams } = new URL(req.url);
  const framework = searchParams.get("framework") || "adk";

  if (framework === "langchain") {
    return NextResponse.json({ templates: LANGCHAIN_TEMPLATES });
  }
  if (framework === "foundry") {
    return NextResponse.json({ templates: FOUNDRY_TEMPLATES });
  }
  if (framework === "openai") {
    return NextResponse.json({ templates: OPENAI_TEMPLATES });
  }

  return NextResponse.json({
    templates: ADK_TEMPLATES,
    all: {
      adk: ADK_TEMPLATES,
      langchain: LANGCHAIN_TEMPLATES,
      foundry: FOUNDRY_TEMPLATES,
      openai: OPENAI_TEMPLATES,
    },
  });
}
