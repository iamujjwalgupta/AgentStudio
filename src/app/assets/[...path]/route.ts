import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAppById } from "@/lib/apps";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const cookieStore = cookies();
  let appId = cookieStore.get("agent_studio_proxy_app_id")?.value;

  if (!appId) {
    const referer = req.headers.get("referer") || "";
    const match = referer.match(/\/apps\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      appId = match[1];
    }
  }

  let app = appId ? await getAppById(appId) : null;
  if (!app) {
    try {
      const rows = await q<any>("select id from apps where permissions = 'proxy' order by updated_at desc limit 1");
      if (rows && rows.length > 0) {
        app = await getAppById(rows[0].id);
      }
    } catch {}
  }

  if (!app) {
    return NextResponse.json({ error: "Application context not found" }, { status: 404 });
  }

  try {
    const upstreamBase = new URL(app.url);
    const targetUrl = new URL(`/assets/${path.join("/")}`, upstreamBase.origin);

    const upstreamRes = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: {
        host: upstreamBase.host,
        referer: upstreamBase.origin + "/",
      },
    });

    if (!upstreamRes.ok) {
      return new NextResponse(null, { status: upstreamRes.status });
    }

    const data = await upstreamRes.arrayBuffer();
    const contentType = upstreamRes.headers.get("content-type") || "application/octet-stream";

    return new NextResponse(data, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400, immutable",
        "access-control-allow-origin": "*",
      },
    });
  } catch (err: any) {
    console.error("[Proxy Assets Error]", err);
    return NextResponse.json({ error: "Failed to fetch asset", detail: err.message }, { status: 502 });
  }
}
