import { q, one } from "@/lib/db";

export interface EmbeddedApp {
  id: string;
  org_id: string;
  name: string;
  description: string;
  url: string;
  category: "agent-ui" | "dashboard" | "dev-tools" | "analytics" | "docs" | "custom" | string;
  icon: string;
  display_mode: "canvas" | "fullscreen" | "side_by_side" | string;
  permissions: string;
  position?: number;
  is_builtin?: boolean;
  created_by?: string | null;
  /** Who added it, when known. */
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export const BUILTIN_APPS: EmbeddedApp[] = [
  {
    id: "builtin-langgraph-studio",
    org_id: "system",
    name: "LangGraph State Visualizer",
    description: "Interactive state graph inspector and multi-agent workflow visualizer for reasoning cycles.",
    url: "https://langchain-ai.github.io/langgraph/",
    category: "agent-ui",
    icon: "bot",
    display_mode: "canvas",
    permissions: "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads",
    position: 0,
    is_builtin: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "builtin-gradio-playground",
    org_id: "system",
    name: "Gradio AI Assistant Playground",
    description: "Interactive agent testbed with streaming chat, prompt inspections, and multi-modal attachments.",
    url: "https://gradio.app/",
    category: "agent-ui",
    icon: "sparkles",
    display_mode: "canvas",
    permissions: "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads",
    position: 1,
    is_builtin: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "builtin-grafana-metrics",
    org_id: "system",
    name: "Grafana Agent Observability",
    description: "Real-time token consumption, LLM execution latency, cost metrics, and error rates.",
    url: "https://play.grafana.org/d/000000012/grafana-play-home",
    category: "dashboard",
    icon: "chart",
    display_mode: "canvas",
    permissions: "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads",
    position: 2,
    is_builtin: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "builtin-swagger-console",
    org_id: "system",
    name: "Swagger / OpenAPI Live Console",
    description: "Live REST API testbed and interactive schema viewer for enterprise tool endpoints.",
    url: "https://petstore.swagger.io/",
    category: "dev-tools",
    icon: "terminal",
    display_mode: "canvas",
    permissions: "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads",
    position: 3,
    is_builtin: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "builtin-streamlit-hub",
    org_id: "system",
    name: "Streamlit Operations Hub",
    description: "Interactive data dashboards, workflow triggers, and operational telemetry for agent pipelines.",
    url: "https://share.streamlit.io/",
    category: "analytics",
    icon: "database",
    display_mode: "canvas",
    permissions: "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads",
    position: 4,
    is_builtin: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

// Fallback in-memory store if DB is temporarily unreachable
const inMemoryApps: Record<string, EmbeddedApp[]> = {};
const inMemoryHidden: Record<string, Set<string>> = {};

let tableChecked = false;
async function ensureTable() {
  if (tableChecked) return;
  try {
    await q(`
      create table if not exists apps (
        id           text not null default gen_random_uuid()::text,
        org_id       uuid not null references orgs(id) on delete cascade,
        name         text not null,
        description  text not null default '',
        url          text not null,
        category     text not null default 'general',
        icon         text not null default 'globe',
        display_mode text not null default 'canvas',
        permissions  text not null default 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads',
        position     integer not null default 0,
        created_by   uuid references users(id),
        created_at   timestamptz not null default now(),
        updated_at   timestamptz not null default now(),
        primary key (id, org_id)
      );
      alter table apps add column if not exists position integer not null default 0;
      create table if not exists workspace_hidden_apps (
        org_id     uuid not null references orgs(id) on delete cascade,
        app_id     text not null,
        created_at timestamptz not null default now(),
        primary key (org_id, app_id)
      );
      create index if not exists idx_workspace_hidden_apps_org on workspace_hidden_apps (org_id);
      create index if not exists idx_apps_org_pos on apps (org_id, position asc, updated_at desc);
    `);
    tableChecked = true;
  } catch (err) {
    console.warn("Could not ensure apps table:", err);
  }
}

export async function listApps(orgId: string): Promise<EmbeddedApp[]> {
  await ensureTable();

  // 1. Get hidden apps for this workspace
  let hiddenSet = new Set<string>();
  try {
    const hiddenRows = await q<{ app_id: string }>(
      `select app_id from workspace_hidden_apps where org_id = $1`,
      [orgId]
    );
    hiddenSet = new Set(hiddenRows.map((r) => r.app_id));
  } catch (err) {
    hiddenSet = inMemoryHidden[orgId] || new Set<string>();
  }

  // 2. Query workspace apps in DB
  let dbRows: EmbeddedApp[] = [];
  try {
    dbRows = await q<EmbeddedApp>(
      `select id, org_id, name, description, url, category, icon, display_mode, permissions,
              position, created_by, created_at, updated_at,
              (select name from users where id = apps.created_by) as created_by_name
         from apps
        where org_id = $1
        order by position asc, created_at desc`,
      [orgId]
    );
  } catch (err) {
    console.warn("Failed to query apps table, falling back to memory:", err);
    dbRows = inMemoryApps[orgId] || [];
  }

  // Filter out any hidden apps from dbRows just in case
  dbRows = dbRows.filter((a) => !hiddenSet.has(a.id));

  // 3. Check for unpersisted builtins
  const dbIds = new Set(dbRows.map((a) => a.id));
  let maxPos = dbRows.reduce((max, r) => Math.max(max, r.position ?? 0), -1);

  const unpersistedBuiltins: EmbeddedApp[] = [];
  for (const builtin of BUILTIN_APPS) {
    if (hiddenSet.has(builtin.id) || dbIds.has(builtin.id)) {
      continue;
    }
    maxPos += 1;
    unpersistedBuiltins.push({
      ...builtin,
      position: builtin.position ?? maxPos,
      is_builtin: true,
    });
  }

  // Combine and sort by position ascending
  const combined: EmbeddedApp[] = [...dbRows, ...unpersistedBuiltins].map((app) => ({
    ...app,
    is_builtin: Boolean(app.is_builtin || app.id.startsWith("builtin-")),
  }));

  combined.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return combined;
}

export async function getApp(orgId: string, id: string): Promise<EmbeddedApp | null> {
  await ensureTable();

  // Check if hidden
  try {
    const isHidden = await one<{ app_id: string }>(
      `select app_id from workspace_hidden_apps where org_id = $1 and app_id = $2`,
      [orgId, id]
    );
    if (isHidden) return null;
  } catch {
    if (inMemoryHidden[orgId]?.has(id)) return null;
  }

  // Check DB for workspace customized or custom app
  try {
    const row = await one<EmbeddedApp>(
      `select id, org_id, name, description, url, category, icon, display_mode, permissions,
              position, created_by, created_at, updated_at
         from apps
        where id = $1 and org_id = $2`,
      [id, orgId]
    );
    if (row) {
      return {
        ...row,
        is_builtin: Boolean(row.is_builtin || row.id.startsWith("builtin-")),
      };
    }
  } catch (err) {
    console.warn("Failed to get app from DB:", err);
  }

  // Check builtin template
  const builtin = BUILTIN_APPS.find((a) => a.id === id);
  if (builtin) return builtin;

  const memApp = (inMemoryApps[orgId] || []).find((a) => a.id === id);
  return memApp || null;
}

export async function getAppById(id: string): Promise<EmbeddedApp | null> {
  await ensureTable();
  try {
    const row = await one<EmbeddedApp>(
      `select id, org_id, name, description, url, category, icon, display_mode, permissions,
              position, created_by, created_at, updated_at
         from apps
        where id = $1 limit 1`,
      [id]
    );
    if (row) {
      return {
        ...row,
        is_builtin: Boolean(row.is_builtin || row.id.startsWith("builtin-")),
      };
    }
  } catch (err) {
    console.warn("Failed to get app by id from DB:", err);
  }

  const builtin = BUILTIN_APPS.find((a) => a.id === id);
  if (builtin) return builtin;

  for (const orgId in inMemoryApps) {
    const found = (inMemoryApps[orgId] || []).find((a) => a.id === id);
    if (found) return found;
  }
  return null;
}

export async function createApp(
  orgId: string,
  userId: string | null,
  data: {
    name: string;
    description?: string;
    url: string;
    category?: string;
    icon?: string;
    display_mode?: string;
    permissions?: string;
  }
): Promise<EmbeddedApp> {
  await ensureTable();

  const name = (data.name || "").trim();
  let url = (data.url || "").trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  const description = (data.description || "").trim();
  const category = data.category || "custom";
  const icon = data.icon || "globe";
  const display_mode = data.display_mode || "canvas";
  const permissions =
    data.permissions !== undefined && data.permissions !== ""
      ? data.permissions
      : "unrestricted";

  // Position at end of list
  let nextPos = 0;
  try {
    const posRow = await one<{ max_pos: number | null }>(
      `select max(position) as max_pos from apps where org_id = $1`,
      [orgId]
    );
    nextPos = (posRow?.max_pos ?? 0) + 1;
  } catch {
    nextPos = (inMemoryApps[orgId]?.length || 0) + BUILTIN_APPS.length;
  }

  try {
    const row = await one<EmbeddedApp>(
      `insert into apps (org_id, name, description, url, category, icon, display_mode, permissions, position, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id, org_id, name, description, url, category, icon, display_mode, permissions,
                 position, created_by, created_at, updated_at`,
      [orgId, name, description, url, category, icon, display_mode, permissions, nextPos, userId]
    );
    if (row) return row;
  } catch (err) {
    console.warn("Failed to insert app into DB, storing in memory:", err);
  }

  const fallbackApp: EmbeddedApp = {
    id: `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    org_id: orgId,
    name,
    description,
    url,
    category,
    icon,
    display_mode,
    permissions,
    position: nextPos,
    created_by: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (!inMemoryApps[orgId]) inMemoryApps[orgId] = [];
  inMemoryApps[orgId].unshift(fallbackApp);
  return fallbackApp;
}

export async function updateApp(
  orgId: string,
  id: string,
  data: Partial<EmbeddedApp>
): Promise<EmbeddedApp | null> {
  await ensureTable();

  // If app was hidden, unhide it
  try {
    await q(`delete from workspace_hidden_apps where org_id = $1 and app_id = $2`, [orgId, id]);
  } catch {
    inMemoryHidden[orgId]?.delete(id);
  }

  let url = data.url ? data.url.trim() : undefined;
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  // Check if app already exists in DB for this workspace
  try {
    const existing = await one<EmbeddedApp>(
      `select * from apps where id = $1 and org_id = $2`,
      [id, orgId]
    );

    if (existing) {
      const row = await one<EmbeddedApp>(
        `update apps
            set name = coalesce($1, name),
                description = coalesce($2, description),
                url = coalesce($3, url),
                category = coalesce($4, category),
                icon = coalesce($5, icon),
                display_mode = coalesce($6, display_mode),
                permissions = coalesce($7, permissions),
                position = coalesce($8, position),
                updated_at = now()
          where id = $9 and org_id = $10
          returning id, org_id, name, description, url, category, icon, display_mode, permissions,
                    position, created_by, created_at, updated_at`,
        [
          data.name?.trim() ?? null,
          data.description !== undefined ? data.description.trim() : null,
          url ?? null,
          data.category ?? null,
          data.icon ?? null,
          data.display_mode ?? null,
          data.permissions ?? null,
          data.position ?? null,
          id,
          orgId,
        ]
      );
      if (row) {
        return {
          ...row,
          is_builtin: Boolean(row.is_builtin || row.id.startsWith("builtin-")),
        };
      }
    } else {
      // First-time edit of a built-in application: upsert with builtin template defaults
      const template = BUILTIN_APPS.find((a) => a.id === id);
      const name = (data.name ?? template?.name ?? "Custom App").trim();
      const description = (data.description !== undefined ? data.description : template?.description ?? "").trim();
      const finalUrl = url ?? template?.url ?? "";
      const category = data.category ?? template?.category ?? "agent-ui";
      const icon = data.icon ?? template?.icon ?? "globe";
      const display_mode = data.display_mode ?? template?.display_mode ?? "canvas";
      const permissions = data.permissions ?? template?.permissions ?? "unrestricted";
      const position = data.position ?? template?.position ?? 0;

      const row = await one<EmbeddedApp>(
        `insert into apps (id, org_id, name, description, url, category, icon, display_mode, permissions, position)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (id, org_id) do update
           set name = excluded.name,
               description = excluded.description,
               url = excluded.url,
               category = excluded.category,
               icon = excluded.icon,
               display_mode = excluded.display_mode,
               permissions = excluded.permissions,
               position = excluded.position,
               updated_at = now()
         returning id, org_id, name, description, url, category, icon, display_mode, permissions,
                   position, created_by, created_at, updated_at`,
        [id, orgId, name, description, finalUrl, category, icon, display_mode, permissions, position]
      );
      if (row) {
        return {
          ...row,
          is_builtin: Boolean(row.is_builtin || row.id.startsWith("builtin-")),
        };
      }
    }
  } catch (err) {
    console.warn("Failed to update app in DB:", err);
  }

  // Memory fallback
  if (inMemoryApps[orgId]) {
    const idx = inMemoryApps[orgId].findIndex((a) => a.id === id);
    if (idx !== -1) {
      inMemoryApps[orgId][idx] = {
        ...inMemoryApps[orgId][idx],
        ...data,
        updated_at: new Date().toISOString(),
      };
      return inMemoryApps[orgId][idx];
    }
  }

  const builtin = BUILTIN_APPS.find((a) => a.id === id);
  if (builtin) {
    const updated = {
      ...builtin,
      ...data,
      org_id: orgId,
      updated_at: new Date().toISOString(),
    };
    if (!inMemoryApps[orgId]) inMemoryApps[orgId] = [];
    inMemoryApps[orgId].push(updated);
    return updated;
  }

  return null;
}

export async function deleteApp(orgId: string, id: string): Promise<boolean> {
  await ensureTable();

  const isBuiltin = id.startsWith("builtin-") || BUILTIN_APPS.some((b) => b.id === id);

  try {
    // Delete any custom/overridden row from apps
    await q(`delete from apps where id = $1 and org_id = $2`, [id, orgId]);

    // If it's a builtin template, add it to workspace_hidden_apps so it doesn't appear
    if (isBuiltin) {
      await q(
        `insert into workspace_hidden_apps (org_id, app_id)
         values ($1, $2)
         on conflict (org_id, app_id) do nothing`,
        [orgId, id]
      );
    }
    return true;
  } catch (err) {
    console.warn("Failed to delete app from DB:", err);
  }

  // Memory fallback
  if (inMemoryApps[orgId]) {
    inMemoryApps[orgId] = inMemoryApps[orgId].filter((a) => a.id !== id);
  }
  if (isBuiltin) {
    if (!inMemoryHidden[orgId]) inMemoryHidden[orgId] = new Set();
    inMemoryHidden[orgId].add(id);
  }

  return true;
}

export async function reorderApps(orgId: string, appIds: string[]): Promise<boolean> {
  await ensureTable();

  try {
    for (let index = 0; index < appIds.length; index++) {
      const appId = appIds[index];
      const template = BUILTIN_APPS.find((b) => b.id === appId);

      if (template) {
        // Upsert into apps to persist customized ordering for built-in app
        await q(
          `insert into apps (id, org_id, name, description, url, category, icon, display_mode, permissions, position)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           on conflict (id, org_id) do update set position = excluded.position, updated_at = now()`,
          [
            template.id,
            orgId,
            template.name,
            template.description,
            template.url,
            template.category,
            template.icon,
            template.display_mode,
            template.permissions,
            index,
          ]
        );
      } else {
        await q(
          `update apps set position = $1, updated_at = now() where id = $2 and org_id = $3`,
          [index, appId, orgId]
        );
      }
    }
    return true;
  } catch (err) {
    console.warn("Failed to reorder apps in DB:", err);
  }

  // Memory fallback
  if (inMemoryApps[orgId]) {
    const idMap = new Map(inMemoryApps[orgId].map((a) => [a.id, a]));
    const next: EmbeddedApp[] = [];
    appIds.forEach((id, i) => {
      const app = idMap.get(id);
      if (app) {
        app.position = i;
        next.push(app);
      }
    });
    inMemoryApps[orgId] = next;
  }

  return true;
}

export async function restoreDefaultApps(orgId: string): Promise<boolean> {
  await ensureTable();
  try {
    await q(`delete from workspace_hidden_apps where org_id = $1`, [orgId]);
    return true;
  } catch (err) {
    console.warn("Failed to restore default apps:", err);
  }

  if (inMemoryHidden[orgId]) {
    inMemoryHidden[orgId].clear();
  }
  return true;
}

export async function getHiddenAppsCount(orgId: string): Promise<number> {
  await ensureTable();
  try {
    const row = await one<{ count: number }>(
      `select count(*)::int as count from workspace_hidden_apps where org_id = $1`,
      [orgId]
    );
    return row?.count ?? 0;
  } catch {
    return inMemoryHidden[orgId]?.size ?? 0;
  }
}
