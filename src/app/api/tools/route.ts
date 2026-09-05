import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { SELECTABLE_TOOLS } from "@/lib/tools";

export const runtime = "nodejs";

export async function GET() {
  await requireUser();
  return NextResponse.json({
    tools: SELECTABLE_TOOLS.map((t) => ({ id: t.id, label: t.label, description: t.description, risk: t.risk, needs: t.needs ?? null })),
  });
}
