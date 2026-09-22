import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { listApps, createApp } from "@/lib/apps";

export const runtime = "nodejs";

export async function GET() {
  const u = await requireUser();
  const apps = await listApps(u.orgId);
  return NextResponse.json({ apps });
}

export async function POST(req: Request) {
  const u = await requireUser();
  const body = await req.json();

  const name = String(body.name || "").trim();
  const url = String(body.url || "").trim();

  if (!name) {
    return NextResponse.json({ error: "Please provide an application name." }, { status: 400 });
  }
  if (!url) {
    return NextResponse.json({ error: "Please provide a valid web application URL." }, { status: 400 });
  }

  const app = await createApp(u.orgId, u.id, {
    name,
    url,
    description: body.description,
    category: body.category,
    icon: body.icon,
    display_mode: body.display_mode,
    permissions: body.permissions,
  });

  await audit(
    u.orgId,
    { id: u.id, name: u.name },
    "app.create",
    "app",
    app.id,
    { name: app.name, url: app.url, category: app.category }
  );

  return NextResponse.json({ app }, { status: 201 });
}
