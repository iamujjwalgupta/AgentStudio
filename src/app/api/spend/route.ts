import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { spendSummary, spendByAgent } from "@/lib/spend";

export const runtime = "nodejs";

export async function GET() {
  const u = await requireUser();
  const [summary, byAgent] = await Promise.all([spendSummary(u.orgId), spendByAgent(u.orgId)]);
  return NextResponse.json({ summary, byAgent, canSetCap: u.isOwner, timezone: u.timezone });
}

/** Set or clear the workspace's monthly ceiling. Owner only — it gates everyone's runs. */
export async function POST(req: Request) {
  const u = await requireUser();
  if (!u.isOwner) {
    return NextResponse.json({ error: "Only the workspace owner can change the spending limit." }, { status: 403 });
  }
  const { cap } = await req.json().catch(() => ({}));

  if (cap === null || cap === "") {
    await q(`update orgs set monthly_cap_usd = null where id = $1`, [u.orgId]);
    await audit(u.orgId, u, "Removed the spending limit", "org", u.orgId, {});
    return NextResponse.json({ ok: true, cap: null });
  }

  const value = Number(cap);
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: "Enter a limit greater than zero, or clear it." }, { status: 400 });
  }
  await q(`update orgs set monthly_cap_usd = $2 where id = $1`, [u.orgId, value]);
  await audit(u.orgId, u, "Set the spending limit", "org", u.orgId, { capUsd: value });
  return NextResponse.json({ ok: true, cap: value });
}
