import { requireUser } from "@/lib/auth";
import { CockpitView } from "@/components/finance/PersonaViews";

export const dynamic = "force-dynamic";

/** One persona's cockpit: metrics, open actions and news. */
export default async function CockpitPage({ params }: { params: { persona: string } }) {
  await requireUser();
  return <CockpitView personaId={decodeURIComponent(params.persona)} />;
}
