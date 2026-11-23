import "./connections.css";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { SELECTABLE_TOOLS } from "@/lib/tools";
import ConnectionsManager from "@/components/ConnectionsManager";

export const dynamic = "force-dynamic";

/**
 * Connections: only the kinds agents can use (lib/connection-types), each with
 * the actions it powers, taken from the tools that name it as a need.
 */
export default async function ConnectionsPage() {
  const u = await requireUser();
  const powers: Record<string, string[]> = {};
  for (const t of SELECTABLE_TOOLS) {
    if (t.needs) (powers[t.needs] ??= []).push(t.label);
  }
  powers.gemini = ["Agent runs (the default)", "Web search", "Sandbox tests"];
  powers.anthropic = ["Agents set to Claude", "Web search"];
  powers.openai = ["Agents set to OpenAI", "Web search"];
  powers.azure_openai = ["Agents set to Azure OpenAI"];
  powers.openai_compatible = ["Agents set to this service"];
  return (
    <Suspense>
      {/* The workspace AI key card is for the owner and admins; members never see it. */}
      <ConnectionsManager powers={powers} canManage={u.canManageMembers} />
    </Suspense>
  );
}
