import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { api } from "../api/client";
import type { CalendarResponse, FollowUpItem, Task } from "../api/types";
import { buildMonthGridDays, buildWeekDays, startOfDay, toDateKey, type ViewMode } from "../utils/calendarPeriod";

const VISIBLE_TASKS_PER_DAY = 4;

// A follow-up is a calendar reminder, not a task — it carries no priority/status of its own,
// so it's kept as its own entry kind rather than shoehorned into the Task shape.
type CalendarEntry = ({ kind: "task" } & Task) | ({ kind: "followUp" } & FollowUpItem);

// Due dates are entered as a plain calendar date and stored as UTC midnight, so they must
// be read back with UTC getters — otherwise a negative-offset browser timezone (e.g.
// US/Canada) buckets the task under the previous day.
function dueDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function priorityLabel(t: (key: string) => string, priority: Task["priority"]): string {
  if (priority === "HIGH") return t("common.priorityHigh");
  if (priority === "MEDIUM") return t("common.priorityMedium");
  return t("common.priorityLow");
}

function statusLabel(t: (key: string) => string, status: Task["status"]): string {
  if (status === "IN_PROGRESS") return t("common.statusInProgress");
  if (status === "DONE") return t("common.statusDone");
  if (status === "NA") return t("common.statusNA");
  return t("common.statusTodo");
}

// Open tasks are colored by priority, since that's what's actionable about them. Once a
// task is resolved (done or N/A), priority no longer matters — its own status is the more
// useful signal for a calendar that also shows past days.
function pillClassName(task: Task): string {
  if (task.status === "DONE") return "calendar-task-pill done";
  if (task.status === "NA") return "calendar-task-pill na";
  return `calendar-task-pill priority-${task.priority}`;
}

function EntryPill({ entry }: { entry: CalendarEntry }) {
  const { t } = useTranslation();
  if (entry.kind === "followUp") {
    return (
      <Link
        to={`/tasks/${entry.taskId}`}
        className="calendar-task-pill follow-up"
        title={entry.project?.name ? `${entry.project.name} — ${entry.taskTitle}` : entry.taskTitle}
      >
        {t("calendar.followUp")}
      </Link>
    );
  }
  return (
    <Link
      to={`/tasks/${entry.id}`}
      className={pillClassName(entry)}
      title={entry.project?.name ? `${entry.project.name} — ${entry.title}` : entry.title}
    >
      {entry.title}
    </Link>
  );
}

export function DeadlinesCalendar({
  view,
  cursor,
  onViewChange,
  onCursorChange,
}: {
  view: ViewMode;
  cursor: Date;
  onViewChange: (view: ViewMode) => void;
  onCursorChange: (cursor: Date) => void;
}) {
  const { t } = useTranslation();

  const days = useMemo(() => {
    if (view === "month") return buildMonthGridDays(cursor);
    if (view === "week") return buildWeekDays(cursor);
    return [cursor];
  }, [view, cursor]);

  const startKey = toDateKey(days[0]);
  const endKey = toDateKey(days[days.length - 1]);

  const { data, isLoading } = useQuery({
    queryKey: ["calendar", startKey, endKey],
    queryFn: () => api.get<CalendarResponse>(`/calendar?start=${startKey}&end=${endKey}`),
  });

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    function add(key: string, entry: CalendarEntry) {
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    for (const task of data?.tasks ?? []) {
      if (!task.dueDate) continue;
      add(dueDateKey(task.dueDate), { kind: "task", ...task });
    }
    for (const followUp of data?.followUps ?? []) {
      add(dueDateKey(followUp.dueDate), { kind: "followUp", ...followUp });
    }
    return map;
  }, [data]);

  const weekdayLabels = useMemo(() => {
    const sunday = new Date(2024, 0, 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      return d.toLocaleDateString(i18n.language, { weekday: "short" });
    });
  }, [i18n.language]);

  const label = useMemo(() => {
    if (view === "month") return cursor.toLocaleDateString(i18n.language, { month: "long", year: "numeric" });
    if (view === "day") {
      return cursor.toLocaleDateString(i18n.language, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    }
    const start = days[0];
    const end = days[days.length - 1];
    const startStr = start.toLocaleDateString(i18n.language, { month: "short", day: "numeric" });
    const endStr = end.toLocaleDateString(i18n.language, { month: "short", day: "numeric", year: "numeric" });
    return `${startStr} – ${endStr}`;
  }, [view, cursor, days, i18n.language]);

  function shift(amount: number) {
    const next = new Date(cursor);
    if (view === "month") next.setMonth(next.getMonth() + amount);
    else if (view === "week") next.setDate(next.getDate() + amount * 7);
    else next.setDate(next.getDate() + amount);
    onCursorChange(next);
  }

  const todayKey = toDateKey(new Date());

  return (
    <div className="card">
      <div className="calendar-toolbar">
        <div className="section-title" style={{ marginBottom: 0 }}>
          {t("calendar.title")}
        </div>
        <div className="gap-8">
          <div className="calendar-view-toggle">
            {(["month", "week", "day"] as ViewMode[]).map((v) => (
              <button
                key={v}
                className={`btn btn-sm${view === v ? " btn-primary" : ""}`}
                onClick={() => onViewChange(v)}
              >
                {t(`calendar.${v}`)}
              </button>
            ))}
          </div>
          <button className="btn btn-sm" onClick={() => shift(-1)}>
            ‹
          </button>
          <div className="calendar-label">{label}</div>
          <button className="btn btn-sm" onClick={() => shift(1)}>
            ›
          </button>
          <button className="btn btn-sm" onClick={() => onCursorChange(startOfDay(new Date()))}>
            {t("calendar.today")}
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="muted">{t("calendar.loadingCalendar")}</p>
      ) : view === "day" ? (
        <div className="calendar-day-list">
          {(entriesByDay.get(toDateKey(cursor)) ?? []).map((entry) =>
            entry.kind === "followUp" ? (
              <div className="calendar-day-list-item" key={`followup-${entry.id}`}>
                <span className="badge badge-admin">{t("calendar.followUp")}</span>
                <Link to={`/tasks/${entry.taskId}`}>{entry.taskTitle}</Link>
                {entry.project?.name && <span className="muted">{entry.project.name}</span>}
              </div>
            ) : (
              <div className="calendar-day-list-item" key={entry.id}>
                <span className={`badge priority-${entry.priority}`}>{priorityLabel(t, entry.priority)}</span>
                {(entry.status === "DONE" || entry.status === "NA") && (
                  <span className="badge">{statusLabel(t, entry.status)}</span>
                )}
                <Link to={`/tasks/${entry.id}`} className={entry.status === "DONE" ? "calendar-resolved-text" : entry.status === "NA" ? "calendar-na-text" : undefined}>
                  {entry.title}
                </Link>
                {entry.project?.name && <span className="muted">{entry.project.name}</span>}
              </div>
            )
          )}
          {(entriesByDay.get(toDateKey(cursor)) ?? []).length === 0 && (
            <p className="muted">{t("calendar.noDeadlines")}</p>
          )}
        </div>
      ) : (
        <div className="calendar-scroll">
          <div className="calendar-grid">
            {weekdayLabels.map((wd) => (
              <div className="calendar-weekday" key={wd}>
                {wd}
              </div>
            ))}
            {days.map((day) => {
              const key = toDateKey(day);
              const dayEntries = entriesByDay.get(key) ?? [];
              const cap = view === "week" ? undefined : VISIBLE_TASKS_PER_DAY;
              const visible = cap ? dayEntries.slice(0, cap) : dayEntries;
              const hiddenCount = dayEntries.length - visible.length;
              const isOutside = view === "month" && day.getMonth() !== cursor.getMonth();
              const isToday = key === todayKey;
              return (
                <div className={`calendar-day${isOutside ? " outside" : ""}${view === "week" ? " week-cell" : ""}`} key={key}>
                  <div className={`calendar-day-number${isToday ? " today" : ""}`}>{day.getDate()}</div>
                  <div className="calendar-day-tasks">
                    {visible.map((entry) => (
                      <EntryPill entry={entry} key={entry.kind === "followUp" ? `followup-${entry.id}` : entry.id} />
                    ))}
                    {hiddenCount > 0 && (
                      <span className="calendar-more muted">{t("calendar.moreCount", { count: hiddenCount })}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
