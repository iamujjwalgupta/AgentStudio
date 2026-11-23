// A fingerprint of the app's source: the same code gives the same short code on
// your laptop, in Cloud Shell, and in the running app (built into the image).
//
//   node scripts/fingerprint.mjs            prints the fingerprint
//   node scripts/fingerprint.mjs --list     prints one line per file, to diff two copies
//   node scripts/fingerprint.mjs --write F  writes it as JSON (the Docker build does this)
//
// Line endings are ignored, so a Windows checkout and a Linux one agree. Only the
// files that make up the app count: the ones Cloud Build receives and builds from.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["src", "db", "scripts"];
const FILES = ["package.json", "package-lock.json", "next.config.mjs", "tsconfig.json", "Dockerfile"];
// Never uploaded to Cloud Build (.gcloudignore), or not part of the app itself.
const SKIP = (name) => name === ".DS_Store" || name === "sdk" || name === "__MACOSX" || name.endsWith(".tsbuildinfo");
const SELF = "scripts/fingerprint.mjs";

function walk(dir, out) {
  if (!fs.existsSync(path.join(ROOT, dir))) return;
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (SKIP(e.name)) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (e.isFile() && rel !== SELF) out.push(rel);
  }
}

const files = [];
for (const d of DIRS) walk(d, files);
for (const f of FILES) if (fs.existsSync(path.join(ROOT, f))) files.push(f);
// Byte order, as `LC_ALL=C sort` does, so a shell check can reproduce it.
files.sort((a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b))));

const lines = files.map((rel) => {
  const body = fs.readFileSync(path.join(ROOT, rel)).filter((b) => b !== 13); // drop every \r
  return `${crypto.createHash("sha256").update(body).digest("hex")}  ${rel}\n`;
});
const fingerprint = crypto.createHash("sha256").update(lines.join("")).digest("hex").slice(0, 12);

const arg = process.argv[2];
if (arg === "--list") {
  process.stdout.write(lines.join(""));
} else if (arg === "--write") {
  const target = process.argv[3] || ".build-info.json";
  fs.writeFileSync(target, JSON.stringify({ fingerprint, files: files.length, builtAt: new Date().toISOString() }) + "\n");
  console.log(`fingerprint ${fingerprint} (${files.length} files) written to ${target}`);
} else {
  console.log(`fingerprint ${fingerprint} (${files.length} files)`);
}
