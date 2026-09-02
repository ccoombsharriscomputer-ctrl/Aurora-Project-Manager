import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { Activity, DashboardSummary, DashboardWidgetKey, DashboardWidgetSize, HoursLoggedResponse } from "../api/types";
import { DASHBOARD_COLLAPSED_COUNT_BY_SIZE } from "../api/types";
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

function StatTile({ to, value, label, size }: { to: string; value: ReactNode; label: string; size: DashboardWidgetSize }) {
  return (
    <Link to={to} className={`stat-tile${size !== "M" ? ` stat-tile-${size}` : ""}`}>
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </Link>
  );
}

function RecentActivity({ activities, size }: { activities: Activity[]; size: DashboardWidgetSize }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const collapsedCount = DASHBOARD_COLLAPSED_COUNT_BY_SIZE[size];
  const visible = expanded ? activities : activities.slice(0, collapsedCount);

  return (
    <div className="card">
      <div className="flex-between">
        <div className="section-title" style={{ marginBottom: 0 }}>
          {t("dashboard.recentActivity")}
        </div>
        {activities.length > collapsedCount && (
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

// Shared by "Project progress" (every active project) and "My projects" (just the ones
// assigned to me) — same shape, same layout, different title/empty-state text and source data.
function ProjectProgress({
  projects,
  size,
  title,
  emptyMessage,
}: {
  projects: DashboardSummary["projectProgress"];
  size: DashboardWidgetSize;
  title: string;
  emptyMessage: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const collapsedCount = DASHBOARD_COLLAPSED_COUNT_BY_SIZE[size];
  const visible = expanded ? projects : projects.slice(0, collapsedCount);

  return (
    <div className="card">
      <div className="flex-between">
        <div className="section-title" style={{ marginBottom: 0 }}>
          {title}
        </div>
        {projects.length > collapsedCount && (
          <button className="btn btn-sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t("dashboard.showLess") : t("dashboard.showMore")}
          </button>
        )}
      </div>
      {projects.length === 0 && <p className="muted">{emptyMessage}</p>}
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

function MyTasks({ tasks, size }: { tasks: DashboardSummary["myTasks"]; size: DashboardWidgetSize }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const collapsedCount = DASHBOARD_COLLAPSED_COUNT_BY_SIZE[size];
  const visible = expanded ? tasks : tasks.slice(0, collapsedCount);

  return (
    <div className="card">
      <div className="flex-between">
        <div className="section-title" style={{ marginBottom: 0 }}>
          {t("dashboard.myTasks")}
        </div>
        {tasks.length > collapsedCount && (
          <button className="btn btn-sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t("dashboard.showLess") : t("dashboard.showMore")}
          </button>
        )}
      </div>
      {tasks.length === 0 && <p className="muted">{t("dashboard.nothingAssigned")}</p>}
      {visible.map((task) => (
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

  // The user's own dashboardLayout (already resolved server-side to default-filled +
  // role-filtered, see lib/dashboardWidgets.ts) picks which widgets render, in what order,
  // and — via the wrapping grid item's size class below — how wide. Each entry's own size is
  // also threaded into the widget itself where it matters (a stat tile's font, a list
  // widget's collapsed count), so this renders one widget per entry rather than building all
  // 7 up front for every entry.
  function renderWidget(key: DashboardWidgetKey, size: DashboardWidgetSize): ReactNode {
    switch (key) {
      case "totalProjects":
        return <StatTile to="/projects" value={data!.totalProjects} label={t("dashboard.totalProjects")} size={size} />;
      case "completedThisWeek":
        return (
          <StatTile
            to="/dashboard/completed-this-week"
            value={data!.tasksCompletedThisWeek}
            label={t("dashboard.completedThisWeek")}
            size={size}
          />
        );
      case "hoursLogged":
        return (
          <StatTile
            to={`/dashboard/time-entries-this-week?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&view=${calendarView}`}
            value={`${hoursLogged?.hours ?? 0}h`}
            label={t(HOURS_LOGGED_TITLE_KEY[calendarView])}
            size={size}
          />
        );
      case "deadlines":
        return (
          <DeadlinesCalendar
            view={calendarView}
            cursor={calendarCursor}
            onViewChange={setCalendarView}
            onCursorChange={setCalendarCursor}
          />
        );
      case "projectProgress":
        return (
          <ProjectProgress
            projects={data!.projectProgress}
            size={size}
            title={t("dashboard.projectProgress")}
            emptyMessage={t("dashboard.noProjectsYet")}
          />
        );
      case "myProjects":
        return (
          <ProjectProgress
            projects={data!.myProjects}
            size={size}
            title={t("dashboard.myProjects")}
            emptyMessage={t("dashboard.noProjectsAssigned")}
          />
        );
      case "recentActivity":
        return <RecentActivity activities={data!.recentActivity} size={size} />;
      case "myTasks":
        return <MyTasks tasks={data!.myTasks} size={size} />;
      default:
        return null;
    }
  }

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

      <div className="dashboard-widget-grid">
        {user!.dashboardLayout.map((entry) => (
          <div className={`dashboard-widget-${entry.size}`} key={entry.key}>
            {renderWidget(entry.key, entry.size)}
          </div>
        ))}
      </div>
    </div>
  );
}
