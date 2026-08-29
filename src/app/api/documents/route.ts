import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";

export const runtime = "nodejs";

export async function GET() {
  const u = await requireUser();
  const docs = await q(
    `select id, name, mime, size_bytes, created_at from documents where org_id = $1 order by created_at desc limit 100`,
    [u.orgId],
  );
  return NextResponse.json({ documents: docs });
}

export async function POST(req: Request) {
  const u = await requireUser();
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });

  const dir = path.join(process.env.STORAGE_DIR || path.join(process.cwd(), "storage"), "uploads", u.orgId);
  await fs.mkdir(dir, { recursive: true });
  const safe = path.basename(file.name).replace(/[^\w.\- ]+/g, "_");
  const target = path.join(dir, `${Date.now()}-${safe}`);
  await fs.writeFile(target, Buffer.from(await file.arrayBuffer()));

  const row = await one<any>(
    `insert into documents (org_id, name, mime, path, size_bytes, uploaded_by)
     values ($1,$2,$3,$4,$5,$6) returning id, name, size_bytes`,
    [u.orgId, safe, file.type || "", target, file.size, u.id],
  );
  await audit(u.orgId, u, "Uploaded document", "document", row.id, { name: safe, bytes: file.size });
  return NextResponse.json({ document: row });
}
