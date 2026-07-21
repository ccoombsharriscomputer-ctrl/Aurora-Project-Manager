import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Project } from "../api/types";
import { extractErrorMessage } from "../context/AuthContext";

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<Project[]>("/projects"),
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createProject = useMutation({
    mutationFn: () => api.post<Project>("/projects", { name, description: description || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setName("");
      setDescription("");
      setShowForm(false);
      setError(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
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
            <label htmlFor="description">Description</label>
            <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={createProject.isPending}>
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
