import "./audit.css";
import { requireUser } from "@/lib/auth";
import AuditTrail from "@/components/AuditTrail";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  await requireUser();
  return <AuditTrail />;
}
