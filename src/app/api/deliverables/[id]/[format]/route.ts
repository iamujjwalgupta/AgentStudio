import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import { fileBase, normalizeDeliverable } from "@/lib/deliverable";
import { deliverableToPdf, deliverableToPptx, deliverableToXlsx } from "@/lib/deliverable-export";

export const runtime = "nodejs";
export const maxDuration = 60;

const FORMATS = {
  xlsx: { make: deliverableToXlsx, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel" },
  pdf: { make: deliverableToPdf, type: "application/pdf", label: "PDF" },
  pptx: { make: deliverableToPptx, type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PowerPoint" },
} as const;

/** A presented result as an Excel workbook, PDF report or PowerPoint deck. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; format: string }> }) {
  const u = await requireUser();
  const { id, format } = await params;
  const f = FORMATS[format as keyof typeof FORMATS];
  if (!f || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const row = await one<any>(`select id, spec, run_id from deliverables where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!row) return new Response("Not found", { status: 404 });

  const d = normalizeDeliverable(row.spec);
  let body: Buffer;
  try {
    body = await f.make(d);
  } catch (e: any) {
    console.error(`[deliverable ${format}]`, e);
    return new Response(`The ${f.label} file could not be made: ${e?.message || e}`, { status: 500 });
  }
  await audit(u.orgId, u, `Downloaded result as ${f.label}`, "run", row.run_id, { deliverable: id, title: d.title });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": f.type,
      "Content-Disposition": `attachment; filename="${fileBase(d)}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
