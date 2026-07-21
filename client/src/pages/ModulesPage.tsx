import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ChecklistItem, TaskPriority, TaskTemplate } from "../api/types";
import { extractErrorMessage } from "../context/AuthContext";

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
        These to-do tasks auto-create under the sub-project whenever this module is used on a project.
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

function CreateModuleForm() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createItem = useMutation({
    mutationFn: () => api.post<ChecklistItem>("/checklist-items", { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-items"] });
      setName("");
      setError(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  return (
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
        Add module
      </button>
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}

export function ModulesPage() {
  const queryClient = useQueryClient();
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  const { data: modules, isLoading } = useQuery({
    queryKey: ["checklist-items"],
    queryFn: () => api.get<ChecklistItem[]>("/checklist-items"),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/checklist-items/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["checklist-items"] }),
  });

  const updateItem = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/checklist-items/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-items"] });
      setEditingItemId(null);
    },
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => api.delete(`/checklist-items/${id}`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["checklist-items"] });
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

  if (isLoading || !modules) {
    return <div className="muted">Loading modules…</div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Modules</h1>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Modules (e.g. "Payroll", "Utility Billing", "Data Conversion") are a shared catalog of reusable
        sub-projects. They aren't tied to any project type — when creating a new project, you pick which
        modules to include as its sub-projects. Each module can have its own standard to-do tasks that
        auto-create whenever it's used.
      </p>
      <div className="card">
        {modules.map((item) => (
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
                <span>{item.name}</span>
                <span className="gap-8">
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
                          `Delete module "${item.name}"? This deletes it from the catalog and its to-do task templates. This cannot be undone.`
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
        ))}
        {modules.length === 0 && <p className="muted">No modules yet — add the first one below.</p>}
        <CreateModuleForm />
      </div>
    </div>
  );
}
