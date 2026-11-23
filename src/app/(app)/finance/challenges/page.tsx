import { requireUser } from "@/lib/auth";
import ChallengesView from "@/components/finance/ChallengesView";

export const dynamic = "force-dynamic";

/** Business problems by CFO agenda, linked to the processes that solve them. */
export default async function ChallengesPage() {
  await requireUser();
  return <ChallengesView />;
}
