import crypto from "crypto";

export type S3Config = {
  bucket: string;
  region?: string;
  accessKeyId: string;
  endpoint?: string; // Optional custom endpoint for MinIO, Cloudflare R2, etc.
};

function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function hmacSha256Hex(key: string | Buffer, data: string): string {
  return crypto.createHmac("sha256", key).update(data).digest("hex");
}

export function getS3Endpoint(config: S3Config): { host: string; urlPrefix: string } {
  const region = config.region?.trim() || "us-east-1";
  const bucket = config.bucket.trim();

  if (config.endpoint && config.endpoint.trim()) {
    const raw = config.endpoint.trim().replace(/\/$/, "");
    const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = parsed.host;
    const pathPrefix = parsed.pathname === "/" ? "" : parsed.pathname;
    return {
      host,
      urlPrefix: `${parsed.protocol}//${host}${pathPrefix}/${bucket}`,
    };
  }

  // Standard AWS S3
  const host = region === "us-east-1"
    ? `${bucket}.s3.amazonaws.com`
    : `${bucket}.s3.${region}.amazonaws.com`;

  return {
    host,
    urlPrefix: `https://${host}`,
  };
}

/**
 * Builds AWS SigV4 signed headers for an S3 HTTP request.
 */
export function signS3Request(opts: {
  method: "GET" | "PUT" | "HEAD";
  path: string;
  queryParams?: Record<string, string>;
  payload: string | Buffer;
  contentType?: string;
  config: S3Config;
  secretAccessKey: string;
}): { url: string; headers: Record<string, string> } {
  const { method, config, secretAccessKey, contentType } = opts;
  const region = config.region?.trim() || "us-east-1";
  const accessKeyId = config.accessKeyId.trim();

  const { host, urlPrefix } = getS3Endpoint(config);

  const cleanPath = opts.path.startsWith("/") ? opts.path : `/${opts.path}`;
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ

  const payloadHash = sha256(opts.payload);

  // Canonical Query String
  const queryParams = opts.queryParams || {};
  const sortedKeys = Object.keys(queryParams).sort();
  const canonicalQueryString = sortedKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join("&");

  // Headers to sign
  const headersToSign: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) {
    headersToSign["content-type"] = contentType;
  }

  const sortedHeaderKeys = Object.keys(headersToSign).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k.toLowerCase()}:${headersToSign[k].trim()}\n`)
    .join("");
  const signedHeaders = sortedHeaderKeys.map((k) => k.toLowerCase()).join(";");

  // Canonical Request
  const canonicalRequest = [
    method,
    encodeURI(cleanPath),
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  // String to Sign
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");

  // Signing Key
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, "s3");
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = hmacSha256Hex(kSigning, stringToSign);

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const requestHeaders: Record<string, string> = {
    ...headersToSign,
    authorization,
  };

  const finalUrl = `${urlPrefix}${cleanPath}${canonicalQueryString ? `?${canonicalQueryString}` : ""}`;

  return { url: finalUrl, headers: requestHeaders };
}

/**
 * Uploads a file buffer or string directly to an S3 bucket using SigV4.
 */
export async function uploadToS3(
  config: S3Config,
  secretAccessKey: string,
  key: string,
  content: string | Buffer,
  contentType = "application/octet-stream"
): Promise<{ ok: boolean; url: string; status: number; error?: string }> {
  const payload = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  const path = `/${key.replace(/^\//, "")}`;

  const { url, headers } = signS3Request({
    method: "PUT",
    path,
    payload,
    contentType,
    config,
    secretAccessKey,
  });

  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: new Uint8Array(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    return { ok: false, url, status: res.status, error: errorText || `HTTP ${res.status}` };
  }

  return { ok: true, url, status: res.status };
}

/**
 * Verifies S3 credentials and bucket access using a signed GET request with max-keys=1.
 */
export async function testS3Connection(
  config: S3Config,
  secretAccessKey: string
): Promise<{ ok: boolean; detail: string }> {
  try {
    const { url, headers } = signS3Request({
      method: "GET",
      path: "/",
      queryParams: { "max-keys": "1" },
      payload: "",
      config,
      secretAccessKey,
    });

    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      return { ok: true, detail: `Bucket "${config.bucket}" accessible (${config.region || "us-east-1"})` };
    }

    const text = await res.text().catch(() => "");
    const match = text.match(/<Message>(.*?)<\/Message>/i);
    const msg = match ? match[1] : `HTTP ${res.status}`;
    return { ok: false, detail: `S3 error: ${msg}` };
  } catch (err: any) {
    return { ok: false, detail: err.message || String(err) };
  }
}
