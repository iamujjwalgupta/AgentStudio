import "../agents/agents.css";
import "./members.css";
import { requireUser } from "@/lib/auth";
import MembersManager from "@/components/members/MembersManager";

export const dynamic = "force-dynamic";

/** Who is in the workspace, their roles, and invitations waiting to be accepted. */
export default async function MembersPage() {
  await requireUser();
  return <MembersManager />;
}
