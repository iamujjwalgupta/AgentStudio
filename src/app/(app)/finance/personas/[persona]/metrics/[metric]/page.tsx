import { requireUser } from "@/lib/auth";
import { DrilldownView } from "@/components/finance/PersonaViews";

export const dynamic = "force-dynamic";

/** A metric's driver tree, broken down by segment. */
export default async function MetricPage({ params }: { params: { persona: string; metric: string } }) {
  await requireUser();
  return <DrilldownView personaId={decodeURIComponent(params.persona)} metricId={decodeURIComponent(params.metric)} />;
}
