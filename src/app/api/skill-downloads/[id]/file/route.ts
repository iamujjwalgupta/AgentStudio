import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { consumeDownload } from "@/lib/skill-downloads";

export const runtime = "nodejs";

/** The single download an approved request allows, of the snapshot the admin approved. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const r = await consumeDownload(u.orgId, u, id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return new Response(r.markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${r.filename.replace(/[^\w.-]+/g, "-")}"`,
      "Cache-Control": "no-store",
    },
  });
}
