import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { api } from "../api/client";
import type { Task } from "../api/types";

const VISIBLE_TASKS_PER_DAY = 4;

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildGridDays(monthCursor: Date): Date[] {
  const firstOfMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

export function CalendarPage() {
  const { t } = useTranslation();
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const days = useMemo(() => buildGridDays(monthCursor), [monthCursor]);
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
      const key = toDateKey(new Date(task.dueDate));
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

  const monthLabel = monthCursor.toLocaleDateString(i18n.language, { month: "long", year: "numeric" });
  const todayKey = toDateKey(new Date());

  return (
    <div>
      <div className="page-header">
        <h1>{t("layout.calendar")}</h1>
        <div className="gap-8">
          <button className="btn btn-sm" onClick={() => setMonthCursor((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>
            ‹
          </button>
          <div className="calendar-month-label">{monthLabel}</div>
          <button className="btn btn-sm" onClick={() => setMonthCursor((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>
            ›
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              const now = new Date();
              setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
          >
            {t("calendar.today")}
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="muted">{t("calendar.loadingCalendar")}</p>
      ) : (
        <div className="calendar-scroll">
          <div className="calendar-grid">
            {weekdayLabels.map((label) => (
              <div className="calendar-weekday" key={label}>
                {label}
              </div>
            ))}
            {days.map((day) => {
              const key = toDateKey(day);
              const dayTasks = tasksByDay.get(key) ?? [];
              const visible = dayTasks.slice(0, VISIBLE_TASKS_PER_DAY);
              const hiddenCount = dayTasks.length - visible.length;
              const isOutside = day.getMonth() !== monthCursor.getMonth();
              const isToday = key === todayKey;
              return (
                <div className={`calendar-day${isOutside ? " outside" : ""}`} key={key}>
                  <div className={`calendar-day-number${isToday ? " today" : ""}`}>{day.getDate()}</div>
                  <div className="calendar-day-tasks">
                    {visible.map((task) => (
                      <Link
                        key={task.id}
                        to={`/tasks/${task.id}`}
                        className={`calendar-task-pill priority-${task.priority}`}
                        title={task.project?.name ? `${task.project.name} — ${task.title}` : task.title}
                      >
                        {task.title}
                      </Link>
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
