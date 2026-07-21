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

  const { data: items, isLoading } = useQuery({
    queryKey: ["checklist-items", projectTypeId],
    queryFn: () => api.get<ChecklistItem[]>(`/project-types/${projectTypeId}/checklist-items`),
  });

  const createItem = useMutation({
    mutationFn: () => api.post<ChecklistItem>(`/project-types/${projectTypeId}/checklist-items`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-items", projectTypeId] });
      setName("");
      setError(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/checklist-items/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["checklist-items", projectTypeId] }),
  });

  return (
    <div style={{ padding: "12px 4px" }}>
      <div className="section-title" style={{ fontSize: 13 }}>
        Checklist items
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 10 }}>
        These auto-create as sub-projects whenever someone creates a project of this type.
      </p>
      {isLoading && <p className="muted">Loading…</p>}
      {items?.map((item) => (
        <div key={item.id}>
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
              <button
                className="btn btn-sm"
                onClick={() => toggleActive.mutate({ id: item.id, active: !item.active })}
              >
                {item.active ? "Deactivate" : "Reactivate"}
              </button>
            </span>
          </div>
          {expandedItemId === item.id && <TaskTemplatesPanel checklistItemId={item.id} />}
        </div>
      ))}
      {items?.length === 0 && <p className="muted">No checklist items yet.</p>}
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
          Add
        </button>
      </form>
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

export function ProjectTypesPage() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
        A project type is a program category (e.g. "Payroll Implementation"). Each type has a checklist of
        standard phases (e.g. "Data Conversion", "Training", "Go-Live"), and each phase can have its own to-do
        tasks. Both the phases and their to-do tasks automatically get created whenever a project of that type
        is made.
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
                  </td>
                </tr>
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
