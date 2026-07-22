import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { DashboardSummary } from "../api/types";
import { formatDate, formatElapsed, formatRelativeTime } from "../utils/format";
import { useActiveTimer } from "../hooks/useActiveTimer";

function TimerBanner() {
  const { t } = useTranslation();
  const { activeTimer, stop } = useActiveTimer();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!activeTimer) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [activeTimer]);

  if (!activeTimer || !activeTimer.task) return null;

  return (
    <div className="timer-banner">
      <span>
        {t("dashboard.timerRunningOn")}{" "}
        <Link to={`/projects/${activeTimer.task.project.id}/tasks/${activeTimer.taskId}`} style={{ color: "white", textDecoration: "underline" }}>
          {activeTimer.task.title}
        </Link>{" "}
        · {formatElapsed(activeTimer.startedAt)}
      </span>
      <button className="btn btn-sm" onClick={() => stop.mutate(activeTimer.id)} disabled={stop.isPending}>
        {t("dashboard.stop")}
      </button>
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardSummary>("/dashboard/summary"),
    refetchInterval: 15000,
  });

  if (isLoading || !data) {
    return <div className="muted">{t("dashboard.loadingDashboard")}</div>;
  }

  const { statusBreakdown } = data;

  return (
    <div>
      <div className="page-header">
        <h1>{t("layout.dashboard")}</h1>
      </div>

      <TimerBanner />

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="value">{data.totalProjects}</div>
          <div className="label">{t("dashboard.totalProjects")}</div>
        </div>
        <div className="stat-tile">
          <div className="value">{data.totalOpenTasks}</div>
          <div className="label">{t("dashboard.openTasks")}</div>
        </div>
        <div className="stat-tile">
          <div className="value">{data.tasksCompletedThisWeek}</div>
          <div className="label">{t("dashboard.completedThisWeek")}</div>
        </div>
        <div className="stat-tile">
          <div className="value">{data.hoursLoggedThisWeek}h</div>
          <div className="label">{t("dashboard.loggedThisWeek")}</div>
        </div>
      </div>

      <div className="status-breakdown">
        <div className="status-pill todo">
          <div className="count">{statusBreakdown.TODO}</div>
          <div className="label">{t("common.statusTodo")}</div>
        </div>
        <div className="status-pill in-progress">
          <div className="count">{statusBreakdown.IN_PROGRESS}</div>
          <div className="label">{t("common.statusInProgress")}</div>
        </div>
        <div className="status-pill done">
          <div className="count">{statusBreakdown.DONE}</div>
          <div className="label">{t("common.statusDone")}</div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="section-title">{t("dashboard.projectProgress")}</div>
            {data.projectProgress.length === 0 && <p className="muted">{t("dashboard.noProjectsYet")}</p>}
            {data.projectProgress.map((p) => (
              <div className="progress-row" key={p.id}>
                <div className="progress-row-top">
                  <Link to={`/projects/${p.id}`}>{p.name}</Link>
                  <span className="muted">
                    {t("dashboard.tasksCount", { done: p.doneTasks, total: p.totalTasks })} · {p.percent}%
                  </span>
                </div>
                <div className="progress-bar-track">
                  <div className="progress-bar-fill" style={{ width: `${p.percent}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="section-title">{t("dashboard.recentActivity")}</div>
            {data.recentActivity.length === 0 && <p className="muted">{t("dashboard.noActivityYet")}</p>}
            <ul className="activity-list">
              {data.recentActivity.map((a) => (
                <li className="activity-item" key={a.id}>
                  <div>{a.message}</div>
                  <div className="meta">{formatRelativeTime(a.createdAt)}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="section-title">{t("dashboard.myTasks")}</div>
          {data.myTasks.length === 0 && <p className="muted">{t("dashboard.nothingAssigned")}</p>}
          {data.myTasks.map((t) => (
            <div className="task-list-item" key={t.id}>
              <Link to={`/projects/${t.projectId}/tasks/${t.id}`}>{t.title}</Link>
              <span className="muted">{formatDate(t.dueDate)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
