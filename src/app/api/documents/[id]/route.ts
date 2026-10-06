import fs from "fs/promises";
import { storedPath } from "@/lib/storage";
import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const doc = await one<any>(`select * from documents where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const buf = await fs.readFile(storedPath(doc.path));
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": doc.mime && doc.mime !== "generated" ? doc.mime : "application/octet-stream",
      "content-disposition": `attachment; filename="${doc.name}"`,
    },
  });
}
