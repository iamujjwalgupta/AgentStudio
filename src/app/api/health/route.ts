import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { buildInfo } from "@/lib/build-info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness and readiness for the platform's health check.
 * Unauthenticated by design, and deliberately says nothing about the workspace.
 */
export async function GET() {
  try {
    await q(`select 1`);
    return NextResponse.json({ ok: true, db: true, build: buildInfo()?.fingerprint ?? "local" });
  } catch {
    return NextResponse.json({ ok: false, db: false, build: buildInfo()?.fingerprint ?? "local" }, { status: 503 });
  }
}
