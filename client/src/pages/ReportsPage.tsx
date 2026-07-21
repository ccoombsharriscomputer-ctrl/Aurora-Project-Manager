import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ProjectReportRow, ProjectTypeReportRow, UserReportRow } from "../api/types";

function ByUserTab() {
  const { data: rows, isLoading } = useQuery({
    queryKey: ["reports", "by-user"],
    queryFn: () => api.get<UserReportRow[]>("/reports/by-user"),
  });

  if (isLoading || !rows) {
    return <p className="muted">Loading…</p>;
  }

  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Projects</th>
            <th>Open tasks</th>
            <th>Completed tasks</th>
            <th>Hours logged</th>
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
              <td>{r.role}</td>
              <td>{r.projects.length === 0 ? "—" : r.projects.map((p) => p.name).join(", ")}</td>
              <td>{r.openTasks}</td>
              <td>{r.doneTasks}</td>
              <td>{r.hoursLogged}h</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No active users.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ByProjectTab() {
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
      <div className="section-title">By project type</div>
      {typesLoading && <p className="muted">Loading…</p>}
      {typeRows && (
        <div className="card" style={{ marginBottom: 20 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Projects</th>
                <th>Open tasks</th>
                <th>Completed tasks</th>
                <th>Hours logged</th>
              </tr>
            </thead>
            <tbody>
              {typeRows.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.totalProjects}</td>
                  <td>{t.openTasks}</td>
                  <td>{t.doneTasks}</td>
                  <td>{t.hoursLogged}h</td>
                </tr>
              ))}
              {typeRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No project types yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-title">By project</div>
      {projectsLoading && <p className="muted">Loading…</p>}
      {projectRows && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Type</th>
                <th>Sub-projects</th>
                <th>Open tasks</th>
                <th>Completed tasks</th>
                <th>Hours logged</th>
                <th>Members</th>
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
                    No projects yet.
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
  const [tab, setTab] = useState<"user" | "project">("user");

  return (
    <div>
      <div className="page-header">
        <h1>Reports</h1>
        <div className="gap-8">
          <button className={`btn btn-sm${tab === "user" ? " btn-primary" : ""}`} onClick={() => setTab("user")}>
            By user
          </button>
          <button
            className={`btn btn-sm${tab === "project" ? " btn-primary" : ""}`}
            onClick={() => setTab("project")}
          >
            By project
          </button>
        </div>
      </div>
      {tab === "user" ? <ByUserTab /> : <ByProjectTab />}
    </div>
  );
}
