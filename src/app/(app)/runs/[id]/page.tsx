import "../../agents/agents.css";
import "../../approvals/approvals.css";
import "../../skills/skills.css";
import "../runs.css";
import "@/components/deliverable/deliverable.css";
import RunView from "@/components/RunView";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  return <RunView runId={id} />;
}
