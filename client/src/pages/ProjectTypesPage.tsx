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
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const { data: types, isLoading } = useQuery({
    queryKey: ["project-types"],
    queryFn: () => api.get<ProjectType[]>("/project-types"),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/project-types/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-types"] }),
  });

  const updateType = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/project-types/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-types"] });
      setEditingId(null);
      setEditError(null);
    },
    onError: (err) => setEditError(extractErrorMessage(err)),
  });

  const deleteType = useMutation({
    mutationFn: (id: string) => api.delete(`/project-types/${id}`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["project-types"] });
      setDeleteErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    onError: (err, id) => setDeleteErrors((prev) => ({ ...prev, [id]: extractErrorMessage(err) })),
  });

  function startEdit(type: ProjectType) {
    setEditingId(type.id);
    setEditName(type.name);
    setEditDescription(type.description ?? "");
    setEditError(null);
  }

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
        A project type is a program category (e.g. "Payroll Implementation") used to organize and report on
        projects. When creating a project, you'll separately choose which modules to include as its
        sub-projects on the Modules page.
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
            {types.map((t) =>
              editingId === t.id ? (
                <tr key={t.id}>
                  <td colSpan={5}>
                    <form
                      className="card"
                      style={{ margin: "8px 0" }}
                      onSubmit={(e: FormEvent) => {
                        e.preventDefault();
                        if (!editName.trim()) return;
                        updateType.mutate({
                          id: t.id,
                          data: { name: editName, description: editDescription || null },
                        });
                      }}
                    >
                      <div className="field">
                        <label>Name</label>
                        <input type="text" required value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>Description</label>
                        <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                      </div>
                      {editError && <div className="error-text">{editError}</div>}
                      <div className="gap-8">
                        <button className="btn btn-sm btn-primary" type="submit" disabled={updateType.isPending}>
                          Save
                        </button>
                        <button className="btn btn-sm" type="button" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.description || "—"}</td>
                  <td>{t.active ? "Active" : "Inactive"}</td>
                  <td>{formatDate(t.createdAt)}</td>
                  <td className="gap-8">
                    <button className="btn btn-sm" onClick={() => startEdit(t)}>
                      Edit
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => toggleActive.mutate({ id: t.id, active: !t.active })}
                    >
                      {t.active ? "Deactivate" : "Reactivate"}
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => {
                        if (confirm(`Delete project type "${t.name}"? This cannot be undone.`)) {
                          deleteType.mutate(t.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                    {deleteErrors[t.id] && <div className="error-text">{deleteErrors[t.id]}</div>}
                  </td>
                </tr>
              )
            )}
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
