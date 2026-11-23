import "../agents/agents.css";
import "../members/members.css";
import "./api-keys.css";
import { requireUser } from "@/lib/auth";
import ApiKeysManager from "@/components/api-keys/ApiKeysManager";

export const dynamic = "force-dynamic";

/** Keys that let other applications start this workspace's agents. Admins only. */
export default async function ApiKeysPage() {
  const u = await requireUser();
  if (!u.isOwner && u.role !== "admin") {
    return (
      <div className="page">
        <div className="eyebrow">Workspace</div>
        <h1>API keys</h1>
        <p className="sub">Only workspace admins can create and revoke API keys. Ask an admin of {u.orgName} if an application needs one.</p>
      </div>
    );
  }
  return <ApiKeysManager />;
}
