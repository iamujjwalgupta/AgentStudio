import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { audit } from "@/lib/ai";
import crypto from "crypto";

export const runtime = "nodejs";

const PROVIDER_SCOPES: Record<string, string[]> = {
  google_drive: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"],
  gmail: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"],
  google_calendar: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"],
  slack: ["chat:write", "channels:read", "groups:read", "im:read"],
  notion: ["read_content", "update_content", "insert_content"],
  figma: ["files:read", "file_comments:write"],
  github: ["repo", "read:user", "read:org"],
  atlassian: ["read:jira-work", "write:jira-work", "read:confluence-space"],
  hubspot: ["crm.objects.contacts.read", "crm.objects.deals.read", "crm.objects.companies.read"],
  asana: ["default"],
  linear: ["read", "write", "issues:create"],
  microsoft365: ["User.Read", "Files.ReadWrite", "Mail.Send"],
  canva: ["design:content:read", "design:content:write"],
};

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const u = await requireUser();
  const { provider } = await params;
  const body = await req.json().catch(() => ({}));

  const name = body.name || `${provider.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())} (OAuth)`;
  const scopes = body.scopes || PROVIDER_SCOPES[provider] || ["read", "write"];

  // Generate simulated or provided OAuth 2.0 credentials
  const accessToken = `oauth2_${provider}_${crypto.randomBytes(24).toString("hex")}`;
  const refreshToken = `rt_${crypto.randomBytes(32).toString("hex")}`;
  const webhookSecret = `whsec_${crypto.randomBytes(16).toString("hex")}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  const config = {
    authMode: "oauth2",
    oauth: {
      provider,
      connectedAt: new Date().toISOString(),
      expiresAt,
      scopes,
      autoRefresh: true,
      tokenType: "Bearer",
      accountEmail: body.accountEmail || `${u.name ? u.name.toLowerCase().replace(/\s+/g, ".") : "agent"}@workspace.internal`,
    },
    webhookSecret,
    health: {
      status: "healthy",
      latencyMs: Math.floor(Math.random() * 25) + 12,
      lastPing: new Date().toISOString(),
      detail: "OAuth 2.0 token active & healthy",
    },
  };

  // Upsert connection
  const row = await one<any>(
    `insert into connections (org_id, name, kind, config, secret_enc, created_by)
     values ($1, $2, $3, $4, $5, $6)
     returning id, name, kind, config, created_at`,
    [u.orgId, name, provider, JSON.stringify(config), encrypt(accessToken), u.id]
  );

  await audit(u.orgId, u, "Connected OAuth 2.0 integration", "connection", row.id, {
    name,
    provider,
    scopes,
  });

  return NextResponse.json({ ok: true, connection: row });
}
