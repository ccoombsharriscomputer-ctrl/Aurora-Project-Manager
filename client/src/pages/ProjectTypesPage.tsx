import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ProjectType } from "../api/types";
import { extractErrorMessage } from "../context/AuthContext";
import { formatDate } from "../utils/format";

function CreateTypeForm() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createType = useMutation({
    mutationFn: () => api.post<ProjectType>("/project-types", { name, description: description || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-types"] });
      setName("");
      setDescription("");
      setOpen(false);
      setError(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        New project type
      </button>
    );
  }

  return (
    <form
      className="card"
      style={{ marginBottom: 16 }}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        createType.mutate();
      }}
    >
      <div className="field">
        <label>Name</label>
        <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="gap-8">
        <button className="btn btn-primary" type="submit" disabled={createType.isPending}>
          Create
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ProjectTypesPage() {
  const queryClient = useQueryClient();
  const { data: types, isLoading } = useQuery({
    queryKey: ["project-types"],
    queryFn: () => api.get<ProjectType[]>("/project-types"),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/project-types/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-types"] }),
  });

  if (isLoading || !types) {
    return <div className="muted">Loading project types…</div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Project Types</h1>
        <CreateTypeForm />
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        This is the catalog teams pick from when adding a sub-project (e.g. "Data Conversion", "Training") under a project.
      </p>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.description || "—"}</td>
                <td>{t.active ? "Active" : "Inactive"}</td>
                <td>{formatDate(t.createdAt)}</td>
                <td>
                  <button
                    className="btn btn-sm"
                    onClick={() => toggleActive.mutate({ id: t.id, active: !t.active })}
                  >
                    {t.active ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
            {types.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No project types yet — create the first one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
