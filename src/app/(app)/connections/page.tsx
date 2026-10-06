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
  await requireUser();
  const powers: Record<string, string[]> = {};
  for (const t of SELECTABLE_TOOLS) {
    if (t.needs) (powers[t.needs] ??= []).push(t.label);
  }
  powers.anthropic = ["Every agent run"];
  powers.gemini = ["The Google ADK sandbox"];
  return (
    <Suspense>
      <ConnectionsManager powers={powers} />
    </Suspense>
  );
}
