import i18n from "../i18n";

export type ViewMode = "month" | "week" | "day";

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function startOfWeek(d: Date): Date {
  const start = startOfDay(d);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function buildMonthGridDays(cursor: Date): Date[] {
  const gridStart = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

export function buildWeekDays(cursor: Date): Date[] {
  const start = startOfWeek(cursor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

// The period a stat like "hours logged" should total for the active calendar view — the
// actual month/week/day being looked at, not the padded 42-cell grid the month view renders.
export function periodRange(view: ViewMode, cursor: Date): { start: Date; end: Date } {
  if (view === "month") {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }
  if (view === "week") {
    const start = startOfWeek(cursor);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  const start = startOfDay(cursor);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export const HOURS_LOGGED_TITLE_KEY: Record<ViewMode, string> = {
  day: "dashboard.loggedToday",
  week: "dashboard.loggedThisWeek",
  month: "dashboard.loggedThisMonth",
};

export function formatDateRangeLabel(start: Date, end: Date): string {
  if (toDateKey(start) === toDateKey(end)) {
    return start.toLocaleDateString(i18n.language, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  const startStr = start.toLocaleDateString(i18n.language, { month: "short", day: "numeric" });
  const endStr = end.toLocaleDateString(i18n.language, { month: "short", day: "numeric", year: "numeric" });
  return `${startStr} – ${endStr}`;
}
