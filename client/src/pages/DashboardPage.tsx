import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { Activity, DashboardSummary } from "../api/types";
import { formatDueDate, formatElapsed, formatRelativeTime } from "../utils/format";
import { useActiveTimer } from "../hooks/useActiveTimer";
import { DeadlinesCalendar } from "../components/DeadlinesCalendar";

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
        <Link to={`/tasks/${activeTimer.taskId}`} style={{ color: "white", textDecoration: "underline" }}>
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

const COLLAPSED_COUNT = 2;

function RecentActivity({ activities }: { activities: Activity[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? activities : activities.slice(0, COLLAPSED_COUNT);

  return (
    <div className="card">
      <div className="flex-between">
        <div className="section-title" style={{ marginBottom: 0 }}>
          {t("dashboard.recentActivity")}
        </div>
        {activities.length > COLLAPSED_COUNT && (
          <button className="btn btn-sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t("dashboard.showLess") : t("dashboard.showMore")}
          </button>
        )}
      </div>
      {activities.length === 0 && <p className="muted">{t("dashboard.noActivityYet")}</p>}
      <ul className="activity-list">
        {visible.map((a) => (
          <li className="activity-item" key={a.id}>
            <div>{a.message}</div>
            <div className="meta">{formatRelativeTime(a.createdAt)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectProgress({ projects }: { projects: DashboardSummary["projectProgress"] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? projects : projects.slice(0, COLLAPSED_COUNT);

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="flex-between">
        <div className="section-title" style={{ marginBottom: 0 }}>
          {t("dashboard.projectProgress")}
        </div>
        {projects.length > COLLAPSED_COUNT && (
          <button className="btn btn-sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t("dashboard.showLess") : t("dashboard.showMore")}
          </button>
        )}
      </div>
      {projects.length === 0 && <p className="muted">{t("dashboard.noProjectsYet")}</p>}
      {visible.map((p) => (
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

  return (
    <div>
      <div className="page-header">
        <h1>{t("layout.dashboard")}</h1>
      </div>

      <TimerBanner />

      <div className="stat-grid">
        <Link to="/projects" className="stat-tile">
          <div className="value">{data.totalProjects}</div>
          <div className="label">{t("dashboard.totalProjects")}</div>
        </Link>
        <Link to="/dashboard/open-tasks" className="stat-tile">
          <div className="value">{data.totalOpenTasks}</div>
          <div className="label">{t("dashboard.openTasks")}</div>
        </Link>
        <Link to="/dashboard/completed-this-week" className="stat-tile">
          <div className="value">{data.tasksCompletedThisWeek}</div>
          <div className="label">{t("dashboard.completedThisWeek")}</div>
        </Link>
        <Link to="/dashboard/time-entries-this-week" className="stat-tile">
          <div className="value">{data.hoursLoggedThisWeek}h</div>
          <div className="label">{t("dashboard.loggedThisWeek")}</div>
        </Link>
      </div>

      <div className="dashboard-grid">
        <div>
          <ProjectProgress projects={data.projectProgress} />
          <RecentActivity activities={data.recentActivity} />
        </div>

        <div className="card">
          <div className="section-title">{t("dashboard.myTasks")}</div>
          {data.myTasks.length === 0 && <p className="muted">{t("dashboard.nothingAssigned")}</p>}
          {data.myTasks.map((t) => (
            <div className="task-list-item" key={t.id}>
              <Link to={`/tasks/${t.id}`}>{t.title}</Link>
              <span className="muted">{formatDueDate(t.dueDate)}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <DeadlinesCalendar />
      </div>
    </div>
  );
}
