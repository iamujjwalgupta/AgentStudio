import "../agents/agents.css";
import "./shares.css";
import { requireUser } from "@/lib/auth";
import SharesManager from "@/components/shares/SharesManager";

export const dynamic = "force-dynamic";

/** Agents sent to you from other workspaces, and the ones this workspace has sent. */
export default async function SharesPage() {
  await requireUser();
  return <SharesManager />;
}
