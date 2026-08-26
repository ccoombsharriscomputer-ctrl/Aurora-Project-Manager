import type { UserRole } from "@prisma/client";

// The Dashboard's customizable sections. Every widget here today happens to be open to every
// role — the Dashboard has never had an admin-only section — but the map exists as a real
// mechanism, not a placeholder: a future widget that needs narrower data (say, something
// Reports-only) declares that here and every consumer (this validation, the client's
// customize panel, the client's render filter) picks it up automatically.
export const DASHBOARD_WIDGET_KEYS = ["statTiles", "deadlines", "projectProgress", "recentActivity", "myTasks"] as const;

export type DashboardWidgetKey = (typeof DASHBOARD_WIDGET_KEYS)[number];

const ALL_ROLES: UserRole[] = ["ADMIN", "PROJECT_LEAD", "MEMBER", "READ_ONLY"];

export const DASHBOARD_WIDGET_ROLES: Record<DashboardWidgetKey, UserRole[]> = {
  statTiles: ALL_ROLES,
  deadlines: ALL_ROLES,
  projectProgress: ALL_ROLES,
  recentActivity: ALL_ROLES,
  myTasks: ALL_ROLES,
};

// The order every user starts with before they've customized anything, and what "reset to
// default" returns to.
export const DEFAULT_DASHBOARD_LAYOUT: DashboardWidgetKey[] = [...DASHBOARD_WIDGET_KEYS];

export function isDashboardWidgetKey(value: unknown): value is DashboardWidgetKey {
  return typeof value === "string" && (DASHBOARD_WIDGET_KEYS as readonly string[]).includes(value);
}

export function widgetAllowedForRole(key: DashboardWidgetKey, role: UserRole): boolean {
  return DASHBOARD_WIDGET_ROLES[key].includes(role);
}

// Drops anything that isn't a real widget key, and anything this role isn't allowed to see —
// the same filter runs both when a layout is saved (so a stored preference can never contain
// a widget the saver isn't allowed) and whenever one is read back (so a later role change, or
// a widget's permissions narrowing in a future release, can't leave a stale entry rendering).
export function sanitizeDashboardLayout(value: unknown, role: UserRole): DashboardWidgetKey[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<DashboardWidgetKey>();
  const result: DashboardWidgetKey[] = [];
  for (const item of value) {
    if (isDashboardWidgetKey(item) && widgetAllowedForRole(item, role) && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

// What actually renders: the user's saved layout if they have one (even an empty array — that
// means they deliberately hid everything), or the default set filtered to what their role can
// see if they've never customized.
export function effectiveDashboardLayout(saved: unknown, role: UserRole): DashboardWidgetKey[] {
  if (saved == null) {
    return DEFAULT_DASHBOARD_LAYOUT.filter((key) => widgetAllowedForRole(key, role));
  }
  return sanitizeDashboardLayout(saved, role);
}
