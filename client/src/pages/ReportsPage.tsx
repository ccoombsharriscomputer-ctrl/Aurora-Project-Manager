import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { ProjectReportRow, ProjectTypeReportRow, UserRole, UserReportRow } from "../api/types";

function roleLabel(t: (key: string) => string, role: UserRole): string {
  if (role === "ADMIN") return t("common.roleAdmin");
  if (role === "PROJECT_LEAD") return t("common.roleProjectLead");
  return t("common.roleMember");
}

function ByUserTab() {
  const { t } = useTranslation();
  const { data: rows, isLoading } = useQuery({
    queryKey: ["reports", "by-user"],
    queryFn: () => api.get<UserReportRow[]>("/reports/by-user"),
  });

  if (isLoading || !rows) {
    return <p className="muted">{t("common.loading")}</p>;
  }

  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>{t("common.name")}</th>
            <th>{t("common.role")}</th>
            <th>{t("reports.projects")}</th>
            <th>{t("reports.openTasks")}</th>
            <th>{t("reports.completedTasks")}</th>
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
              <td>{r.doneTasks}</td>
              <td>{r.hoursLogged}h</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                {t("reports.noActiveUsers")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ByProjectTab() {
  const { t } = useTranslation();
  const { data: projectRows, isLoading: projectsLoading } = useQuery({
    queryKey: ["reports", "by-project"],
    queryFn: () => api.get<ProjectReportRow[]>("/reports/by-project"),
  });

  const { data: typeRows, isLoading: typesLoading } = useQuery({
    queryKey: ["reports", "by-project-type"],
    queryFn: () => api.get<ProjectTypeReportRow[]>("/reports/by-project-type"),
  });

  return (
    <div>
      <div className="section-title">{t("reports.byProjectType")}</div>
      {typesLoading && <p className="muted">{t("common.loading")}</p>}
      {typeRows && (
        <div className="card" style={{ marginBottom: 20 }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t("reports.type")}</th>
                <th>{t("reports.projects")}</th>
                <th>{t("reports.openTasks")}</th>
                <th>{t("reports.completedTasks")}</th>
                <th>{t("reports.hoursLogged")}</th>
              </tr>
            </thead>
            <tbody>
              {typeRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.totalProjects}</td>
                  <td>{row.openTasks}</td>
                  <td>{row.doneTasks}</td>
                  <td>{row.hoursLogged}h</td>
                </tr>
              ))}
              {typeRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {t("reports.noProjectTypesYet")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-title">{t("reports.byProject")}</div>
      {projectsLoading && <p className="muted">{t("common.loading")}</p>}
      {projectRows && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>{t("reports.project")}</th>
                <th>{t("reports.type")}</th>
                <th>{t("reports.subProjects")}</th>
                <th>{t("reports.openTasks")}</th>
                <th>{t("reports.completedTasks")}</th>
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
                  <td>{p.doneTasks}</td>
                  <td>{p.hoursLogged}h</td>
                  <td>{p.members.map((m) => m.name).join(", ") || "—"}</td>
                </tr>
              ))}
              {projectRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    {t("reports.noProjectsYet")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ReportsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"user" | "project">("user");

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
        </div>
      </div>
      {tab === "user" ? <ByUserTab /> : <ByProjectTab />}
    </div>
  );
}
