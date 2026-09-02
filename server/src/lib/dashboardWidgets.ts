import type { UserRole } from "@prisma/client";

// The Dashboard's customizable sections. Every widget here today happens to be open to every
// role — the Dashboard has never had an admin-only section — but the map exists as a real
// mechanism, not a placeholder: a future widget that needs narrower data (say, something
// Reports-only) declares that here and every consumer (this validation, the client's
// customize panel, the client's render filter) picks it up automatically.
//
// The 3 stat tiles used to be one fused "statTiles" widget; they're now independently
// sizeable/orderable entries, since sizing only makes sense per-tile. See migrateLegacyEntry
// below for how an old saved "statTiles" entry is expanded into these three on read.
export const DASHBOARD_WIDGET_KEYS = [
  "totalProjects",
  "completedThisWeek",
  "hoursLogged",
  "deadlines",
  "projectProgress",
  "recentActivity",
  "myTasks",
  "myProjects",
] as const;

export type DashboardWidgetKey = (typeof DASHBOARD_WIDGET_KEYS)[number];

// Width via CSS grid-column span (see index.css) and, for the list-style widgets, how many
// items show before "Show more" — see effectiveCollapsedCount below. S/M don't mean anything
// different from each other for the calendar widget today (see DashboardPage.tsx), only width.
export const DASHBOARD_WIDGET_SIZES = ["S", "M", "L"] as const;
export type DashboardWidgetSize = (typeof DASHBOARD_WIDGET_SIZES)[number];

export interface DashboardWidgetEntry {
  key: DashboardWidgetKey;
  size: DashboardWidgetSize;
}

const ALL_ROLES: UserRole[] = ["ADMIN", "PROJECT_LEAD", "MEMBER", "READ_ONLY"];

export const DASHBOARD_WIDGET_ROLES: Record<DashboardWidgetKey, UserRole[]> = {
  totalProjects: ALL_ROLES,
  completedThisWeek: ALL_ROLES,
  hoursLogged: ALL_ROLES,
  deadlines: ALL_ROLES,
  projectProgress: ALL_ROLES,
  recentActivity: ALL_ROLES,
  myTasks: ALL_ROLES,
  myProjects: ALL_ROLES,
};

// The order (and sizes) every user starts with before they've customized anything, and what
// "reset to default" returns to — the 3 stat tiles small (three to a row), everything else
// full width, matching how the Dashboard looked before it became customizable at all.
export const DEFAULT_DASHBOARD_LAYOUT: DashboardWidgetEntry[] = [
  { key: "totalProjects", size: "S" },
  { key: "completedThisWeek", size: "S" },
  { key: "hoursLogged", size: "S" },
  { key: "deadlines", size: "L" },
  { key: "projectProgress", size: "L" },
  { key: "recentActivity", size: "L" },
  { key: "myTasks", size: "L" },
  { key: "myProjects", size: "L" },
];

// How many items a list-style widget (projectProgress/recentActivity/myTasks/myProjects)
// shows before "Show more", by size.
export const COLLAPSED_COUNT_BY_SIZE: Record<DashboardWidgetSize, number> = { S: 1, M: 2, L: 5 };

export function isDashboardWidgetKey(value: unknown): value is DashboardWidgetKey {
  return typeof value === "string" && (DASHBOARD_WIDGET_KEYS as readonly string[]).includes(value);
}

function isDashboardWidgetSize(value: unknown): value is DashboardWidgetSize {
  return typeof value === "string" && (DASHBOARD_WIDGET_SIZES as readonly string[]).includes(value);
}

export function widgetAllowedForRole(key: DashboardWidgetKey, role: UserRole): boolean {
  return DASHBOARD_WIDGET_ROLES[key].includes(role);
}

// Before widgets had a size, a saved layout was just an ordered array of key strings, and the
// 3 stat tiles were one "statTiles" entry. Reads of an old-shaped value need to keep working
// (a user who customized in the few minutes between that release and this one shouldn't lose
// their layout) — this turns one old-format item into one or more new-format entries.
function migrateLegacyEntry(item: unknown): DashboardWidgetEntry[] {
  if (item === "statTiles") {
    return [
      { key: "totalProjects", size: "S" },
      { key: "completedThisWeek", size: "S" },
      { key: "hoursLogged", size: "S" },
    ];
  }
  if (isDashboardWidgetKey(item)) {
    return [{ key: item, size: "M" }];
  }
  return [];
}

// Drops anything that isn't a real widget key, any size that isn't S/M/L (defaulting to M),
// and anything this role isn't allowed to see — the same filter runs both when a layout is
// saved (so a stored preference can never contain a widget the saver isn't allowed) and
// whenever one is read back (so a later role change, or a widget's permissions narrowing in a
// future release, can't leave a stale entry rendering). Also transparently upgrades the old
// plain-string-array shape (see migrateLegacyEntry) so it keeps working after this change.
export function sanitizeDashboardLayout(value: unknown, role: UserRole): DashboardWidgetEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<DashboardWidgetKey>();
  const result: DashboardWidgetEntry[] = [];
  for (const item of value) {
    const candidates: DashboardWidgetEntry[] =
      item && typeof item === "object" && "key" in item
        ? [
            {
              key: (item as { key: unknown }).key as DashboardWidgetKey,
              size: isDashboardWidgetSize((item as { size?: unknown }).size) ? (item as { size: DashboardWidgetSize }).size : "M",
            },
          ]
        : migrateLegacyEntry(item);

    for (const candidate of candidates) {
      if (isDashboardWidgetKey(candidate.key) && widgetAllowedForRole(candidate.key, role) && !seen.has(candidate.key)) {
        seen.add(candidate.key);
        result.push(candidate);
      }
    }
  }
  return result;
}

// What actually renders: the user's saved layout if they have one (even an empty array — that
// means they deliberately hid everything), or the default set filtered to what their role can
// see if they've never customized.
export function effectiveDashboardLayout(saved: unknown, role: UserRole): DashboardWidgetEntry[] {
  if (saved == null) {
    return DEFAULT_DASHBOARD_LAYOUT.filter((entry) => widgetAllowedForRole(entry.key, role));
  }
  return sanitizeDashboardLayout(saved, role);
}
