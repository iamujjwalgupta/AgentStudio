import { requireUser } from "@/lib/auth";
import { PersonasView } from "@/components/finance/PersonaViews";

export const dynamic = "force-dynamic";

/** The five finance leadership roles, each with a cockpit and open actions. */
export default async function PersonasPage() {
  await requireUser();
  return <PersonasView />;
}
