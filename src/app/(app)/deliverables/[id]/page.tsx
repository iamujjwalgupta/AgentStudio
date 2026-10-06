import "@/components/deliverable/deliverable.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { normalizeDeliverable } from "@/lib/deliverable";
import DeliverableView from "@/components/deliverable/DeliverableView";

export const dynamic = "force-dynamic";

/** An agent's presented result, full screen. */
export default async function DeliverablePage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const row = await one<any>(
    `select d.id, d.spec, d.run_id, a.name as agent_name
       from deliverables d left join agents a on a.id = d.agent_id
      where d.id = $1 and d.org_id = $2`,
    [id, u.orgId],
  );
  if (!row) notFound();
  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14, fontSize: 13 }}>
        {row.run_id && <Link href={`/runs/${row.run_id}`}>← Back to the run</Link>}
        {row.agent_name && <span style={{ color: "var(--muted)" }}>{row.agent_name}</span>}
      </div>
      <DeliverableView d={normalizeDeliverable(row.spec)} id={row.id} />
    </div>
  );
}
