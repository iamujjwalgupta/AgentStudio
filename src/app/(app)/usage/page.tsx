import "./usage.css";
import { requireUser } from "@/lib/auth";
import UsageDashboard from "@/components/UsageDashboard";

export const dynamic = "force-dynamic";

/** Token metering: usage on the Gemini key, and the limits on it. */
export default async function UsagePage() {
  await requireUser();
  return <UsageDashboard />;
}
