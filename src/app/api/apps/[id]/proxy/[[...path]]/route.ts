import { NextRequest, NextResponse } from "next/server";
import { getAppById } from "@/lib/apps";
import { assertSafeUrl } from "@/lib/ssrf";

// Headers that would let a request through to a cloud metadata server. Never forwarded.
const METADATA_HEADERS = new Set(["metadata-flavor", "x-google-metadata-request", "metadata"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxyHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; path?: string[] }> }
) {
  const { id, path } = await params;
  const app = await getAppById(id);

  if (!app) {
    return NextResponse.json({ error: "Embedded application not found" }, { status: 404 });
  }

  let upstreamBase: URL;
  try {
    upstreamBase = new URL(app.url);
  } catch {
    return NextResponse.json({ error: "Invalid upstream URL configured for app" }, { status: 500 });
  }

  // Calculate target path
  let targetPath = "/";
  if (path && path.length > 0) {
    targetPath = "/" + path.join("/");
  } else if (upstreamBase.pathname && upstreamBase.pathname !== "/") {
    targetPath = upstreamBase.pathname;
  }

  const targetUrl = new URL(targetPath, upstreamBase.origin);

  // An app URL must not reach the metadata server, loopback or a private network: on a
  // cloud host that would expose the service account's credentials. Local development may
  // embed apps on localhost, as the A2A client allows.
  if (process.env.NODE_ENV === "production") {
    try {
      await assertSafeUrl(targetUrl.toString());
    } catch (err: any) {
      return NextResponse.json({ error: `Blocked upstream: ${err.message}` }, { status: 403 });
    }
  }

  // Forward query string parameters
  const reqUrl = new URL(req.url);
  reqUrl.searchParams.forEach((val, key) => {
    targetUrl.searchParams.set(key, val);
  });

  // Prepare upstream headers
  const forwardHeaders = new Headers();
  for (const [key, value] of req.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === "host" ||
      lowerKey === "connection" ||
      lowerKey === "content-length" ||
      lowerKey === "transfer-encoding" ||
      METADATA_HEADERS.has(lowerKey)
    ) {
      continue;
    }
    forwardHeaders.set(key, value);
  }

  forwardHeaders.set("host", upstreamBase.host);
  forwardHeaders.set("origin", upstreamBase.origin);
  forwardHeaders.set("referer", upstreamBase.origin + "/");

  // Prepare body
  const isBodyAllowed = !["GET", "HEAD"].includes(req.method);
  let bodyBuffer: ArrayBuffer | undefined = undefined;
  if (isBodyAllowed) {
    try {
      bodyBuffer = await req.arrayBuffer();
    } catch {
      bodyBuffer = undefined;
    }
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: forwardHeaders,
      body: bodyBuffer,
      redirect: "manual",
    });
  } catch (err: any) {
    console.error("[Proxy Gateway Error]", err);
    return NextResponse.json(
      { error: "Failed to connect to upstream service", detail: err.message },
      { status: 502 }
    );
  }

  // Handle Redirects (301, 302, 307, 308)
  const location = upstreamRes.headers.get("location");
  if (location && upstreamRes.status >= 300 && upstreamRes.status < 400) {
    let rewrittenLocation = location;
    try {
      if (location.startsWith("http://") || location.startsWith("https://")) {
        const parsed = new URL(location);
        if (parsed.origin === upstreamBase.origin) {
          rewrittenLocation = `/api/apps/${id}/proxy${parsed.pathname}${parsed.search}`;
        }
      } else if (location.startsWith("/")) {
        rewrittenLocation = `/api/apps/${id}/proxy${location}`;
      }
    } catch {
      // Use original location if URL parsing fails
    }

    const redirectRes = NextResponse.redirect(new URL(rewrittenLocation, req.url), upstreamRes.status);
    transferCookies(upstreamRes, redirectRes, id);
    return redirectRes;
  }

  const contentType = upstreamRes.headers.get("content-type") || "";

  // Handle HTML Responses
  if (contentType.includes("text/html")) {
    let html = await upstreamRes.text();

    const proxyBase = `/api/apps/${id}/proxy`;

    // Inject client-side routing & API proxy bridge
    const clientBridgeScript = `
<script data-agent-studio-proxy="true">
  window.__AGENT_STUDIO_APP_ID__ = "${id}";
  window.__AGENT_STUDIO_PROXY_BASE__ = "${proxyBase}";
  (function() {
    const base = "${proxyBase}";
    
    // Intercept fetch() calls to route root-relative paths via proxy
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
      if (typeof input === "string") {
        if (input.startsWith("/") && !input.startsWith(base)) {
          input = base + input;
        }
      } else if (input && input.url) {
        try {
          const parsed = new URL(input.url, window.location.origin);
          if (parsed.origin === window.location.origin && !parsed.pathname.startsWith(base)) {
            input = new Request(base + parsed.pathname + parsed.search, init || input);
          }
        } catch(e) {}
      }
      return originalFetch.call(this, input, init);
    };

    // Intercept XMLHttpRequest
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      if (typeof url === "string" && url.startsWith("/") && !url.startsWith(base)) {
        url = base + url;
      }
      return origOpen.apply(this, [method, url, ...Array.prototype.slice.call(arguments, 2)]);
    };

    // Intercept history.pushState & replaceState
    const origPushState = history.pushState;
    history.pushState = function(state, title, url) {
      if (typeof url === "string" && url.startsWith("/") && !url.startsWith(base)) {
        url = base + url;
      }
      return origPushState.apply(this, [state, title, url]);
    };

    const origReplaceState = history.replaceState;
    history.replaceState = function(state, title, url) {
      if (typeof url === "string" && url.startsWith("/") && !url.startsWith(base)) {
        url = base + url;
      }
      return origReplaceState.apply(this, [state, title, url]);
    };
  })();
</script>
`;

    // Comprehensive asset path rewriting in HTML and manifest scripts
    html = html.replaceAll('href="/assets/', `href="${proxyBase}/assets/`);
    html = html.replaceAll('src="/assets/', `src="${proxyBase}/assets/`);
    html = html.replaceAll('"/assets/', `"${proxyBase}/assets/`);
    html = html.replaceAll("'/assets/", `'${proxyBase}/assets/`);
    html = html.replaceAll('href="/favicon.ico"', `href="${proxyBase}/favicon.ico"`);

    // Inject the bridge right after <head> or at start
    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>${clientBridgeScript}`);
    } else if (html.includes("<head ")) {
      html = html.replace(/<head([^>]*)>/, `<head$1>${clientBridgeScript}`);
    } else {
      html = clientBridgeScript + html;
    }

    const response = new NextResponse(html, {
      status: upstreamRes.status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, must-revalidate",
        "access-control-allow-origin": "*",
      },
    });

    transferCookies(upstreamRes, response, id);
    return response;
  }

  // For non-HTML (JS, CSS, JSON, Images, Streams), stream binary data
  const responseData = await upstreamRes.arrayBuffer();
  const responseHeaders = new Headers();

  // Forward useful response headers
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

  const response = new NextResponse(responseData, {
    status: upstreamRes.status,
    headers: responseHeaders,
  });

  transferCookies(upstreamRes, response, id);
  return response;
}

function transferCookies(upstreamRes: Response, response: NextResponse, appId: string) {
  // Use getSetCookie if available, else fallback
  const setCookies: string[] =
    typeof (upstreamRes.headers as any).getSetCookie === "function"
      ? (upstreamRes.headers as any).getSetCookie()
      : upstreamRes.headers.get("set-cookie")
      ? [upstreamRes.headers.get("set-cookie")!]
      : [];

  for (const rawCookie of setCookies) {
    if (!rawCookie) continue;
    // Clean cookie: remove Domain, remove Secure if on HTTP, ensure SameSite=Lax and Path=/
    let sanitized = rawCookie
      .replace(/Domain=[^;]+;?\s*/gi, "")
      .replace(/Secure;?\s*/gi, ""); // Stripping Secure ensures it works on localhost HTTP

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

  // Bind active proxy app context cookie for fallback handlers
  response.headers.append(
    "set-cookie",
    `agent_studio_proxy_app_id=${appId}; Path=/; SameSite=Lax; Max-Age=86400`
  );
}

export const GET = proxyHandler;
export const POST = proxyHandler;
export const PUT = proxyHandler;
export const DELETE = proxyHandler;
export const PATCH = proxyHandler;
export const OPTIONS = proxyHandler;
export const HEAD = proxyHandler;
