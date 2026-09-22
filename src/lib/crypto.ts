import crypto from "crypto";

const rawSecret = process.env.AUTH_SECRET;
if (!rawSecret && process.env.NODE_ENV === "production") {
  throw new Error("CRITICAL SECURITY ERROR: AUTH_SECRET environment variable must be set in production.");
}

const key = crypto
  .createHash("sha256")
  .update(rawSecret || "dev-secret-change-me")
  .digest();

/** Connection secrets are encrypted at rest and never returned to the browser. */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(".");
}

export function decrypt(blob: string): string {
  if (!blob) return "";
  try {
    const parts = blob.split(".");
    if (parts.length !== 3) return "";
    const [ivB, tagB, dataB] = parts;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
  } catch (err) {
    console.error("Decryption failed:", err);
    return "";
  }
}

export function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}
