import "../agents/agents.css";
import "./runs.css";
import { requireUser } from "@/lib/auth";
import RunsList from "@/components/runs/RunsList";

export const dynamic = "force-dynamic";

/** Every run in the workspace, filterable, with status, duration and cost. */
export default async function RunsPage() {
  await requireUser();
  return <RunsList />;
}
