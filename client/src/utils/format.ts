import i18n from "../i18n";

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return i18n.t("common.justNow");
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return i18n.t("common.minutesAgo", { count: diffMin });
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return i18n.t("common.hoursAgo", { count: diffHr });
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return i18n.t("common.daysAgo", { count: diffDay });
  return new Date(iso).toLocaleDateString(i18n.language);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(i18n.language);
}

// Due dates are entered as a plain calendar date (no time-of-day) and stored as UTC
// midnight, so they must be read back with timeZone: "UTC" — otherwise a negative-offset
// browser timezone (e.g. US/Canada) renders them one day early.
export function formatDueDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(i18n.language, { timeZone: "UTC" });
}

export function formatMinutes(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function formatElapsed(startedAt: string): string {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
