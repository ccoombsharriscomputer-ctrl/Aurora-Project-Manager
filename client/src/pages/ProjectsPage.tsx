import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ChecklistItem, Project, ProjectType } from "../api/types";
import { extractErrorMessage } from "../context/AuthContext";

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<Project[]>("/projects"),
  });

  const { data: projectTypes } = useQuery({
    queryKey: ["project-types"],
    queryFn: () => api.get<ProjectType[]>("/project-types"),
  });

  const { data: modules } = useQuery({
    queryKey: ["checklist-items"],
    queryFn: () => api.get<ChecklistItem[]>("/checklist-items"),
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [teamSupportTicketNumber, setTeamSupportTicketNumber] = useState("");
  const [projectTypeId, setProjectTypeId] = useState("");
  const [checklistItemIds, setChecklistItemIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const activeTypes = (projectTypes ?? []).filter((t) => t.active);
  const activeModules = (modules ?? []).filter((m) => m.active);

  function toggleModule(id: string) {
    setChecklistItemIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  }

  const createProject = useMutation({
    mutationFn: () =>
      api.post<Project>("/projects", {
        name,
        description: description || undefined,
        teamSupportTicketNumber: teamSupportTicketNumber || undefined,
        projectTypeId,
        checklistItemIds,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setName("");
      setDescription("");
      setTeamSupportTicketNumber("");
      setProjectTypeId("");
      setChecklistItemIds([]);
      setShowForm(false);
      setError(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!projectTypeId) return;
    createProject.mutate();
  }

  return (
    <div>
      <div className="page-header">
        <h1>Projects</h1>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New project"}
        </button>
      </div>

      {showForm && (
        <form className="card" style={{ marginBottom: 20 }} onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" type="text" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="projectType">Project type</label>
            <select
              id="projectType"
              required
              value={projectTypeId}
              onChange={(e) => setProjectTypeId(e.target.value)}
            >
              <option value="">Select a project type…</option>
              {activeTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {activeTypes.length === 0 && (
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                No project types yet — an admin or project lead needs to create one first.
              </p>
            )}
          </div>
          <div className="field">
            <label>Modules to include</label>
            {activeModules.length === 0 && (
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                No modules yet — an admin or project lead can add some on the Modules page.
              </p>
            )}
            {activeModules.map((m) => (
              <label key={m.id} className="gap-8" style={{ display: "flex", margin: "4px 0", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={checklistItemIds.includes(m.id)}
                  onChange={() => toggleModule(m.id)}
                />
                <span>{m.name}</span>
              </label>
            ))}
          </div>
          <div className="field">
            <label htmlFor="description">Description</label>
            <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="teamSupportTicketNumber">TeamSupport ticket # (optional)</label>
            <input
              id="teamSupportTicketNumber"
              type="text"
              value={teamSupportTicketNumber}
              onChange={(e) => setTeamSupportTicketNumber(e.target.value)}
            />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={createProject.isPending || !projectTypeId}>
            Create project
          </button>
        </form>
      )}

      {isLoading && <p className="muted">Loading projects…</p>}
      {!isLoading && projects?.length === 0 && <p className="muted">No projects yet — create the first one.</p>}

      <div className="project-grid">
        {projects?.map((p) => {
          const percent = p.totalTasks === 0 ? 0 : Math.round((p.doneTasks / p.totalTasks) * 100);
          return (
            <Link key={p.id} to={`/projects/${p.id}`} className="card project-card">
              <h3>{p.name}</h3>
              <p className="muted" style={{ fontSize: 12, margin: "-4px 0 8px" }}>
                {p.projectType.name}
              </p>
              <p>{p.description || "No description"}</p>
              <div className="progress-row-top">
                <span className="muted">
                  {p.doneTasks}/{p.totalTasks} tasks
                </span>
                <span className="muted">{percent}%</span>
              </div>
              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                {p.members.length} member{p.members.length === 1 ? "" : "s"}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
