import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { introspectMCPServer, normalizeMCPTools, MCPTool } from "@/lib/mcp-client";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;

  const c = await one<any>(`select * from connections where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!c) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  const secret = c.secret_enc ? decrypt(c.secret_enc) : "";
  const endpoint = c.config?.baseUrl || c.config?.endpoint || "";
  const discovery = await introspectMCPServer(endpoint, secret, c.kind);

  // Merge with previously saved tool enablement states if any
  const savedTools: MCPTool[] = c.config?.mcpTools || [];
  if (savedTools.length > 0) {
    const savedMap = new Map(savedTools.map((t) => [t.name, t.enabled]));
    discovery.tools = discovery.tools.map((t) => ({
      ...t,
      enabled: savedMap.has(t.name) ? savedMap.get(t.name) : t.enabled,
    }));
  }

  return NextResponse.json({ ok: true, discovery });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;

  const c = await one<any>(`select * from connections where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!c) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const updatedTools: MCPTool[] = body.tools || [];

  const currentConfig = c.config || {};
  const newConfig = {
    ...currentConfig,
    mcpTools: updatedTools,
  };

  await q(`update connections set config = $1 where id = $2 and org_id = $3`, [
    JSON.stringify(newConfig),
    id,
    u.orgId,
  ]);

  return NextResponse.json({ ok: true, tools: updatedTools });
}
