import { assertSafeUrl } from "../ssrf";
import type { A2AMessage, A2AWorkerResponse } from "./types";

export interface DispatchA2AOptions {
  endpointUrl: string;
  message: A2AMessage;
  apiKey?: string;
  timeoutMs?: number;
  allowLocalhost?: boolean;
}

/**
 * Validates endpoint URL, allowing localhost during development or when explicitly allowed.
 */
async function validateEndpoint(urlStr: string, allowLocalhost = false): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid A2A endpoint URL: "${urlStr}"`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Forbidden protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted for A2A.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";

  // Allow localhost if development, flag set, or local testing
  if (isLocal) {
    if (allowLocalhost || process.env.NODE_ENV !== "production" || process.env.ALLOW_LOCAL_A2A === "true") {
      return parsed;
    }
  }

  // Otherwise enforce strict SSRF check
  return await assertSafeUrl(urlStr);
}

/**
 * Dispatches an A2A message to an external agent endpoint over HTTP.
 */
export async function dispatchA2AMessage(opts: DispatchA2AOptions): Promise<A2AWorkerResponse> {
  const { endpointUrl, message, apiKey, timeoutMs = 60_000, allowLocalhost = true } = opts;

  const validUrl = await validateEndpoint(endpointUrl, allowLocalhost);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "x-a2a-protocol": "1.0",
    "x-a2a-performative": message.performative,
    "x-a2a-message-id": message.messageId,
    "x-a2a-conversation-id": message.conversationId,
  };

  if (apiKey) {
    headers["Authorization"] = apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const t0 = Date.now();

  try {
    const res = await fetch(validUrl.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: controller.signal,
    });

    const durationMs = Date.now() - t0;

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown HTTP error");
      return {
        status: "failed",
        error: `A2A Agent responded with HTTP ${res.status}: ${errorText}`,
        metadata: { durationMs },
      };
    }

    const data = await res.json().catch(() => null);
    if (!data) {
      return {
        status: "failed",
        error: "A2A Agent returned empty or non-JSON response body",
        metadata: { durationMs },
      };
    }

    // Check if reply is in full A2A envelope format
    if (data.protocol === "a2a/1.0" && data.payload) {
      const p = data.payload;
      return {
        status: p.status || (data.performative === "REJECT" ? "rejected" : "completed"),
        deliverable: p.deliverable || p.output || (typeof p === "string" ? p : JSON.stringify(p, null, 2)),
        output: p.output || p,
        artifacts: data.artifacts || p.artifacts,
        error: p.error,
        metadata: {
          durationMs,
          agentName: data.sender?.name,
          ...data.metadata,
        },
      };
    }

    // Direct response object format: { deliverable?: string, output?: any, status?: string }
    return {
      status: data.status === "failed" ? "failed" : data.status === "awaiting_approval" ? "awaiting_approval" : "completed",
      deliverable: data.deliverable || data.output || (typeof data === "string" ? data : JSON.stringify(data, null, 2)),
      output: data.output || data,
      artifacts: data.artifacts,
      error: data.error,
      metadata: {
        durationMs,
        ...data.metadata,
      },
    };
  } catch (err: any) {
    const durationMs = Date.now() - t0;
    if (err.name === "AbortError") {
      return {
        status: "failed",
        error: `A2A Agent dispatch timed out after ${Math.round(timeoutMs / 1000)}s`,
        metadata: { durationMs },
      };
    }
    return {
      status: "failed",
      error: `Failed to dispatch A2A message: ${err.message || String(err)}`,
      metadata: { durationMs },
    };
  } finally {
    clearTimeout(timer);
  }
}
