/**
 * Deterministic date formatting.
 *
 * A client component is rendered twice: once on the server to produce the HTML,
 * then again in the browser to hydrate it. `toLocaleString()` without an
 * explicit locale and timezone reads them from the environment, so Node formats
 * with the server's settings and the browser with the viewer's — the two
 * disagree and React fails hydration with "Text content does not match".
 *
 * Pinning both makes the output identical wherever it runs. Times are shown in
 * the workspace timezone, which is also the timezone its schedules fire in.
 */

const LOCALE = "en-GB";

const opts = (tz: string, extra: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => ({
  timeZone: tz || "UTC",
  hour12: false,
  ...extra,
});

/** "31 Aug 2026, 13:30" */
export function formatDateTime(value: string | Date | null | undefined, tz = "UTC"): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(
    LOCALE,
    opts(tz, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  ).format(d);
}

/** "31 Aug 2026" */
export function formatDate(value: string | Date | null | undefined, tz = "UTC"): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE, opts(tz, { day: "2-digit", month: "short", year: "numeric" })).format(d);
}

/** "Mon 31 Aug, 13:30" — for a firing that is still ahead. */
export function formatWhen(value: string | Date | null | undefined, tz = "UTC"): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(
    LOCALE,
    opts(tz, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
  ).format(d);
}
