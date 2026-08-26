import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { Activity, DashboardSummary, DashboardWidgetKey, HoursLoggedResponse } from "../api/types";
import { formatDueDate, formatElapsed, formatRelativeTime } from "../utils/format";
import { useActiveTimer } from "../hooks/useActiveTimer";
import { useAuth } from "../context/AuthContext";
import { DeadlinesCalendar } from "../components/DeadlinesCalendar";
import { CustomizeDashboardPanel } from "../components/CustomizeDashboardPanel";
import { HOURS_LOGGED_TITLE_KEY, periodRange, startOfDay, type ViewMode } from "../utils/calendarPeriod";

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
    <div className="card">
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

function MyTasks({ tasks }: { tasks: DashboardSummary["myTasks"] }) {
  const { t } = useTranslation();
  return (
    <div className="card">
      <div className="section-title">{t("dashboard.myTasks")}</div>
      {tasks.length === 0 && <p className="muted">{t("dashboard.nothingAssigned")}</p>}
      {tasks.map((task) => (
        <div className="task-list-item" key={task.id}>
          <Link to={`/tasks/${task.id}`}>
            {task.project?.name} - {task.subProject?.name || task.subProject?.checklistItem.name} - {task.title}
          </Link>
          <span className="muted">{formatDueDate(task.dueDate)}</span>
        </div>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [customizing, setCustomizing] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardSummary>("/dashboard/summary"),
    refetchInterval: 15000,
  });

  const [calendarView, setCalendarView] = useState<ViewMode>("week");
  const [calendarCursor, setCalendarCursor] = useState(() => startOfDay(new Date()));

  const { start, end } = useMemo(() => periodRange(calendarView, calendarCursor), [calendarView, calendarCursor]);

  const { data: hoursLogged } = useQuery({
    queryKey: ["dashboard-hours-logged", start.getTime(), end.getTime()],
    queryFn: () =>
      api.get<HoursLoggedResponse>(
        `/dashboard/hours-logged?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`
      ),
    refetchInterval: 15000,
  });

  if (isLoading || !data) {
    return <div className="muted">{t("dashboard.loadingDashboard")}</div>;
  }

  // One entry per customizable section — the user's own dashboardLayout (already resolved
  // server-side to default-filled + role-filtered, see lib/dashboardWidgets.ts) picks which
  // of these render, and in what order.
  const widgets: Record<DashboardWidgetKey, ReactNode> = {
    statTiles: (
      <div className="stat-grid" style={{ marginBottom: 0 }}>
        <Link to="/projects" className="stat-tile">
          <div className="value">{data.totalProjects}</div>
          <div className="label">{t("dashboard.totalProjects")}</div>
        </Link>
        <Link to="/dashboard/completed-this-week" className="stat-tile">
          <div className="value">{data.tasksCompletedThisWeek}</div>
          <div className="label">{t("dashboard.completedThisWeek")}</div>
        </Link>
        <Link
          to={`/dashboard/time-entries-this-week?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&view=${calendarView}`}
          className="stat-tile"
        >
          <div className="value">{hoursLogged?.hours ?? 0}h</div>
          <div className="label">{t(HOURS_LOGGED_TITLE_KEY[calendarView])}</div>
        </Link>
      </div>
    ),
    deadlines: (
      <DeadlinesCalendar
        view={calendarView}
        cursor={calendarCursor}
        onViewChange={setCalendarView}
        onCursorChange={setCalendarCursor}
      />
    ),
    projectProgress: <ProjectProgress projects={data.projectProgress} />,
    recentActivity: <RecentActivity activities={data.recentActivity} />,
    myTasks: <MyTasks tasks={data.myTasks} />,
  };

  return (
    <div>
      <div className="page-header">
        <h1>{t("layout.dashboard")}</h1>
        <button className="btn btn-sm" onClick={() => setCustomizing((v) => !v)}>
          {t("dashboard.customize")}
        </button>
      </div>

      <TimerBanner />

      {customizing && <CustomizeDashboardPanel onClose={() => setCustomizing(false)} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {user!.dashboardLayout.map((key) => (
          <div key={key}>{widgets[key]}</div>
        ))}
      </div>
    </div>
  );
}
