import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation, type TFunction } from "react-i18next";
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

function TaskDrilldownTable({ tasks, showDueDate }: { tasks: Task[]; showDueDate: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>{t("dashboard.task")}</th>
            <th>{t("reports.project")}</th>
            <th>{t("common.status")}</th>
            <th>{t("subProjectDetail.assignee")}</th>
            <th>{showDueDate ? t("subProjectDetail.dueDate") : t("reports.completedDate")}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
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

export function OpenTasksPage() {
  const { t } = useTranslation();
  const { data: tasks, isLoading } = useQuery({
    queryKey: ["dashboard-open-tasks"],
    queryFn: () => api.get<Task[]>("/dashboard/open-tasks"),
  });

  return (
    <div>
      <BackToDashboard />
      <div className="page-header">
        <h1>{t("dashboard.openTasks")}</h1>
      </div>
      {isLoading && <p className="muted">{t("common.loading")}</p>}
      {!isLoading && tasks?.length === 0 && <p className="muted">{t("dashboard.noOpenTasks")}</p>}
      {!isLoading && tasks && tasks.length > 0 && <TaskDrilldownTable tasks={tasks} showDueDate />}
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
