import "./skills.css";
import { requireUser } from "@/lib/auth";
import SkillsManager from "@/components/SkillsManager";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  await requireUser();
  return <SkillsManager />;
}
