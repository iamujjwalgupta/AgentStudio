import { requireUser } from "@/lib/auth";
import { listApps } from "@/lib/apps";
import AppsHub from "@/components/AppsHub";

export const dynamic = "force-dynamic";

export default async function AppsPage() {
  const u = await requireUser();
  const apps = await listApps(u.orgId);

  return <AppsHub initialApps={apps} />;
}
