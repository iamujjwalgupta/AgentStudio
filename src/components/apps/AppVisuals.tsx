"use client";

/**
 * Shared look for embedded apps: line icons (in place of emoji), category
 * names and colours, and the three ways an app can be embedded, described in
 * plain words. Used by the Apps hub, the add/edit dialog and the viewer.
 */

export const APP_ICONS = ["globe", "bot", "sparkles", "chart", "terminal", "database", "layout", "shield"] as const;
export const ICON_LABEL: Record<string, string> = {
  globe: "Web app", bot: "Agent", sparkles: "AI", chart: "Dashboard", terminal: "API / console",
  database: "Data", layout: "Portal", shield: "Security",
};

export const CATEGORIES: { id: string; label: string; short: string; colour: string; bg: string }[] = [
  { id: "agent-ui", label: "Agent apps & playgrounds", short: "Agent app", colour: "#00338d", bg: "#e8eef9" },
  { id: "dashboard", label: "Dashboards & monitoring", short: "Dashboard", colour: "#007a78", bg: "#e3f5f5" },
  { id: "analytics", label: "Analytics & BI", short: "Analytics", colour: "#6d2077", bg: "#f3e9f5" },
  { id: "dev-tools", label: "Developer tools & APIs", short: "Developer tool", colour: "#1e49e2", bg: "#e9eefd" },
  { id: "docs", label: "Documents & knowledge", short: "Documents", colour: "#b36b00", bg: "#fff4e0" },
  { id: "custom", label: "Other apps", short: "Other", colour: "#516a92", bg: "#eef1f6" },
];
export const categoryOf = (id: string) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];

export type EmbedMode = "proxy" | "direct" | "sandboxed";
export const SANDBOX_DEFAULT =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-storage-access-by-user-activation allow-top-navigation-by-user-activation";
export const modeOf = (permissions: string | undefined | null): EmbedMode =>
  permissions === "proxy" ? "proxy" : permissions === "unrestricted" || !permissions ? "direct" : "sandboxed";
export const MODES: Record<EmbedMode, { label: string; short: string; body: string; when: string }> = {
  proxy: {
    label: "Via Agent Studio",
    short: "Proxied",
    body: "The app is loaded through Agent Studio, so its sign-in cookies count as this site's own.",
    when: "Best for apps with a login screen.",
  },
  direct: {
    label: "Direct",
    short: "Direct",
    body: "The app loads from its own address with full browser permissions.",
    when: "For public apps, or apps that allow being embedded elsewhere.",
  },
  sandboxed: {
    label: "Sandboxed",
    short: "Sandboxed",
    body: "The app loads from its own address with only the permissions listed in its sandbox flags.",
    when: "When you want to limit what the app may do in the page.",
  },
};

export function hostOf(url: string) {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).host;
  } catch {
    return url;
  }
}

export function AppGlyph({ icon, size = 18 }: { icon: string; size?: number }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (icon) {
    case "bot":
      return <svg {...p}><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5" /><circle cx="12" cy="3.5" r="1" /></svg>;
    case "sparkles":
      return <svg {...p}><path d="M11 3l1.6 4.4L17 9l-4.4 1.6L11 15l-1.6-4.4L5 9l4.4-1.6L11 3z" /><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z" /></svg>;
    case "chart":
      return <svg {...p}><path d="M4 20V4M4 20h16" /><rect x="7" y="12" width="3" height="5" rx=".6" /><rect x="12" y="8" width="3" height="9" rx=".6" /><rect x="17" y="5" width="3" height="12" rx=".6" /></svg>;
    case "terminal":
      return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M7 9l3 3-3 3M12.5 15H17" /></svg>;
    case "database":
      return <svg {...p}><ellipse cx="12" cy="5.5" rx="7" ry="2.5" /><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" /></svg>;
    case "layout":
      return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 9h18M9 9v11" /></svg>;
    case "shield":
      return <svg {...p}><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg>;
    default:
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></svg>;
  }
}

export function AppTile({ icon, category, size = 40 }: { icon: string; category: string; size?: number }) {
  const c = categoryOf(category);
  return (
    <span className="ap-tile" style={{ width: size, height: size, color: c.colour, background: c.bg }}>
      <AppGlyph icon={icon} size={Math.round(size * 0.5)} />
    </span>
  );
}
