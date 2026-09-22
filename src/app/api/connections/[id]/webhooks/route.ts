import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;

  const c = await one<any>(`select id, name, config from connections where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!c) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  const webhooks = await q(
    `select id, event_type, payload, headers, status, created_at
     from connection_webhooks
     where connection_id = $1
     order by created_at desc
     limit 25`,
    [id]
  );

  return NextResponse.json({
    ok: true,
    webhookSecret: c.config?.webhookSecret || "whsec_live_default_secret",
    webhooks,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;

  const c = await one<any>(`select id, name from connections where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!c) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const eventType = body.eventType || "test.ping";
  const payload = body.payload || {
    event: eventType,
    timestamp: new Date().toISOString(),
    source: "Agent Studio Inbound Webhook Simulator",
    sampleData: {
      id: `evt_${Date.now()}`,
      status: "delivered",
      message: "Test webhook received and verified successfully.",
    },
  };

  const row = await one<any>(
    `insert into connection_webhooks (connection_id, event_type, payload, headers, status)
     values ($1, $2, $3, $4, $5)
     returning id, event_type, payload, headers, status, created_at`,
    [id, eventType, JSON.stringify(payload), JSON.stringify({ "user-agent": "Agent-Studio-Simulator/1.0" }), "delivered"]
  );

  return NextResponse.json({ ok: true, webhook: row });
}
