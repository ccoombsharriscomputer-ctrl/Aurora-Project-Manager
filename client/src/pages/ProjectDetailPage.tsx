import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Project, Task, TaskPriority, UserSummary } from "../api/types";
import { extractErrorMessage, useAuth } from "../context/AuthContext";
import { formatDate } from "../utils/format";

const COLUMNS: { status: Task["status"]; label: string }[] = [
  { status: "TODO", label: "To Do" },
  { status: "IN_PROGRESS", label: "In Progress" },
  { status: "DONE", label: "Done" },
];

function NewTaskForm({ projectId, members }: { projectId: string; members: UserSummary[] }) {
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
      api.post<Task>(`/projects/${projectId}/tasks`, {
        title,
        description: description || undefined,
        priority,
        assigneeId: assigneeId || undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
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

function MembersPanel({ project, allUsers }: { project: Project; allUsers: UserSummary[] }) {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState("");

  const addMember = useMutation({
    mutationFn: (userId: string) => api.post(`/projects/${project.id}/members`, { userId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      setSelectedUserId("");
    },
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.delete(`/projects/${project.id}/members/${userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project", project.id] }),
  });

  const memberIds = new Set(project.members.map((m) => m.id));
  const nonMembers = allUsers.filter((u) => !memberIds.has(u.id));

  return (
    <div className="card">
      <div className="section-title">Members</div>
      {project.members.map((m) => (
        <div className="task-list-item" key={m.id}>
          <span>
            {m.name} <span className="muted">({m.role})</span>
          </span>
          <button className="btn btn-sm" onClick={() => removeMember.mutate(m.id)}>
            Remove
          </button>
        </div>
      ))}
      {nonMembers.length > 0 && (
        <div className="gap-8" style={{ marginTop: 12 }}>
          <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
            <option value="">Add member…</option>
            {nonMembers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-sm"
            disabled={!selectedUserId}
            onClick={() => selectedUserId && addMember.mutate(selectedUserId)}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.get<Project>(`/projects/${projectId}`),
    enabled: !!projectId,
  });

  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ["project-tasks", projectId],
    queryFn: () => api.get<Task[]>(`/projects/${projectId}/tasks`),
    enabled: !!projectId,
  });

  const { data: allUsers } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<UserSummary[]>("/users"),
  });

  const updateStatus = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: Task["status"] }) =>
      api.patch(`/tasks/${taskId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const deleteProject = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate("/projects");
    },
  });

  if (projectLoading || !project) {
    return <div className="muted">Loading project…</div>;
  }

  const canManage = user?.role === "ADMIN" || user?.id === project.createdBy.id;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{project.name}</h1>
          {project.description && <p className="muted" style={{ margin: "4px 0 0" }}>{project.description}</p>}
        </div>
        <div className="gap-8">
          <NewTaskForm projectId={project.id} members={project.members} />
          {canManage && (
            <button
              className="btn btn-danger"
              onClick={() => {
                if (confirm(`Delete project "${project.name}"? This cannot be undone.`)) {
                  deleteProject.mutate();
                }
              }}
            >
              Delete project
            </button>
          )}
        </div>
      </div>

      <div className="dashboard-grid">
        <div>
          {tasksLoading && <p className="muted">Loading tasks…</p>}
          <div className="board">
            {COLUMNS.map((col) => (
              <div className="board-column" key={col.status}>
                <h3>{col.label}</h3>
                {tasks
                  ?.filter((t) => t.status === col.status)
                  .map((t) => (
                    <div className="task-card" key={t.id}>
                      <Link to={`/projects/${project.id}/tasks/${t.id}`}>
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
                          onChange={(e) =>
                            updateStatus.mutate({ taskId: t.id, status: e.target.value as Task["status"] })
                          }
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

        <MembersPanel project={project} allUsers={allUsers ?? []} />
      </div>
    </div>
  );
}
