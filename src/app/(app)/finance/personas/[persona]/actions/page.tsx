import { requireUser } from "@/lib/auth";
import { ActionListView } from "@/components/finance/PersonaViews";

export const dynamic = "force-dynamic";

/** Every open action for one persona. */
export default async function PersonaActionsPage({ params }: { params: { persona: string } }) {
  await requireUser();
  return <ActionListView personaId={decodeURIComponent(params.persona)} />;
}
