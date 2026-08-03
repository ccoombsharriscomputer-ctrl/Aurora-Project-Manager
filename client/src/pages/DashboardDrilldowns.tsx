import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api } from "../api/client";
import type { Task, TaskStatus, TimeEntry } from "../api/types";
import { formatDate, formatDueDate, formatMinutes } from "../utils/format";

function statusLabel(t: TFunction, status: TaskStatus): string {
  if (status === "IN_PROGRESS") return t("common.statusInProgress");
  if (status === "DONE") return t("common.statusDone");
  if (status === "NA") return t("common.statusNA");
  return t("common.statusTodo");
}

function BackToDashboard() {
  const { t } = useTranslation();
  return (
    <p className="muted" style={{ margin: "0 0 4px" }}>
      <Link to="/dashboard">← {t("layout.dashboard")}</Link>
    </p>
  );
}

type SortKey = "task" | "project" | "status" | "assignee" | "date";
type SortState = { key: SortKey; direction: "asc" | "desc" };

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState | null;
  onSort: (key: SortKey) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
    >
      {label}
      {active && <span style={{ marginLeft: 4 }}>{sort!.direction === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

function TaskDrilldownTable({ tasks, showDueDate }: { tasks: Task[]; showDueDate: boolean }) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<SortState | null>(null);

  function handleSort(key: SortKey) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, direction: "asc" };
      return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
    });
  }

  const sortedTasks = useMemo(() => {
    if (!sort) return tasks;
    const dir = sort.direction === "asc" ? 1 : -1;

    function value(task: Task): string | number {
      switch (sort!.key) {
        case "task":
          return task.title.toLowerCase();
        case "project":
          return (task.project?.name ?? "").toLowerCase();
        case "status":
          return statusLabel(t, task.status).toLowerCase();
        case "assignee":
          return (task.assignee?.name ?? "").toLowerCase();
        case "date": {
          const iso = showDueDate ? task.dueDate : task.completedAt;
          return iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY;
        }
      }
    }

    return [...tasks].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av === bv) return 0;
      return av < bv ? -1 * dir : 1 * dir;
    });
  }, [tasks, sort, showDueDate, t]);

  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <SortableHeader label={t("dashboard.task")} sortKey="task" sort={sort} onSort={handleSort} />
            <SortableHeader label={t("reports.project")} sortKey="project" sort={sort} onSort={handleSort} />
            <SortableHeader label={t("common.status")} sortKey="status" sort={sort} onSort={handleSort} />
            <SortableHeader
              label={t("subProjectDetail.assignee")}
              sortKey="assignee"
              sort={sort}
              onSort={handleSort}
            />
            <SortableHeader
              label={showDueDate ? t("subProjectDetail.dueDate") : t("reports.completedDate")}
              sortKey="date"
              sort={sort}
              onSort={handleSort}
            />
          </tr>
        </thead>
        <tbody>
          {sortedTasks.map((task) => (
            <tr key={task.id}>
              <td>
                <Link to={`/tasks/${task.id}`}>{task.title}</Link>
              </td>
              <td>{task.project ? <Link to={`/projects/${task.project.id}`}>{task.project.name}</Link> : "—"}</td>
              <td>{statusLabel(t, task.status)}</td>
              <td>{task.assignee?.name ?? t("subProjectDetail.unassigned")}</td>
              <td>{showDueDate ? formatDueDate(task.dueDate) : formatDate(task.completedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CompletedThisWeekPage() {
  const { t } = useTranslation();
  const { data: tasks, isLoading } = useQuery({
    queryKey: ["dashboard-completed-this-week"],
    queryFn: () => api.get<Task[]>("/dashboard/completed-this-week"),
  });

  return (
    <div>
      <BackToDashboard />
      <div className="page-header">
        <h1>{t("dashboard.completedThisWeek")}</h1>
      </div>
      {isLoading && <p className="muted">{t("common.loading")}</p>}
      {!isLoading && tasks?.length === 0 && <p className="muted">{t("dashboard.noCompletedThisWeek")}</p>}
      {!isLoading && tasks && tasks.length > 0 && <TaskDrilldownTable tasks={tasks} showDueDate={false} />}
    </div>
  );
}

export function TimeEntriesThisWeekPage() {
  const { t } = useTranslation();
  const { data: entries, isLoading } = useQuery({
    queryKey: ["dashboard-time-entries-this-week"],
    queryFn: () => api.get<TimeEntry[]>("/dashboard/time-entries-this-week"),
  });

  return (
    <div>
      <BackToDashboard />
      <div className="page-header">
        <h1>{t("dashboard.loggedThisWeek")}</h1>
      </div>
      {isLoading && <p className="muted">{t("common.loading")}</p>}
      {!isLoading && entries?.length === 0 && <p className="muted">{t("dashboard.noHoursLoggedThisWeek")}</p>}
      {!isLoading && entries && entries.length > 0 && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>{t("dashboard.task")}</th>
                <th>{t("reports.project")}</th>
                <th>{t("dashboard.user")}</th>
                <th>{t("dashboard.date")}</th>
                <th>{t("dashboard.hours")}</th>
                <th>{t("dashboard.note")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.task ? <Link to={`/tasks/${entry.task.id}`}>{entry.task.title}</Link> : "—"}</td>
                  <td>
                    {entry.task?.project ? (
                      <Link to={`/projects/${entry.task.project.id}`}>{entry.task.project.name}</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{entry.user.name}</td>
                  <td>{formatDate(entry.startedAt)}</td>
                  <td>{formatMinutes(entry.durationMinutes)}</td>
                  <td className="muted">{entry.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
