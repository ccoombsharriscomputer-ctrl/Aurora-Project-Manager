import { Fragment, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ChecklistItem, ProjectType, TaskPriority, TaskTemplate } from "../api/types";
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

function TaskTemplatesPanel({ checklistItemId }: { checklistItemId: string }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [error, setError] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["task-templates", checklistItemId],
    queryFn: () => api.get<TaskTemplate[]>(`/checklist-items/${checklistItemId}/task-templates`),
  });

  const createTemplate = useMutation({
    mutationFn: () => api.post<TaskTemplate>(`/checklist-items/${checklistItemId}/task-templates`, { title, priority }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-templates", checklistItemId] });
      setTitle("");
      setPriority("MEDIUM");
      setError(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/task-templates/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task-templates", checklistItemId] }),
  });

  return (
    <div style={{ marginLeft: 20, marginTop: 6, marginBottom: 10, paddingLeft: 12, borderLeft: "2px solid var(--border)" }}>
      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        These to-do tasks auto-create under the sub-project whenever this checklist item is used in a project.
      </p>
      {isLoading && <p className="muted">Loading…</p>}
      {templates?.map((t) => (
        <div className="task-list-item" key={t.id}>
          <span>
            {t.title} <span className={`badge priority-${t.priority}`}>{t.priority}</span>
          </span>
          <span className="gap-8">
            <span className="muted">{t.active ? "Active" : "Inactive"}</span>
            <button className="btn btn-sm" onClick={() => toggleActive.mutate({ id: t.id, active: !t.active })}>
              {t.active ? "Deactivate" : "Reactivate"}
            </button>
          </span>
        </div>
      ))}
      {templates?.length === 0 && <p className="muted">No to-do tasks yet.</p>}
      <form
        className="gap-8"
        style={{ marginTop: 10 }}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!title.trim()) return;
          createTemplate.mutate();
        }}
      >
        <input type="text" placeholder="e.g. Export legacy data" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} style={{ width: "auto" }}>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
        </select>
        <button className="btn btn-sm btn-primary" type="submit" disabled={createTemplate.isPending}>
          Add
        </button>
      </form>
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

function ChecklistPanel({ projectTypeId }: { projectTypeId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  // The full shared catalog — every checklist item, regardless of which type(s) use it.
  const { data: catalog, isLoading } = useQuery({
    queryKey: ["checklist-items"],
    queryFn: () => api.get<ChecklistItem[]>("/checklist-items"),
  });

  // Which catalog items are currently checked (attached) for THIS type — the source of
  // truth for checkbox state, and what auto-instantiates when a project of this type is made.
  const { data: attachedItems } = useQuery({
    queryKey: ["checklist-items", projectTypeId],
    queryFn: () => api.get<ChecklistItem[]>(`/project-types/${projectTypeId}/checklist-items`),
  });
  const attachedIds = new Set((attachedItems ?? []).map((i) => i.id));

  function invalidateCatalog() {
    // Bare key prefix-matches both the global catalog query and every per-type query.
    queryClient.invalidateQueries({ queryKey: ["checklist-items"] });
  }

  const createItem = useMutation({
    mutationFn: () => api.post<ChecklistItem>(`/project-types/${projectTypeId}/checklist-items`, { name }),
    onSuccess: () => {
      invalidateCatalog();
      setName("");
      setError(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const toggleAttached = useMutation({
    mutationFn: ({ id, attached }: { id: string; attached: boolean }) =>
      attached
        ? api.delete(`/project-types/${projectTypeId}/checklist-items/${id}`)
        : api.post(`/project-types/${projectTypeId}/checklist-items/${id}`),
    onSuccess: invalidateCatalog,
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/checklist-items/${id}`, { active }),
    onSuccess: invalidateCatalog,
  });

  const updateItem = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/checklist-items/${id}`, data),
    onSuccess: () => {
      invalidateCatalog();
      setEditingItemId(null);
    },
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => api.delete(`/checklist-items/${id}`),
    onSuccess: (_data, id) => {
      invalidateCatalog();
      setDeleteErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    onError: (err, id) => setDeleteErrors((prev) => ({ ...prev, [id]: extractErrorMessage(err) })),
  });

  function startEdit(item: ChecklistItem) {
    setEditingItemId(item.id);
    setEditName(item.name);
    setEditDescription(item.description ?? "");
  }

  return (
    <div style={{ padding: "12px 4px" }}>
      <div className="section-title" style={{ fontSize: 13 }}>
        Checklist items
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 10 }}>
        Checklist items are a shared catalog across all project types. Check the ones that make up this
        type's standard checklist — they auto-create as sub-projects whenever someone creates a project of
        this type.
      </p>
      {isLoading && <p className="muted">Loading…</p>}
      {catalog?.map((item) => {
        const attached = attachedIds.has(item.id);
        const usedBy = (item.projectTypes ?? []).map((t) => t.name);
        return (
          <div key={item.id}>
            {editingItemId === item.id ? (
              <form
                className="card"
                style={{ marginBottom: 8 }}
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  if (!editName.trim()) return;
                  updateItem.mutate({
                    id: item.id,
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
                <div className="gap-8">
                  <button className="btn btn-sm btn-primary" type="submit" disabled={updateItem.isPending}>
                    Save
                  </button>
                  <button className="btn btn-sm" type="button" onClick={() => setEditingItemId(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="task-list-item">
                <label className="gap-8" style={{ margin: 0, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={attached}
                    onChange={() => toggleAttached.mutate({ id: item.id, attached })}
                  />
                  <span>{item.name}</span>
                </label>
                <span className="gap-8">
                  {usedBy.length > 0 && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      Used by: {usedBy.join(", ")}
                    </span>
                  )}
                  <span className="muted">{item.active ? "Active" : "Inactive"}</span>
                  <button
                    className="btn btn-sm"
                    onClick={() => setExpandedItemId(expandedItemId === item.id ? null : item.id)}
                  >
                    {expandedItemId === item.id ? "Hide tasks" : "Manage tasks"}
                  </button>
                  <button className="btn btn-sm" onClick={() => startEdit(item)}>
                    Edit
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => toggleActive.mutate({ id: item.id, active: !item.active })}
                  >
                    {item.active ? "Deactivate" : "Reactivate"}
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => {
                      if (
                        confirm(
                          `Delete checklist item "${item.name}"? This removes it from the shared catalog (and every project type using it) and deletes its to-do task templates. This cannot be undone.`
                        )
                      ) {
                        deleteItem.mutate(item.id);
                      }
                    }}
                  >
                    Delete
                  </button>
                </span>
              </div>
            )}
            {deleteErrors[item.id] && <div className="error-text">{deleteErrors[item.id]}</div>}
            {expandedItemId === item.id && <TaskTemplatesPanel checklistItemId={item.id} />}
          </div>
        );
      })}
      {catalog?.length === 0 && <p className="muted">No checklist items in the catalog yet — add one below.</p>}
      <form
        className="gap-8"
        style={{ marginTop: 12 }}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!name.trim()) return;
          createItem.mutate();
        }}
      >
        <input type="text" placeholder="e.g. Data Conversion" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-sm btn-primary" type="submit" disabled={createItem.isPending}>
          Add new &amp; attach
        </button>
      </form>
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

export function ProjectTypesPage() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const { data: types, isLoading } = useQuery({
    queryKey: ["project-types"],
    queryFn: () => api.get<ProjectType[]>("/project-types"),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/project-types/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-types"] }),
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
        A project type is a program category (e.g. "Payroll Implementation"). Checklist items (e.g. "Data
        Conversion", "Training", "Go-Live") are a shared catalog you can reuse across any number of project
        types — check which ones apply to each type below. Both the checked items and their to-do tasks
        automatically get created as sub-projects whenever a project of that type is made.
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
              <Fragment key={t.id}>
                <tr>
                  <td>{t.name}</td>
                  <td>{t.description || "—"}</td>
                  <td>{t.active ? "Active" : "Inactive"}</td>
                  <td>{formatDate(t.createdAt)}</td>
                  <td className="gap-8">
                    <button className="btn btn-sm" onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                      {expandedId === t.id ? "Hide checklist" : "Manage checklist"}
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
                        if (confirm(`Delete project type "${t.name}"? Its checklist items stay in the shared catalog (usable by other types) — only this type itself is removed. This cannot be undone.`)) {
                          deleteType.mutate(t.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
                {deleteErrors[t.id] && (
                  <tr>
                    <td colSpan={5}>
                      <div className="error-text">{deleteErrors[t.id]}</div>
                    </td>
                  </tr>
                )}
                {expandedId === t.id && (
                  <tr>
                    <td colSpan={5} style={{ background: "var(--bg)" }}>
                      <ChecklistPanel projectTypeId={t.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
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
