import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { EVENT_LABELS, type NotifyEvent } from "@/lib/notify";

export const runtime = "nodejs";

const EVENTS = Object.keys(EVENT_LABELS) as NotifyEvent[];
const CHANNELS = ["email", "slack"];

/** Current settings, what the workspace can actually deliver on, and recent attempts. */
export async function GET() {
  const u = await requireUser();
  const org = await one<any>(`select notify from orgs where id = $1`, [u.orgId]);
  const conns = await q<any>(
    `select kind from connections where org_id = $1 and kind in ('smtp','slack')`,
    [u.orgId],
  );
  const recent = await q(
    `select event, channel, recipient, subject, status, detail, created_at
       from notifications where org_id = $1 order by created_at desc limit 20`,
    [u.orgId],
  );
  return NextResponse.json({
    settings: org?.notify ?? {},
    labels: EVENT_LABELS,
    available: { email: conns.some((c) => c.kind === "smtp"), slack: conns.some((c) => c.kind === "slack") },
    recent,
    canEdit: u.canManageMembers,
    timezone: u.timezone,
  });
}

/** Choose which events go where. Owner and admins, as with other workspace settings. */
export async function POST(req: Request) {
  const u = await requireUser();
  if (!u.canManageMembers) {
    return NextResponse.json({ error: "Only the workspace owner and admins can change notifications." }, { status: 403 });
  }
  const { settings } = await req.json().catch(() => ({}));
  if (!settings || typeof settings !== "object") {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }

  const clean: Record<string, string[]> = {};
  for (const ev of EVENTS) {
    const chosen = settings[ev];
    if (Array.isArray(chosen)) clean[ev] = chosen.filter((c: string) => CHANNELS.includes(c));
  }

  await q(`update orgs set notify = $2 where id = $1`, [u.orgId, JSON.stringify(clean)]);
  await audit(u.orgId, u, "Changed notification settings", "org", u.orgId, clean);
  return NextResponse.json({ ok: true, settings: clean });
}
