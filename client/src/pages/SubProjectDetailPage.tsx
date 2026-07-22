import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api } from "../api/client";
import type { SubProjectDetail, Task, TaskPriority, UserSummary } from "../api/types";
import { extractErrorMessage, useAuth } from "../context/AuthContext";
import { formatDueDate } from "../utils/format";

const COLUMNS: { status: Task["status"]; labelKey: string }[] = [
  { status: "TODO", labelKey: "common.statusTodo" },
  { status: "IN_PROGRESS", labelKey: "common.statusInProgress" },
  { status: "DONE", labelKey: "common.statusDone" },
];

function priorityLabel(t: TFunction, priority: TaskPriority): string {
  if (priority === "LOW") return t("common.priorityLow");
  if (priority === "HIGH") return t("common.priorityHigh");
  return t("common.priorityMedium");
}

function NewTaskForm({ subProjectId, members }: { subProjectId: string; members: UserSummary[] }) {
  const { t } = useTranslation();
  const { canWrite } = useAuth();
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

  if (!canWrite) {
    return null;
  }

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        {t("subProjectDetail.newTask")}
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
        <label>{t("subProjectDetail.title")}</label>
        <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label>{t("common.description")}</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div className="field">
          <label>{t("subProjectDetail.priority")}</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            <option value="LOW">{t("common.priorityLow")}</option>
            <option value="MEDIUM">{t("common.priorityMedium")}</option>
            <option value="HIGH">{t("common.priorityHigh")}</option>
          </select>
        </div>
        <div className="field">
          <label>{t("subProjectDetail.assignee")}</label>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">{t("subProjectDetail.unassigned")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t("subProjectDetail.dueDate")}</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="gap-8">
        <button className="btn btn-primary" type="submit" disabled={createTask.isPending}>
          {t("subProjectDetail.createTask")}
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

export function SubProjectDetailPage() {
  const { t } = useTranslation();
  const { canWrite } = useAuth();
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
    return <div className="muted">{t("subProjectDetail.loadingSubProject")}</div>;
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

      {tasksLoading && <p className="muted">{t("subProjectDetail.loadingTasks")}</p>}
      <div className="board">
        {COLUMNS.map((col) => (
          <div className="board-column" key={col.status}>
            <h3>{t(col.labelKey)}</h3>
            {tasks
              ?.filter((t) => t.status === col.status)
              .map((task) => (
                <div className="task-card" key={task.id}>
                  <Link to={`/tasks/${task.id}`}>
                    <div className="title">{task.title}</div>
                  </Link>
                  <div className="task-meta">
                    <span className={`badge priority-${task.priority}`}>{priorityLabel(t, task.priority)}</span>
                    <span>{task.assignee?.name ?? t("subProjectDetail.unassigned")}</span>
                  </div>
                  <div className="task-meta" style={{ marginTop: 6 }}>
                    <span>{formatDueDate(task.dueDate)}</span>
                    {canWrite ? (
                      <select
                        value={task.status}
                        onChange={(e) => updateStatus.mutate({ taskId: task.id, status: e.target.value as Task["status"] })}
                        style={{ width: "auto", padding: "2px 4px", fontSize: 12 }}
                      >
                        <option value="TODO">{t("common.statusTodo")}</option>
                        <option value="IN_PROGRESS">{t("common.statusInProgress")}</option>
                        <option value="DONE">{t("common.statusDone")}</option>
                      </select>
                    ) : null}
                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
