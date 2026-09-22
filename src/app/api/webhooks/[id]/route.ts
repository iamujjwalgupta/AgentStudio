import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Public Inbound Webhook Ingestion Receiver
 * Handles incoming webhooks from external tools (GitHub, Slack, Jira, etc.)
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const conn = await one<any>(`select id, org_id, name, kind, config from connections where id = $1`, [id]);
  if (!conn) {
    return NextResponse.json({ error: "Invalid webhook destination" }, { status: 404 });
  }

  const rawHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    rawHeaders[k] = v;
  });

  const body = await req.json().catch(() => ({}));
  const eventType =
    rawHeaders["x-github-event"] ||
    rawHeaders["x-slack-event"] ||
    body?.type ||
    body?.event ||
    "inbound.notification";

  const row = await one<any>(
    `insert into connection_webhooks (connection_id, event_type, payload, headers, status)
     values ($1, $2, $3, $4, $5)
     returning id, created_at`,
    [id, eventType, JSON.stringify(body), JSON.stringify(rawHeaders), "processed"]
  );

  return NextResponse.json({
    ok: true,
    status: "received",
    deliveryId: row?.id,
    receivedAt: row?.created_at,
  });
}
