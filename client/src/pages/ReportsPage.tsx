import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api } from "../api/client";
import type {
  OverdueTaskRow,
  ProjectReportRow,
  ProjectTypeReportRow,
  UserRole,
  UserReportRow,
  UserSummary,
} from "../api/types";
import { downloadCsv } from "../utils/csv";
import { formatDate, formatDueDate } from "../utils/format";

interface Filters {
  userId: string;
  from: string;
  to: string;
}

function buildQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function roleLabel(t: TFunction, role: UserRole): string {
  if (role === "ADMIN") return t("common.roleAdmin");
  if (role === "PROJECT_LEAD") return t("common.roleProjectLead");
  if (role === "READ_ONLY") return t("common.roleReadOnly");
  return t("common.roleMember");
}

function pct(value: number | null): string {
  return value == null ? "—" : `${value}%`;
}

function daysValue(value: number | null): string {
  return value == null ? "—" : String(value);
}

function CountBadge({ count }: { count: number }) {
  if (count === 0) return <span>0</span>;
  return <span className="badge badge-danger">{count}</span>;
}

function FilterBar({ filters, setFilters, users }: { filters: Filters; setFilters: (f: Filters) => void; users: UserSummary[] }) {
  const { t } = useTranslation();
  const hasFilters = filters.userId || filters.from || filters.to;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="gap-8" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ minWidth: 200 }}>
          <label>{t("reports.filterByUser")}</label>
          <select value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value })}>
            <option value="">{t("reports.allUsers")}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t("reports.fromDate")}</label>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </div>
        <div className="field">
          <label>{t("reports.toDate")}</label>
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
        {hasFilters && (
          <button className="btn btn-sm" onClick={() => setFilters({ userId: "", from: "", to: "" })}>
            {t("reports.clearFilters")}
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
        {t("reports.dateRangeHint")}
      </p>
    </div>
  );
}

function ByUserTab({ filters }: { filters: Filters }) {
  const { t } = useTranslation();
  const { data: rows, isLoading } = useQuery({
    queryKey: ["reports", "by-user", filters],
    queryFn: () => api.get<UserReportRow[]>(`/reports/by-user${buildQuery(filters)}`),
  });

  if (isLoading || !rows) {
    return <p className="muted">{t("common.loading")}</p>;
  }

  return (
    <div className="card">
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>
          {t("reports.byUser")}
        </div>
        <button
          className="btn btn-sm"
          disabled={rows.length === 0}
          onClick={() =>
            downloadCsv("report-by-user.csv", rows, [
              { header: t("common.name"), value: (r) => r.name },
              { header: t("common.email"), value: (r) => r.email },
              { header: t("common.role"), value: (r) => roleLabel(t, r.role) },
              { header: t("reports.projects"), value: (r) => r.projects.map((p) => p.name).join("; ") },
              { header: t("reports.openTasks"), value: (r) => r.openTasks },
              { header: t("reports.overdue"), value: (r) => r.overdueOpen },
              { header: t("reports.completedTasks"), value: (r) => r.doneTasks },
              { header: t("reports.completedLate"), value: (r) => r.completedLate },
              { header: t("reports.onTimeRate"), value: (r) => r.onTimeRate ?? "" },
              { header: t("reports.avgCompletionDays"), value: (r) => r.avgCompletionDays ?? "" },
              { header: t("reports.hoursLogged"), value: (r) => r.hoursLogged },
            ])
          }
        >
          {t("reports.exportCsv")}
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t("common.name")}</th>
              <th>{t("common.role")}</th>
              <th>{t("reports.projects")}</th>
              <th>{t("reports.openTasks")}</th>
              <th>{t("reports.overdue")}</th>
              <th>{t("reports.completedTasks")}</th>
              <th>{t("reports.completedLate")}</th>
              <th>{t("reports.onTimeRate")}</th>
              <th>{t("reports.avgCompletionDays")}</th>
              <th>{t("reports.hoursLogged")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.name}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {r.email}
                  </div>
                </td>
                <td>{roleLabel(t, r.role)}</td>
                <td>{r.projects.length === 0 ? "—" : r.projects.map((p) => p.name).join(", ")}</td>
                <td>{r.openTasks}</td>
                <td>
                  <CountBadge count={r.overdueOpen} />
                </td>
                <td>{r.doneTasks}</td>
                <td>
                  <CountBadge count={r.completedLate} />
                </td>
                <td>{pct(r.onTimeRate)}</td>
                <td>{daysValue(r.avgCompletionDays)}</td>
                <td>{r.hoursLogged}h</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">
                  {t("reports.noActiveUsers")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ByProjectTab({ filters }: { filters: Filters }) {
  const { t } = useTranslation();
  const { data: projectRows, isLoading: projectsLoading } = useQuery({
    queryKey: ["reports", "by-project", filters],
    queryFn: () => api.get<ProjectReportRow[]>(`/reports/by-project${buildQuery(filters)}`),
  });

  const { data: typeRows, isLoading: typesLoading } = useQuery({
    queryKey: ["reports", "by-project-type", filters],
    queryFn: () => api.get<ProjectTypeReportRow[]>(`/reports/by-project-type${buildQuery(filters)}`),
  });

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>
          {t("reports.byProjectType")}
        </div>
        <button
          className="btn btn-sm"
          disabled={!typeRows || typeRows.length === 0}
          onClick={() =>
            typeRows &&
            downloadCsv("report-by-project-type.csv", typeRows, [
              { header: t("reports.type"), value: (r) => r.name },
              { header: t("reports.projects"), value: (r) => r.totalProjects },
              { header: t("reports.openTasks"), value: (r) => r.openTasks },
              { header: t("reports.overdue"), value: (r) => r.overdueOpen },
              { header: t("reports.completedTasks"), value: (r) => r.doneTasks },
              { header: t("reports.completedLate"), value: (r) => r.completedLate },
              { header: t("reports.onTimeRate"), value: (r) => r.onTimeRate ?? "" },
              { header: t("reports.avgCompletionDays"), value: (r) => r.avgCompletionDays ?? "" },
              { header: t("reports.hoursLogged"), value: (r) => r.hoursLogged },
            ])
          }
        >
          {t("reports.exportCsv")}
        </button>
      </div>
      {typesLoading && <p className="muted">{t("common.loading")}</p>}
      {typeRows && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("reports.type")}</th>
                  <th>{t("reports.projects")}</th>
                  <th>{t("reports.openTasks")}</th>
                  <th>{t("reports.overdue")}</th>
                  <th>{t("reports.completedTasks")}</th>
                  <th>{t("reports.completedLate")}</th>
                  <th>{t("reports.onTimeRate")}</th>
                  <th>{t("reports.avgCompletionDays")}</th>
                  <th>{t("reports.hoursLogged")}</th>
                </tr>
              </thead>
              <tbody>
                {typeRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.totalProjects}</td>
                    <td>{row.openTasks}</td>
                    <td>
                      <CountBadge count={row.overdueOpen} />
                    </td>
                    <td>{row.doneTasks}</td>
                    <td>
                      <CountBadge count={row.completedLate} />
                    </td>
                    <td>{pct(row.onTimeRate)}</td>
                    <td>{daysValue(row.avgCompletionDays)}</td>
                    <td>{row.hoursLogged}h</td>
                  </tr>
                ))}
                {typeRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="muted">
                      {t("reports.noProjectTypesYet")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex-between" style={{ marginBottom: 8 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>
          {t("reports.byProject")}
        </div>
        <button
          className="btn btn-sm"
          disabled={!projectRows || projectRows.length === 0}
          onClick={() =>
            projectRows &&
            downloadCsv("report-by-project.csv", projectRows, [
              { header: t("reports.project"), value: (r) => r.name },
              { header: t("reports.type"), value: (r) => r.projectType.name },
              { header: t("reports.subProjects"), value: (r) => r.totalSubProjects },
              { header: t("reports.openTasks"), value: (r) => r.openTasks },
              { header: t("reports.overdue"), value: (r) => r.overdueOpen },
              { header: t("reports.completedTasks"), value: (r) => r.doneTasks },
              { header: t("reports.completedLate"), value: (r) => r.completedLate },
              { header: t("reports.onTimeRate"), value: (r) => r.onTimeRate ?? "" },
              { header: t("reports.avgCompletionDays"), value: (r) => r.avgCompletionDays ?? "" },
              { header: t("reports.hoursLogged"), value: (r) => r.hoursLogged },
              { header: t("projectDetail.members"), value: (r) => r.members.map((m) => m.name).join("; ") },
            ])
          }
        >
          {t("reports.exportCsv")}
        </button>
      </div>
      {projectsLoading && <p className="muted">{t("common.loading")}</p>}
      {projectRows && (
        <div className="card">
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("reports.project")}</th>
                  <th>{t("reports.type")}</th>
                  <th>{t("reports.subProjects")}</th>
                  <th>{t("reports.openTasks")}</th>
                  <th>{t("reports.overdue")}</th>
                  <th>{t("reports.completedTasks")}</th>
                  <th>{t("reports.completedLate")}</th>
                  <th>{t("reports.onTimeRate")}</th>
                  <th>{t("reports.avgCompletionDays")}</th>
                  <th>{t("reports.hoursLogged")}</th>
                  <th>{t("projectDetail.members")}</th>
                </tr>
              </thead>
              <tbody>
                {projectRows.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.projectType.name}</td>
                    <td>{p.totalSubProjects}</td>
                    <td>{p.openTasks}</td>
                    <td>
                      <CountBadge count={p.overdueOpen} />
                    </td>
                    <td>{p.doneTasks}</td>
                    <td>
                      <CountBadge count={p.completedLate} />
                    </td>
                    <td>{pct(p.onTimeRate)}</td>
                    <td>{daysValue(p.avgCompletionDays)}</td>
                    <td>{p.hoursLogged}h</td>
                    <td>{p.members.map((m) => m.name).join(", ") || "—"}</td>
                  </tr>
                ))}
                {projectRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="muted">
                      {t("reports.noProjectsYet")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function OverdueTab({ filters }: { filters: Filters }) {
  const { t } = useTranslation();
  const { data: rows, isLoading } = useQuery({
    queryKey: ["reports", "overdue", filters],
    queryFn: () => api.get<OverdueTaskRow[]>(`/reports/overdue${buildQuery(filters)}`),
  });

  if (isLoading || !rows) {
    return <p className="muted">{t("common.loading")}</p>;
  }

  return (
    <div className="card">
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>
          {t("reports.overdueTasks")}
        </div>
        <button
          className="btn btn-sm"
          disabled={rows.length === 0}
          onClick={() =>
            downloadCsv("report-overdue-tasks.csv", rows, [
              { header: t("subProjectDetail.title"), value: (r) => r.title },
              { header: t("reports.project"), value: (r) => r.project.name },
              { header: t("reports.subProject"), value: (r) => r.subProject.name },
              { header: t("subProjectDetail.assignee"), value: (r) => r.assignee?.name ?? "" },
              { header: t("subProjectDetail.dueDate"), value: (r) => r.dueDate },
              { header: t("common.status"), value: (r) => r.status },
              { header: t("reports.completedDate"), value: (r) => r.completedAt ?? "" },
              { header: t("reports.daysLate"), value: (r) => r.daysLate },
            ])
          }
        >
          {t("reports.exportCsv")}
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t("subProjectDetail.title")}</th>
              <th>{t("reports.project")}</th>
              <th>{t("subProjectDetail.assignee")}</th>
              <th>{t("subProjectDetail.dueDate")}</th>
              <th>{t("common.status")}</th>
              <th>{t("reports.completedDate")}</th>
              <th>{t("reports.daysLate")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.title}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {r.project.name} · {r.subProject.name}
                  </div>
                </td>
                <td>{r.project.name}</td>
                <td>{r.assignee?.name ?? t("subProjectDetail.unassigned")}</td>
                <td>{formatDueDate(r.dueDate)}</td>
                <td>
                  {r.status === "DONE" ? (
                    <span className="badge priority-HIGH">{t("common.statusDone")}</span>
                  ) : (
                    <span className="badge badge-danger">
                      {r.status === "IN_PROGRESS" ? t("common.statusInProgress") : t("common.statusTodo")}
                    </span>
                  )}
                </td>
                <td>{r.completedAt ? formatDate(r.completedAt) : "—"}</td>
                <td>{r.daysLate}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {t("reports.noOverdueTasks")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ReportsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"user" | "project" | "overdue">("user");
  const [filters, setFilters] = useState<Filters>({ userId: "", from: "", to: "" });

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<UserSummary[]>("/users"),
  });

  return (
    <div>
      <div className="page-header">
        <h1>{t("layout.reports")}</h1>
        <div className="gap-8">
          <button className={`btn btn-sm${tab === "user" ? " btn-primary" : ""}`} onClick={() => setTab("user")}>
            {t("reports.byUser")}
          </button>
          <button
            className={`btn btn-sm${tab === "project" ? " btn-primary" : ""}`}
            onClick={() => setTab("project")}
          >
            {t("reports.byProject")}
          </button>
          <button
            className={`btn btn-sm${tab === "overdue" ? " btn-primary" : ""}`}
            onClick={() => setTab("overdue")}
          >
            {t("reports.overdueTasks")}
          </button>
        </div>
      </div>
      <FilterBar filters={filters} setFilters={setFilters} users={users ?? []} />
      {tab === "user" && <ByUserTab filters={filters} />}
      {tab === "project" && <ByProjectTab filters={filters} />}
      {tab === "overdue" && <OverdueTab filters={filters} />}
    </div>
  );
}
