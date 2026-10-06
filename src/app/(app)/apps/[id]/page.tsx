import "../apps.css";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getApp, listApps } from "@/lib/apps";
import { q } from "@/lib/db";
import AppCanvasViewer from "@/components/AppCanvasViewer";

export const dynamic = "force-dynamic";

export default async function AppCanvasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const u = await requireUser();
  const { id } = await params;

  const app = await getApp(u.orgId, id);
  if (!app) {
    notFound();
  }

  let availableApps = await listApps(u.orgId);
  let availableAgents: { id: string; name: string; archetype?: string; description?: string }[] = [];
  try {
    availableAgents = await q<{ id: string; name: string; archetype: string; description: string }>(
      `select id, name, archetype, description from agents where org_id = $1 order by name asc`,
      [u.orgId]
    );
  } catch (err) {
    console.warn("Could not query agents for canvas assistant:", err);
  }

  return (
    <AppCanvasViewer
      app={app}
      availableApps={availableApps}
      availableAgents={availableAgents}
    />
  );
}

