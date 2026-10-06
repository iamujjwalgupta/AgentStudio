/** Plain-language labels for run statuses and how runs were started, shared by the list and a run's page. */

export const RUN_STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  running: { label: "Running", cls: "blue", dot: "live" },
  awaiting_approval: { label: "Waiting for approval", cls: "amber", dot: "wait" },
  completed: { label: "Succeeded", cls: "green", dot: "ok" },
  failed: { label: "Failed", cls: "red", dot: "bad" },
  rejected: { label: "Finished, an action was rejected", cls: "grey", dot: "bad" },
  stuck: { label: "Stopped responding", cls: "red", dot: "bad" },
};
export const statusOf = (status: string, stuck?: boolean) => RUN_STATUS[stuck ? "stuck" : status] ?? { label: status, cls: "grey", dot: "" };

export const TRIGGER: Record<string, string> = {
  manual: "Manual",
  schedule: "Scheduled",
  api: "API",
  team: "Team (sub-agent)",
  rehearsal: "Dry run",
  test: "Test",
  other: "Other",
};
export function triggerKind(r: { trigger?: string; dry_run?: boolean; parent_run_id?: string | null }) {
  if (r.dry_run || r.trigger === "rehearsal") return "rehearsal";
  if (r.trigger?.startsWith("swarm") || r.parent_run_id) return "team";
  return ["manual", "schedule", "api", "test"].includes(r.trigger || "") ? (r.trigger as string) : "other";
}

export function duration(startIso: string, endIso?: string | null) {
  const ms = (endIso ? new Date(endIso).getTime() : Date.now()) - new Date(startIso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60 ? `${s % 60}s` : ""}`.trim();
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}
export const money = (v: number | null | undefined) => {
  const n = Number(v) || 0;
  return n === 0 ? "—" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
};
export const tokensText = (n: number | null | undefined) => {
  const v = Number(n) || 0;
  return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(v);
};
export function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
