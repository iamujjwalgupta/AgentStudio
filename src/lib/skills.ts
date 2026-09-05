/**
 * Skills: reusable know-how, written once in a workspace and attached to any
 * number of agents.
 *
 * The split against tools is deliberate. A tool is capability — it reaches out
 * of the process and is gated by risk. A skill is instruction: how this
 * workspace does a piece of work, in its own words. Granting one can never let
 * an agent do something it could not already do, which is why skills carry no
 * gate and no risk.
 *
 * They reach the agent by progressive disclosure. Every attached skill's name
 * and one-line description sits in the system prompt; the body is pulled with
 * the load_skill tool only when the agent decides it needs it. A workspace can
 * therefore accumulate skills without every agent paying for all of them on
 * every turn.
 */
import { q } from "./db";

export type SkillRow = {
  id: string;
  name: string;
  label: string;
  description: string;
  instructions: string;
  created_at?: string;
  updated_at?: string;
};

export const LABEL_MAX = 80;
export const DESCRIPTION_MAX = 400;
export const INSTRUCTIONS_MAX = 20000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The handle the agent passes to load_skill. Slugged so it survives being read
 * back out of a model's output, where quoting and casing are not to be trusted.
 */
export function skillName(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * The skills an agent has been granted, in the order its spec lists them.
 *
 * Ids that no longer resolve are dropped rather than raised. A skill deleted
 * after an agent was published must degrade that agent, not strand it — and a
 * spec carried in from another workspace by a share names ids that were never
 * ours.
 */
export async function skillsFor(orgId: string, ids: string[]): Promise<SkillRow[]> {
  const wanted = (ids || []).filter((id) => typeof id === "string" && UUID.test(id));
  if (!wanted.length) return [];
  const rows = await q<SkillRow>(
    `select id, name, label, description, instructions from skills
      where org_id = $1 and id = any($2::uuid[])`,
    [orgId, wanted],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return wanted.map((id) => byId.get(id)).filter(Boolean) as SkillRow[];
}
