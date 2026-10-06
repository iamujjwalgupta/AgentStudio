import { NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";

export const runtime = "nodejs";

const SCOPES = ["provider", "agent"];
const PERIODS = ["month", "day"];

/**
 * Sets a usage limit, or clears it when neither a token nor a dollar amount is given.
 * The owner and admins only: a limit stops everyone's runs.
 */
export async function PUT(req: Request) {
  const u = await requireUser();
  if (!u.canPublish) return NextResponse.json({ error: "Only the workspace owner and admins can change usage limits." }, { status: 403 });
  const { scope, target, period, maxTokens, maxUsd } = await req.json().catch(() => ({}));
  if (!SCOPES.includes(scope) || !PERIODS.includes(period) || !target) {
    return NextResponse.json({ error: "Choose what the limit is on and for which period." }, { status: 400 });
  }
  if (scope === "provider" && !["anthropic", "gemini"].includes(target)) {
    return NextResponse.json({ error: "Limits are on the Anthropic or the Gemini key." }, { status: 400 });
  }
  if (scope === "agent" && !(await one<any>(`select 1 from agents where id::text = $1 and org_id = $2`, [target, u.orgId]))) {
    return NextResponse.json({ error: "That agent is not in this workspace." }, { status: 404 });
  }
  const num = (v: any) => (v === null || v === undefined || v === "" ? null : Number(v));
  const tokens = num(maxTokens);
  const usd = num(maxUsd);
  if ((tokens !== null && !(tokens > 0)) || (usd !== null && !(usd > 0))) {
    return NextResponse.json({ error: "Limits must be greater than zero." }, { status: 400 });
  }

  if (tokens === null && usd === null) {
    await q(`delete from usage_limits where org_id = $1 and scope = $2 and target = $3 and period = $4`, [u.orgId, scope, target, period]);
    await audit(u.orgId, u, "Removed a usage limit", "usage_limit", `${scope}:${target}:${period}`, { scope, target, period });
    return NextResponse.json({ ok: true, removed: true });
  }
  await q(
    `insert into usage_limits (org_id, scope, target, period, max_tokens, max_usd, updated_by, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7, now())
     on conflict (org_id, scope, target, period)
     do update set max_tokens = excluded.max_tokens, max_usd = excluded.max_usd, updated_by = excluded.updated_by, updated_at = now()`,
    [u.orgId, scope, target, period, tokens === null ? null : Math.round(tokens), usd, u.name],
  );
  await audit(u.orgId, u, "Set a usage limit", "usage_limit", `${scope}:${target}:${period}`, { scope, target, period, maxTokens: tokens, maxUsd: usd });
  return NextResponse.json({ ok: true });
}
