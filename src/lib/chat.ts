import { q, one } from "./db";
import type { SessionUser } from "./auth";
import { canDecide, CANNOT_DECIDE, otherApproverCount } from "./approvals";
import { toolById } from "./tools";
import { STUCK_MINUTES } from "./run-list";
import { formatValue, normalizeDeliverable, type Deliverable } from "./deliverable";
import { emptySpec, normaliseInputs, type AgentSpec } from "./types";

/**
 * Conversations with an agent. Each turn is an ordinary run; this gathers a
 * conversation's turns for the chat screen, and turns the earlier ones into
 * context for a follow-up.
 */

export type ChatApproval = {
  id: string;
  tool: string;
  label: string;
  risk: string;
  payload: any;
  status: string;
  comment: string | null;
  /** Why this person cannot decide it, when they cannot. */
  blocked: string | null;
  selfWouldApprove: boolean;
};

export type ChatTurn = {
  runId: string;
  message: string;
  files: string[];
  values: Record<string, string>;
  status: string;
  stuck: boolean;
  dryRun: boolean;
  output: string | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  steps: { kind: string; tool: string | null; title: string; status: string; ms: number }[];
  deliverable: { id: string; spec: Deliverable } | null;
  approvals: ChatApproval[];
};

export async function chatTurns(u: SessionUser, chatId: string, fileInputKeys: string[]): Promise<ChatTurn[]> {
  const runs = await q<any>(
    `select id, message, inputs, status, dry_run, output, error, started_at, ended_at, started_by,
            (status = 'running' and started_at < now() - interval '${STUCK_MINUTES} minutes') as stuck
       from runs where chat_id = $1 and org_id = $2 order by started_at asc`,
    [chatId, u.orgId],
  );
  if (!runs.length) return [];
  const ids = runs.map((r) => r.id);
  const [steps, approvals, deliverables] = await Promise.all([
    q<any>(`select run_id, kind, tool, title, status, duration_ms from run_steps where run_id = any($1::uuid[]) order by run_id, idx`, [ids]),
    q<any>(`select id, run_id, tool, payload, status, comment from approvals where run_id = any($1::uuid[]) order by created_at`, [ids]),
    q<any>(
      `select distinct on (run_id) id, run_id, spec from deliverables where run_id = any($1::uuid[]) order by run_id, created_at desc`,
      [ids],
    ),
  ]);

  // The same rule as the run page and the Approvals page.
  const eligible = canDecide(u);
  const others = eligible && approvals.some((a) => a.status === "pending") ? await otherApproverCount(u.orgId, u.id) : 0;

  let before: Record<string, string> = {};
  return runs.map((r) => {
    const values: Record<string, string> = r.inputs && typeof r.inputs === "object" ? r.inputs : {};
    // Files given with this message; one carried on from an earlier turn is not shown again.
    const given = fileInputKeys.map((k) => values[k]).filter((v, i) => v && v !== before[fileInputKeys[i]]);
    before = values;
    const mine = r.started_by === u.id;
    const blocked = !eligible
      ? CANNOT_DECIDE
      : mine && others > 0
        ? `You started this, so someone else must decide it. There ${others === 1 ? "is 1 other person" : `are ${others} other people`} here who can.`
        : null;
    const dl = deliverables.find((x) => x.run_id === r.id);
    return {
      runId: r.id,
      message: r.message ?? "",
      files: given,
      values,
      status: r.status,
      stuck: Boolean(r.stuck),
      dryRun: Boolean(r.dry_run),
      output: r.output,
      error: r.error,
      startedAt: new Date(r.started_at).toISOString(),
      endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
      steps: steps
        .filter((s) => s.run_id === r.id)
        .map((s) => ({ kind: s.kind, tool: s.tool, title: s.title, status: s.status, ms: s.duration_ms || 0 })),
      deliverable: dl ? { id: dl.id, spec: normalizeDeliverable(dl.spec) } : null,
      approvals: approvals
        .filter((a) => a.run_id === r.id)
        .map((a) => {
          const def = toolById(a.tool);
          return {
            id: a.id,
            tool: a.tool,
            label: def?.label ?? a.tool,
            risk: def?.risk ?? "medium",
            payload: a.payload,
            status: a.status,
            comment: a.comment ?? null,
            blocked,
            selfWouldApprove: eligible && mine && others === 0,
          };
        }),
    };
  });
}

/** A presented result's tables as compact text, smallest first, within a budget. */
function tableDetail(d: Deliverable, budget = 6000): string[] {
  const out: string[] = [];
  let used = 0;
  for (const t of [...d.tables].sort((a, b) => a.rows.length - b.rows.length)) {
    if (!t.rows.length) continue;
    const cols = t.columns.map((c) => c.key);
    const rows = t.rows.slice(0, 25).map((r) =>
      cols.map((k) => `${k}: ${t.columns.find((c) => c.key === k)?.format === "currency" ? formatValue(r[k], "currency", d.currency) : r[k] ?? "—"}`).join("; "),
    );
    const block = [`Table "${t.title}" (${t.rows.length} rows${t.rows.length > 25 ? ", first 25" : ""}):`, ...rows.map((x) => `- ${x}`)].join("\n");
    if (used + block.length > budget) {
      out.push(`Table "${t.title}": ${t.rows.length} rows (not repeated here; query the saved views for them).`);
      continue;
    }
    out.push(block);
    used += block.length;
  }
  return out;
}

/** A conversation's title, from the first thing the person said or gave. */
export function chatTitle(message: string, files: string[]): string {
  const text = message.replace(/\s+/g, " ").trim();
  if (text) return text.length > 70 ? text.slice(0, 67).trimEnd() + "…" : text;
  if (files.length) return files.join(", ").slice(0, 70);
  return "New conversation";
}

/**
 * The earlier turns, for a follow-up: what was asked, which files were given,
 * what the agent answered and the headline of what it presented. Kept short:
 * the agent can re-read files and re-query data for detail.
 */
export function followUpContext(turns: ChatTurn[], views: string[] = []): string {
  const done = turns.filter((t) => t.status === "completed" || t.status === "failed" || t.status === "rejected");
  if (!done.length) return "";
  const recent = done.slice(-6);
  const parts = recent.map((t, i) => {
    const lines = [`Turn ${done.length - recent.length + i + 1}. The user asked: ${t.message || "(no message; the files below)"}`];
    if (t.files.length) lines.push(`Files given: ${t.files.join(", ")}`);
    if (t.status !== "completed") lines.push(`That turn did not finish: ${t.error || t.status}`);
    if (t.output) lines.push(`You answered: ${t.output.length > 1500 ? t.output.slice(0, 1500) + " …" : t.output}`);
    if (t.deliverable) {
      const d = t.deliverable.spec;
      const figures = d.kpis.map((k) => `${k.label} ${formatValue(k.value, k.format, d.currency)}`).join("; ");
      const tables = d.tables.map((x) => `${x.title} (${x.rows.length} rows)`).join("; ");
      lines.push(`You presented "${d.title}"${figures ? ` — figures: ${figures}` : ""}${tables ? ` — tables: ${tables}` : ""}.`);
    }
    // The latest result's detail, so a follow-up (an email, a list for someone)
    // can name the actual items without querying again.
    if (t.deliverable && t === recent[recent.length - 1]) lines.push(...tableDetail(t.deliverable.spec));
    if (t.approvals.length) lines.push(`Actions put to a person: ${t.approvals.map((a) => `${a.label} — ${a.status}`).join("; ")}.`);
    if (t.dryRun) lines.push(`That turn was a rehearsal: gated actions were described, not carried out.`);
    return lines.join("\n");
  });
  return [
    `Earlier in this conversation (most recent last):`,
    ``,
    parts.join("\n\n"),
    ...(views.length ? [``, `Views saved from the uploaded files, still there to query with query_files: ${views.join(", ")}.`] : []),
  ].join("\n");
}

/** The agent as the chat runs it: the published version when there is one, else the draft. */
export async function chatAgent(u: SessionUser, agentId: string) {
  const agent = await one<any>(
    `select id, name, status, published_ver, draft_spec from agents where id = $1 and org_id = $2`,
    [agentId, u.orgId],
  );
  if (!agent) return null;
  const published =
    agent.status === "published" && agent.published_ver
      ? await one<any>(`select spec from agent_versions where agent_id = $1 and version = $2`, [agentId, agent.published_ver])
      : null;
  const spec: AgentSpec = { ...emptySpec(), ...(published?.spec || agent.draft_spec || {}) };
  return { id: agent.id as string, name: agent.name as string, status: agent.status as string, published: Boolean(published), spec };
}

export const fileInputKeys = (spec: AgentSpec) =>
  normaliseInputs(spec.inputs as any[])
    .filter((i) => i.type === "file")
    .map((i) => i.key);
