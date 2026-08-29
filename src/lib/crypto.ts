import crypto from "crypto";

const key = crypto
  .createHash("sha256")
  .update(process.env.AUTH_SECRET || "dev-secret-change-me")
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
  const [ivB, tagB, dataB] = blob.split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
}

export function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}
