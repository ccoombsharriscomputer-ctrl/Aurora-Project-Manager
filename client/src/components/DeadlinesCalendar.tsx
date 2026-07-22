import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { api } from "../api/client";
import type { Task } from "../api/types";

type ViewMode = "month" | "week" | "day";

const VISIBLE_TASKS_PER_DAY = 4;

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Due dates are entered as a plain calendar date and stored as UTC midnight, so they must
// be read back with UTC getters — otherwise a negative-offset browser timezone (e.g.
// US/Canada) buckets the task under the previous day.
function dueDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfWeek(d: Date): Date {
  const start = startOfDay(d);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function buildMonthGridDays(cursor: Date): Date[] {
  const gridStart = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

function buildWeekDays(cursor: Date): Date[] {
  const start = startOfWeek(cursor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function priorityLabel(t: (key: string) => string, priority: Task["priority"]): string {
  if (priority === "HIGH") return t("common.priorityHigh");
  if (priority === "MEDIUM") return t("common.priorityMedium");
  return t("common.priorityLow");
}

function TaskPill({ task }: { task: Task }) {
  return (
    <Link
      to={`/tasks/${task.id}`}
      className={`calendar-task-pill priority-${task.priority}`}
      title={task.project?.name ? `${task.project.name} — ${task.title}` : task.title}
    >
      {task.title}
    </Link>
  );
}

export function DeadlinesCalendar() {
  const { t } = useTranslation();
  const [view, setView] = useState<ViewMode>("week");
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));

  const days = useMemo(() => {
    if (view === "month") return buildMonthGridDays(cursor);
    if (view === "week") return buildWeekDays(cursor);
    return [cursor];
  }, [view, cursor]);

  const startKey = toDateKey(days[0]);
  const endKey = toDateKey(days[days.length - 1]);

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["calendar", startKey, endKey],
    queryFn: () => api.get<Task[]>(`/calendar?start=${startKey}&end=${endKey}`),
  });

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks ?? []) {
      if (!task.dueDate) continue;
      const key = dueDateKey(task.dueDate);
      const list = map.get(key);
      if (list) list.push(task);
      else map.set(key, [task]);
    }
    return map;
  }, [tasks]);

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
    setCursor((c) => {
      const next = new Date(c);
      if (view === "month") next.setMonth(next.getMonth() + amount);
      else if (view === "week") next.setDate(next.getDate() + amount * 7);
      else next.setDate(next.getDate() + amount);
      return next;
    });
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
                onClick={() => setView(v)}
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
          <button className="btn btn-sm" onClick={() => setCursor(startOfDay(new Date()))}>
            {t("calendar.today")}
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="muted">{t("calendar.loadingCalendar")}</p>
      ) : view === "day" ? (
        <div className="calendar-day-list">
          {(tasksByDay.get(toDateKey(cursor)) ?? []).map((task) => (
            <div className="calendar-day-list-item" key={task.id}>
              <span className={`badge priority-${task.priority}`}>{priorityLabel(t, task.priority)}</span>
              <Link to={`/tasks/${task.id}`}>{task.title}</Link>
              {task.project?.name && <span className="muted">{task.project.name}</span>}
            </div>
          ))}
          {(tasksByDay.get(toDateKey(cursor)) ?? []).length === 0 && (
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
              const dayTasks = tasksByDay.get(key) ?? [];
              const cap = view === "week" ? undefined : VISIBLE_TASKS_PER_DAY;
              const visible = cap ? dayTasks.slice(0, cap) : dayTasks;
              const hiddenCount = dayTasks.length - visible.length;
              const isOutside = view === "month" && day.getMonth() !== cursor.getMonth();
              const isToday = key === todayKey;
              return (
                <div className={`calendar-day${isOutside ? " outside" : ""}${view === "week" ? " week-cell" : ""}`} key={key}>
                  <div className={`calendar-day-number${isToday ? " today" : ""}`}>{day.getDate()}</div>
                  <div className="calendar-day-tasks">
                    {visible.map((task) => (
                      <TaskPill task={task} key={task.id} />
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
