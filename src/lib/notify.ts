import { q, one } from "./db";
import { decrypt } from "./crypto";

/**
 * Tells people what the app needs them to know.
 *
 * Delivery uses the workspace's own SMTP and Slack connections — the same ones
 * agents use — so nothing new has to be configured. Two rules hold throughout:
 *
 *   1. A delivery failure never fails the thing it reports. A run must not fail
 *      because the mail server was down, and an approval must not be lost
 *      because Slack rejected a webhook.
 *   2. Every attempt is recorded, including the ones that were skipped for want
 *      of a connection, so a notification that never arrived can be explained.
 */

export type NotifyEvent = "approval_waiting" | "run_failed" | "share_received" | "invitation" | "spend_cap";

export type Channel = "email" | "slack";

/** What a workspace hears about unless it says otherwise. */
const DEFAULTS: Record<NotifyEvent, Channel[]> = {
  approval_waiting: ["email", "slack"],
  run_failed: ["email", "slack"],
  share_received: ["email"],
  invitation: ["email"],
  spend_cap: ["email", "slack"],
};

export const EVENT_LABELS: Record<NotifyEvent, string> = {
  approval_waiting: "An action is waiting for approval",
  run_failed: "A run failed",
  share_received: "An agent was shared with you",
  invitation: "Someone was invited to the workspace",
  spend_cap: "The spending limit was reached",
};

export type Message = {
  event: NotifyEvent;
  subject: string;
  body: string;
  /** Email recipients. Slack goes to the workspace's channel regardless. */
  to?: string[];
  entityId?: string | null;
};

async function channelsFor(orgId: string, event: NotifyEvent): Promise<Channel[]> {
  const row = await one<any>(`select notify from orgs where id = $1`, [orgId]);
  const configured = row?.notify?.[event];
  if (Array.isArray(configured)) return configured.filter((c: string) => c === "email" || c === "slack") as Channel[];
  return DEFAULTS[event];
}

async function log(
  orgId: string,
  event: NotifyEvent,
  channel: Channel,
  status: "sent" | "failed" | "skipped",
  detail: string,
  recipient: string,
  subject: string,
  entityId?: string | null,
) {
  await q(
    `insert into notifications (org_id, event, channel, recipient, subject, status, detail, entity_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [orgId, event, channel, recipient, subject, status, detail.slice(0, 500), entityId ?? null],
  ).catch(() => {
    /* the log is not worth failing over either */
  });
}

async function sendEmail(orgId: string, m: Message, to: string[]) {
  const c = await one<any>(
    `select name, config, secret_enc from connections where org_id = $1 and kind = 'smtp' limit 1`,
    [orgId],
  );
  if (!c) return log(orgId, m.event, "email", "skipped", "No email connection in this workspace.", to.join(", "), m.subject, m.entityId);
  if (!to.length) return log(orgId, m.event, "email", "skipped", "Nobody to send to.", "", m.subject, m.entityId);

  try {
    const nodemailer: any = await import("nodemailer");
    const t = (nodemailer.default ?? nodemailer).createTransport({
      host: c.config.host,
      port: Number(c.config.port || 587),
      secure: Boolean(c.config.secure),
      auth: c.config.user ? { user: c.config.user, pass: c.secret_enc ? decrypt(c.secret_enc) : "" } : undefined,
    });
    await t.sendMail({
      from: c.config.from || c.config.user,
      to: to.join(", "),
      subject: m.subject,
      text: m.body,
    });
    await log(orgId, m.event, "email", "sent", "", to.join(", "), m.subject, m.entityId);
  } catch (e: any) {
    await log(orgId, m.event, "email", "failed", e?.message || String(e), to.join(", "), m.subject, m.entityId);
  }
}

async function sendSlack(orgId: string, m: Message) {
  const c = await one<any>(
    `select name, config, secret_enc from connections where org_id = $1 and kind = 'slack' limit 1`,
    [orgId],
  );
  if (!c?.secret_enc) return log(orgId, m.event, "slack", "skipped", "No Slack connection in this workspace.", "", m.subject, m.entityId);

  try {
    const res = await fetch(decrypt(c.secret_enc), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `*${m.subject}*\n${m.body}` }),
      signal: AbortSignal.timeout(10000),
    });
    const out = await res.text();
    if (!res.ok) throw new Error(out || `HTTP ${res.status}`);
    await log(orgId, m.event, "slack", "sent", "", c.config?.channel || c.name, m.subject, m.entityId);
  } catch (e: any) {
    await log(orgId, m.event, "slack", "failed", e?.message || String(e), c.config?.channel || c.name, m.subject, m.entityId);
  }
}

/**
 * Send a notification. Never throws — callers are reporting something that has
 * already happened, and must not be derailed by how it is announced.
 */
export async function notify(orgId: string, m: Message): Promise<void> {
  try {
    const channels = await channelsFor(orgId, m.event);
    const jobs: Promise<unknown>[] = [];
    if (channels.includes("email")) jobs.push(sendEmail(orgId, m, m.to ?? []));
    if (channels.includes("slack")) jobs.push(sendSlack(orgId, m));
    await Promise.allSettled(jobs);
  } catch {
    /* deliberately swallowed: see the contract above */
  }
}

/** Everyone who may decide an approval in this workspace — owner and approvers. */
export async function approverEmails(orgId: string): Promise<string[]> {
  const rows = await q<any>(
    `select distinct us.email
       from memberships m
       join users us on us.id = m.user_id
       join orgs o on o.id = m.org_id
      where m.org_id = $1 and (m.role = 'approver' or o.owner_id = m.user_id)`,
    [orgId],
  );
  return rows.map((r) => r.email);
}
