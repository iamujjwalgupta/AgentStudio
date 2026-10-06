import "./usage.css";
import { requireUser } from "@/lib/auth";
import UsageDashboard from "@/components/UsageDashboard";

export const dynamic = "force-dynamic";

/** Token metering: usage on the Anthropic and Gemini keys, and the limits on them. */
export default async function UsagePage() {
  await requireUser();
  return <UsageDashboard />;
}
