import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api } from "../api/client";
import type { SubProjectDetail, Task, TaskPriority, UserSummary } from "../api/types";
import { extractErrorMessage, useAuth } from "../context/AuthContext";
import { useOpenTabs } from "../context/OpenTabsContext";
import { formatDueDate } from "../utils/format";

const COLUMNS: { status: Task["status"]; labelKey: string }[] = [
  { status: "TODO", labelKey: "common.statusTodo" },
  { status: "IN_PROGRESS", labelKey: "common.statusInProgress" },
  { status: "DONE", labelKey: "common.statusDone" },
  { status: "NA", labelKey: "common.statusNA" },
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
        if (assigneeId && !dueDate) {
          setError(t("subProjectDetail.dueDateRequiredForAssignee"));
          return;
        }
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
          <select
            value={assigneeId}
            onChange={(e) => {
              setAssigneeId(e.target.value);
              setError(null);
            }}
          >
            <option value="">{t("subProjectDetail.unassigned")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>
            {t("subProjectDetail.dueDate")}
            {assigneeId && <span className="required-marker"> {t("taskDetail.requiredMarker")}</span>}
          </label>
          <input
            type="date"
            required={!!assigneeId}
            value={dueDate}
            onChange={(e) => {
              setDueDate(e.target.value);
              setError(null);
            }}
          />
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

  const { openTab } = useOpenTabs();
  useEffect(() => {
    if (subProject) {
      const displayName = subProject.name || subProject.checklistItem.name;
      openTab(
        subProject.id,
        "subProject",
        `${displayName} · ${subProject.project.name}`,
        `/projects/${subProject.project.id}/sub-projects/${subProject.id}`
      );
    }
  }, [subProject, openTab]);

  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ["sub-project-tasks", subProjectId],
    queryFn: () => api.get<Task[]>(`/sub-projects/${subProjectId}/tasks`),
    enabled: !!subProjectId,
  });

  const updateStatus = useMutation({
    mutationFn: ({ taskId, status, naReason }: { taskId: string; status: Task["status"]; naReason?: string }) =>
      api.patch(`/tasks/${taskId}`, { status, ...(naReason ? { naReason } : {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sub-project-tasks", subProjectId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  function handleStatusChange(taskId: string, status: Task["status"]) {
    if (status === "NA") {
      const reason = window.prompt(t("subProjectDetail.naReasonPrompt"));
      if (!reason || !reason.trim()) return;
      updateStatus.mutate({ taskId, status, naReason: reason.trim() });
      return;
    }
    updateStatus.mutate({ taskId, status });
  }

  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  const reorderTasks = useMutation({
    mutationFn: (taskIds: string[]) => api.patch(`/sub-projects/${subProjectId}/tasks/reorder`, { taskIds }),
    onMutate: async (taskIds: string[]) => {
      await queryClient.cancelQueries({ queryKey: ["sub-project-tasks", subProjectId] });
      const previous = queryClient.getQueryData<Task[]>(["sub-project-tasks", subProjectId]);
      if (previous) {
        const reordered = new Map(taskIds.map((id, index) => [id, index]));
        queryClient.setQueryData<Task[]>(
          ["sub-project-tasks", subProjectId],
          [...previous].sort((a, b) => {
            const ai = reordered.get(a.id);
            const bi = reordered.get(b.id);
            if (ai === undefined || bi === undefined) return 0;
            return ai - bi;
          })
        );
      }
      return { previous };
    },
    onError: (_err, _taskIds, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["sub-project-tasks", subProjectId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["sub-project-tasks", subProjectId] });
    },
  });

  function handleDrop(columnTasks: Task[], targetTaskId: string) {
    if (!draggedTaskId || draggedTaskId === targetTaskId) return;
    const ids = columnTasks.map((task) => task.id);
    const from = ids.indexOf(draggedTaskId);
    const to = ids.indexOf(targetTaskId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    reorderTasks.mutate(ids);
  }

  // Dropping in the empty space below a column's cards (rather than onto a specific
  // card) moves the dragged task to the end of that column instead of no-oping.
  function handleDropOnColumn(columnTasks: Task[]) {
    if (!draggedTaskId) return;
    const ids = columnTasks.map((task) => task.id);
    const from = ids.indexOf(draggedTaskId);
    if (from === -1 || from === ids.length - 1) return;
    ids.push(ids.splice(from, 1)[0]);
    reorderTasks.mutate(ids);
  }

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
        {COLUMNS.map((col) => {
          const columnTasks = tasks?.filter((t) => t.status === col.status) ?? [];
          return (
            <div
              className="board-column"
              key={col.status}
              onDragOver={(e) => canWrite && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleDropOnColumn(columnTasks);
              }}
            >
              <h3>{t(col.labelKey)}</h3>
              {columnTasks.map((task) => (
                <div
                  className={`task-card${draggedTaskId === task.id ? " dragging" : ""}`}
                  key={task.id}
                  draggable={canWrite}
                  onDragStart={() => setDraggedTaskId(task.id)}
                  onDragEnd={() => setDraggedTaskId(null)}
                  onDragOver={(e) => canWrite && e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDrop(columnTasks, task.id);
                  }}
                >
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
                        onChange={(e) => handleStatusChange(task.id, e.target.value as Task["status"])}
                        style={{ width: "auto", padding: "2px 4px", fontSize: 12 }}
                      >
                        <option value="TODO">{t("common.statusTodo")}</option>
                        <option value="IN_PROGRESS">{t("common.statusInProgress")}</option>
                        <option value="DONE">{t("common.statusDone")}</option>
                        <option value="NA">{t("common.statusNA")}</option>
                      </select>
                    ) : null}
                  </div>
                  {task.status === "NA" && task.naReason && (
                    <div className="muted" style={{ marginTop: 6, fontSize: 12, fontStyle: "italic" }}>
                      {task.naReason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
