import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAppById } from "@/lib/apps";
import { q } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { assertSafeUrl } from "@/lib/ssrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function apiV1Handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  if (app && app.org_id !== user.orgId && !app.is_builtin) {
    return NextResponse.json({ error: "Access denied to requested application" }, { status: 403 });
  }

  if (!app) {
    try {
      const rows = await q<any>(
        "select id from apps where org_id = $1 and permissions = 'proxy' order by updated_at desc limit 1",
        [user.orgId]
      );
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
    const targetUrl = new URL(`/api/v1/${path.join("/")}`, upstreamBase.origin);
    await assertSafeUrl(targetUrl.toString());

    const reqUrl = new URL(req.url);
    reqUrl.searchParams.forEach((val, key) => {
      targetUrl.searchParams.set(key, val);
    });

    const forwardHeaders = new Headers();
    for (const [key, value] of req.headers.entries()) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey === "host" ||
        lowerKey === "connection" ||
        lowerKey === "content-length" ||
        lowerKey === "transfer-encoding"
      ) {
        continue;
      }
      forwardHeaders.set(key, value);
    }
    forwardHeaders.set("host", upstreamBase.host);
    forwardHeaders.set("origin", upstreamBase.origin);
    forwardHeaders.set("referer", upstreamBase.origin + "/");

    const isBodyAllowed = !["GET", "HEAD"].includes(req.method);
    let bodyBuffer: ArrayBuffer | undefined = undefined;
    if (isBodyAllowed) {
      try {
        bodyBuffer = await req.arrayBuffer();
      } catch {
        bodyBuffer = undefined;
      }
    }

    const upstreamRes = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: forwardHeaders,
      body: bodyBuffer,
      redirect: "manual",
    });

    const data = await upstreamRes.arrayBuffer();
    const responseHeaders = new Headers();

    for (const [key, value] of upstreamRes.headers.entries()) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey === "x-frame-options" ||
        lowerKey === "content-security-policy" ||
        lowerKey === "transfer-encoding" ||
        lowerKey === "content-encoding" ||
        lowerKey === "content-length"
      ) {
        continue;
      }
      responseHeaders.set(key, value);
    }

    responseHeaders.set("access-control-allow-origin", "*");

    const response = new NextResponse(data, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });

    // Transfer cookies
    const setCookies: string[] =
      typeof (upstreamRes.headers as any).getSetCookie === "function"
        ? (upstreamRes.headers as any).getSetCookie()
        : upstreamRes.headers.get("set-cookie")
        ? [upstreamRes.headers.get("set-cookie")!]
        : [];

    for (const rawCookie of setCookies) {
      if (!rawCookie) continue;
      let sanitized = rawCookie
        .replace(/Domain=[^;]+;?\s*/gi, "")
        .replace(/Secure;?\s*/gi, "");

      if (!/SameSite=/i.test(sanitized)) {
        sanitized += "; SameSite=Lax";
      } else {
        sanitized = sanitized.replace(/SameSite=[^;]+/gi, "SameSite=Lax");
      }

      if (!/Path=/i.test(sanitized)) {
        sanitized += "; Path=/";
      }

      response.headers.append("set-cookie", sanitized);
    }

    return response;
  } catch (err: any) {
    console.error("[Proxy API v1 Error]", err);
    return NextResponse.json({ error: "Upstream API error", detail: err.message }, { status: 502 });
  }
}

export const GET = apiV1Handler;
export const POST = apiV1Handler;
export const PUT = apiV1Handler;
export const DELETE = apiV1Handler;
export const PATCH = apiV1Handler;
export const OPTIONS = apiV1Handler;
export const HEAD = apiV1Handler;
