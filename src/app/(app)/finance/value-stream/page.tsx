import { requireUser } from "@/lib/auth";
import ValueStreamView from "@/components/finance/ValueStreamView";

export const dynamic = "force-dynamic";

type Q = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;

/** The finance value stream; where you are is kept in the address. */
export default async function ValueStreamPage({ searchParams }: { searchParams: Q }) {
  await requireUser();
  return (
    <ValueStreamView
      theme={one(searchParams.theme)}
      tower={one(searchParams.tower)}
      area={one(searchParams.area)}
      activity={one(searchParams.activity)}
      box={one(searchParams.box)}
    />
  );
}
