import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { SubProjectDetail, Task, TaskPriority, UserSummary } from "../api/types";
import { extractErrorMessage } from "../context/AuthContext";
import { formatDate } from "../utils/format";

const COLUMNS: { status: Task["status"]; label: string }[] = [
  { status: "TODO", label: "To Do" },
  { status: "IN_PROGRESS", label: "In Progress" },
  { status: "DONE", label: "Done" },
];

function NewTaskForm({ subProjectId, members }: { subProjectId: string; members: UserSummary[] }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const createTask = useMutation({
    mutationFn: () =>
      api.post<Task>(`/sub-projects/${subProjectId}/tasks`, {
        title,
        description: description || undefined,
        priority,
        assigneeId: assigneeId || undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sub-project-tasks", subProjectId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setTitle("");
      setDescription("");
      setAssigneeId("");
      setDueDate("");
      setOpen(false);
      setError(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        New task
      </button>
    );
  }

  return (
    <form
      className="card"
      style={{ marginBottom: 16 }}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        createTask.mutate();
      }}
    >
      <div className="field">
        <label>Title</label>
        <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div className="field">
          <label>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
        </div>
        <div className="field">
          <label>Assignee</label>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Due date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="gap-8">
        <button className="btn btn-primary" type="submit" disabled={createTask.isPending}>
          Create task
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function SubProjectDetailPage() {
  const { projectId, subProjectId } = useParams<{ projectId: string; subProjectId: string }>();
  const queryClient = useQueryClient();

  const { data: subProject, isLoading: subProjectLoading } = useQuery({
    queryKey: ["sub-project", subProjectId],
    queryFn: () => api.get<SubProjectDetail>(`/sub-projects/${subProjectId}`),
    enabled: !!subProjectId,
  });

  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ["sub-project-tasks", subProjectId],
    queryFn: () => api.get<Task[]>(`/sub-projects/${subProjectId}/tasks`),
    enabled: !!subProjectId,
  });

  const updateStatus = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: Task["status"] }) =>
      api.patch(`/tasks/${taskId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sub-project-tasks", subProjectId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  if (subProjectLoading || !subProject) {
    return <div className="muted">Loading sub-project…</div>;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to={`/projects/${projectId ?? subProject.project.id}`} className="muted">
            ← {subProject.project.name}
          </Link>
          <h1 style={{ marginTop: 6 }}>{subProject.name || subProject.checklistItem.name}</h1>
          {subProject.name && <p className="muted" style={{ margin: "4px 0 0" }}>{subProject.checklistItem.name}</p>}
        </div>
        <NewTaskForm subProjectId={subProject.id} members={subProject.project.members} />
      </div>

      {tasksLoading && <p className="muted">Loading tasks…</p>}
      <div className="board">
        {COLUMNS.map((col) => (
          <div className="board-column" key={col.status}>
            <h3>{col.label}</h3>
            {tasks
              ?.filter((t) => t.status === col.status)
              .map((t) => (
                <div className="task-card" key={t.id}>
                  <Link to={`/tasks/${t.id}`}>
                    <div className="title">{t.title}</div>
                  </Link>
                  <div className="task-meta">
                    <span className={`badge priority-${t.priority}`}>{t.priority}</span>
                    <span>{t.assignee?.name ?? "Unassigned"}</span>
                  </div>
                  <div className="task-meta" style={{ marginTop: 6 }}>
                    <span>{formatDate(t.dueDate)}</span>
                    <select
                      value={t.status}
                      onChange={(e) => updateStatus.mutate({ taskId: t.id, status: e.target.value as Task["status"] })}
                      style={{ width: "auto", padding: "2px 4px", fontSize: 12 }}
                    >
                      <option value="TODO">To Do</option>
                      <option value="IN_PROGRESS">In Progress</option>
                      <option value="DONE">Done</option>
                    </select>
                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
