// Finance Command Centre content: personas, metrics, the finance value stream and
// the demo agent catalogue. The data files under ./data came over from the
// Finance Command Centre prototype unchanged (apart from colours); this module
// gives them types and turns navigation targets into page addresses.
//
// Everything here is illustrative, static content. It is the same for every
// workspace and is not stored in the database.

import * as metricsData from "./data/metrics";
import * as personasData from "./data/personas";
import * as domainData from "./data/domain";
import * as agentsData from "./data/agents";
import * as newsData from "./data/news";
import * as challengesData from "./data/challenges";
import * as p2p from "./data/p2pMatrix";
import * as o2c from "./data/o2cMatrix";
import * as r2r from "./data/r2rMatrix";

export type Level = "red" | "amber" | "green";
export type Rating = "High" | "Medium" | "Low";

export type Metric = { label: string; unit: string; category: string; base: number; vol: number; better: "up" | "down" };
export type Target = { view: string; l1?: string | null; l2?: string | null; l3?: string | null };
export type Persona = {
  id: string; name: string; role: string; avatar: string; focus: string;
  metrics: string[]; insights: { text: string; level: Level }[];
};
export type Action = {
  title: string; sev: "high" | "med" | "low"; meta: string;
  breakdown: [string, string][]; steps: string[]; goTo?: Target;
};
export type Drilldown = {
  title: string; metricVal: string; note: string; cols: string[];
  dims: Record<string, { seg: string; share: string; growth: string; marginChg: string; level: Level }[]>;
};
export type Activity = { id: string; name: string; potential: Rating; impact: Rating; flagship?: boolean };
export type Area = { id: string; name: string; potential: Rating; impact: Rating; l3: Activity[] };
export type Tower = { id: string; name: string; priority: Rating; l2: Area[] };
export type Theme = { id: string; name: string; gap: string; towers: string[] };
export type DeepDive = {
  theme: string; gap: string; challenges: string[];
  steps: { t: string; o: "AI" | "Automation" | "Human"; agent: string | null }[];
  features: string[];
  benefit: { k1: string; l1: string; k2: string; l2: string; calc: string; assumptions: string[] };
  india: { co: string; tag: string; text: string; src: string };
};
export type DemoAgent = {
  id: string; name: string; type: "AI" | "Automation" | "Human"; tower: string; archetype: string;
  desc: string; features?: string[]; techStack?: string; model?: string;
  usage?: { runs: number; latency: string; success: string; tokens: string };
  social?: { likes: number; downloads: number; rating: number; feedback: string[] };
};
export type NewsTab = { id: string; label: string; items: { tag: string; text: string; meta: string }[] };
export type MatrixItem = { code: string; name: string; badge?: number | null; isCfoInput?: boolean; isHighlighted?: boolean };
export type MatrixColumn = { code: string; name: string; assetCount: number; phase: string; subProcessId?: string; items: MatrixItem[] };
export type MatrixPhase = { id: string; name: string; columnIds: string[] };
export type AppTile = {
  id: string; name: string; type: string; status: string; maturity?: string; agentUrl?: string;
  agents?: string[]; features: string[]; metrics?: Record<string, string>;
};
export type AppTileGroup = {
  title: string; subProcessId: string; l3Id: string; flagship: boolean; description: string; applicationTiles: AppTile[];
};

export const METRICS = metricsData.METRICS as unknown as Record<string, Metric>;
export const METRIC_LINKS = metricsData.METRIC_LINKS as unknown as Record<string, Target>;
export const DRILLDOWN_METRICS = metricsData.DRILLDOWN_METRICS as string[];
export const DRILLDOWN = metricsData.DRILLDOWN as unknown as Record<string, Drilldown>;
export const { genSeries, fmtNum, catColor, seedFromString, mulberry32 } = metricsData as unknown as {
  genSeries: (key: string, base: number, vol: number, n?: number) => number[];
  fmtNum: (n: number) => string;
  catColor: (cat: string) => string;
  seedFromString: (s: string) => number;
  mulberry32: (seed: number) => () => number;
};

export const PERSONAS = personasData.PERSONAS as unknown as Persona[];
export const PLACEHOLDER_PERSONAS = personasData.PLACEHOLDER_PERSONAS as string[];
export const ACTION_LIBRARY = personasData.ACTION_LIBRARY as unknown as Record<string, Action[]>;

export const DOMAIN = domainData.DOMAIN as unknown as Tower[];
export const THEMES = domainData.THEMES as unknown as Theme[];
export const THEME_L1_MAP = domainData.THEME_L1_MAP as unknown as Record<string, string[] | null>;
export const DEEPDIVES = domainData.DEEPDIVES as unknown as Record<string, DeepDive>;

export const AGENTS = agentsData.AGENTS as unknown as DemoAgent[];
export const NEWS_TABS = newsData.NEWS_TABS as unknown as NewsTab[];
export const CHALLENGE_BUCKETS = challengesData.CHALLENGE_BUCKETS as { id: string; name: string; color: string }[];
export const CHALLENGES = challengesData.CHALLENGES as { q: string; bucket: string; link: string | null }[];

/** Towers whose content is still being written: shown, but not selectable. */
export const COMING_SOON_TOWERS = new Set(["fpna-tower", "treasury-tower", "cost-tower", "tax-tower", "audit-tower"]);

/** The three towers drawn as a full value-chain matrix rather than a grid of areas. */
export type MatrixConfig = {
  label: string;
  phases: MatrixPhase[];
  columns: MatrixColumn[];
  tiles: Record<string, AppTileGroup>;
  fallback: string;
  /** Which boxes carry a star badge, and what it says. */
  starred: (col: MatrixColumn, item: MatrixItem | null) => boolean;
  starLabel: string;
};

export const MATRICES: Record<string, MatrixConfig> = {
  p2p: {
    label: "P2P",
    phases: p2p.P2P_PHASES as MatrixPhase[],
    columns: p2p.P2P_MATRIX_COLUMNS as unknown as MatrixColumn[],
    tiles: p2p.P2P_APPLICATION_TILES as unknown as Record<string, AppTileGroup>,
    fallback: "5.9",
    starred: (col, item) => (item ? !!item.isCfoInput : col.code === "5.9" || col.code === "5.12"),
    starLabel: "CFO advisory PTP Z-curve input",
  },
  o2c: {
    label: "O2C",
    phases: o2c.O2C_PHASES as MatrixPhase[],
    columns: o2c.O2C_MATRIX_COLUMNS as unknown as MatrixColumn[],
    tiles: o2c.O2C_APPLICATION_TILES as unknown as Record<string, AppTileGroup>,
    fallback: "2.12",
    starred: (_col, item) => !!item?.isCfoInput,
    starLabel: "CFO advisory input",
  },
  r2r: {
    label: "R2R",
    phases: r2r.R2R_PHASES as MatrixPhase[],
    columns: r2r.R2R_MATRIX_COLUMNS as unknown as MatrixColumn[],
    tiles: r2r.R2R_APPLICATION_TILES as unknown as Record<string, AppTileGroup>,
    fallback: "8.2",
    starred: (_col, item) => !!item?.isHighlighted,
    starLabel: "High-priority transformation lever",
  },
};

/** The application tiles behind a matrix box: its own, its column's, or the tower's default. */
export function tilesFor(m: MatrixConfig, code: string): AppTileGroup {
  if (m.tiles[code]) return m.tiles[code];
  const [a, b] = code.split(".");
  return m.tiles[`${a}.${b}`] || m.tiles[m.fallback];
}

/** Finds a matrix column or item by its code. */
export function findBox(m: MatrixConfig, code: string): { column: MatrixColumn; item: MatrixItem | null } | null {
  for (const column of m.columns) {
    if (column.code === code) return { column, item: null };
    const item = column.items.find((i) => i.code === code);
    if (item) return { column, item };
  }
  return null;
}

export function focusLevel(potential: Rating, impact: Rating): Level {
  const w = { High: 3, Medium: 2, Low: 1 } as Record<string, number>;
  const score = (w[potential] || 1) + (w[impact] || 1);
  return score >= 5 ? "red" : score === 4 ? "amber" : "green";
}
export const focusLevelSingle = (p: Rating): Level => (p === "High" ? "red" : p === "Medium" ? "amber" : "green");

/** Locates an L3 activity anywhere in the value stream. */
export function findActivity(l3: string): { tower: Tower; area: Area; activity: Activity } | null {
  for (const tower of DOMAIN) for (const area of tower.l2) {
    const activity = area.l3.find((a) => a.id === l3);
    if (activity) return { tower, area, activity };
  }
  return null;
}

// ── page addresses ─────────────────────────────────────────────────────────

export type StreamParams = { tower?: string | null; area?: string | null; activity?: string | null; theme?: string | null; box?: string | null };

export function streamHref(p: StreamParams = {}): string {
  const qs = new URLSearchParams();
  for (const k of ["theme", "tower", "area", "activity", "box"] as const) {
    const v = p[k];
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return `/finance/value-stream${s ? `?${s}` : ""}`;
}

export const personaHref = (id: string) => `/finance/personas/${encodeURIComponent(id)}`;

/** Where a navigation target from the prototype's data now lives. */
export function targetHref(t: Target, personaId?: string): string {
  if (t.view === "domain") return streamHref({ tower: t.l1, area: t.l2, activity: t.l3 });
  if (t.view === "challenges") return "/finance/challenges";
  if (t.view === "cockpit" && personaId) return personaHref(personaId);
  return "/finance/personas";
}

/** Where clicking a cockpit metric goes: its driver tree, or the process it belongs to. */
export function metricHref(metricId: string, personaId: string): string | null {
  if (DRILLDOWN_METRICS.includes(metricId)) return `${personaHref(personaId)}/metrics/${encodeURIComponent(metricId)}`;
  const link = METRIC_LINKS[metricId];
  return link ? targetHref(link, personaId) : null;
}
