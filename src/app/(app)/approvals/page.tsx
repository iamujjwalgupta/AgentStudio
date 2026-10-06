import "../agents/agents.css";
import "./approvals.css";
import { requireUser } from "@/lib/auth";
import ApprovalsInbox from "@/components/approvals/ApprovalsInbox";

export const dynamic = "force-dynamic";

/** Actions agents have paused on, what they would do, and the decisions already made. */
export default async function ApprovalsPage() {
  await requireUser();
  return <ApprovalsInbox />;
}
