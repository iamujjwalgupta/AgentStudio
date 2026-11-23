import fs from "fs";
import path from "path";

export type BuildInfo = { fingerprint: string; files: number; builtAt: string };

let cached: BuildInfo | null | undefined;

/**
 * Which code this server is running: the source fingerprint written into the
 * image when it was built (scripts/fingerprint.mjs, run by the Dockerfile).
 * Null when running from a working copy (npm run dev), which has no image.
 * Compare it with `node scripts/fingerprint.mjs` on a copy of the code.
 */
export function buildInfo(): BuildInfo | null {
  if (cached !== undefined) return cached;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".build-info.json"), "utf8"));
    cached = typeof j?.fingerprint === "string" ? { fingerprint: j.fingerprint, files: Number(j.files) || 0, builtAt: String(j.builtAt || "") } : null;
  } catch {
    cached = null;
  }
  return cached;
}
