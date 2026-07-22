import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { Project, TaskDetail, TaskPriority, TaskStatus, UserSummary } from "../api/types";
import { extractErrorMessage, useAuth } from "../context/AuthContext";
import { formatDate, formatMinutes, formatRelativeTime } from "../utils/format";
import { useActiveTimer } from "../hooks/useActiveTimer";

function statusLabel(t: (key: string) => string, status: TaskStatus): string {
  if (status === "IN_PROGRESS") return t("common.statusInProgress");
  if (status === "DONE") return t("common.statusDone");
  return t("common.statusTodo");
}

function priorityLabel(t: (key: string) => string, priority: TaskPriority): string {
  if (priority === "HIGH") return t("common.priorityHigh");
  if (priority === "LOW") return t("common.priorityLow");
  return t("common.priorityMedium");
}

export function TaskDetailPage() {
  const { t } = useTranslation();
  const { canWrite } = useAuth();
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: task, isLoading } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.get<TaskDetail>(`/tasks/${taskId}`),
    enabled: !!taskId,
  });

  const { data: project } = useQuery({
    queryKey: ["project", task?.project.id],
    queryFn: () => api.get<Project>(`/projects/${task!.project.id}`),
    enabled: !!task,
  });

  const { activeTimer, stop } = useActiveTimer();

  const [commentBody, setCommentBody] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);

  function invalidateTask() {
    queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    if (task) {
      queryClient.invalidateQueries({ queryKey: ["sub-project-tasks", task.subProjectId] });
    }
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }

  const updateTask = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/tasks/${taskId}`, data),
    onSuccess: invalidateTask,
  });

  const deleteTask = useMutation({
    mutationFn: () => api.delete(`/tasks/${taskId}`),
    onSuccess: () => {
      if (task) {
        queryClient.invalidateQueries({ queryKey: ["sub-project-tasks", task.subProjectId] });
      }
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (task) {
        navigate(`/projects/${task.project.id}/sub-projects/${task.subProjectId}`);
      }
    },
  });

  const addComment = useMutation({
    mutationFn: () => api.post(`/tasks/${taskId}/comments`, { body: commentBody }),
    onSuccess: () => {
      setCommentBody("");
      setCommentError(null);
      invalidateTask();
    },
    onError: (err) => setCommentError(extractErrorMessage(err)),
  });

  const uploadAttachment = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.postForm(`/tasks/${taskId}/attachments`, form);
    },
    onSuccess: invalidateTask,
  });

  const startTimer = useMutation({
    mutationFn: () => api.post(`/tasks/${taskId}/time-entries/start`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active-timer"] });
      invalidateTask();
    },
  });

  const [showLogTime, setShowLogTime] = useState(false);
  const [logDate, setLogDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logHours, setLogHours] = useState("");
  const [logNote, setLogNote] = useState("");
  const [logError, setLogError] = useState<string | null>(null);

  const logTime = useMutation({
    mutationFn: () =>
      api.post(`/tasks/${taskId}/time-entries`, {
        date: logDate,
        hours: Number(logHours),
        note: logNote || undefined,
      }),
    onSuccess: () => {
      setShowLogTime(false);
      setLogHours("");
      setLogNote("");
      setLogError(null);
      invalidateTask();
    },
    onError: (err) => setLogError(extractErrorMessage(err)),
  });

  if (isLoading || !task) {
    return <div className="muted">{t("taskDetail.loadingTask")}</div>;
  }

  const isTimerRunningHere = activeTimer?.taskId === task.id;
  const isTimerRunningElsewhere = !!activeTimer && activeTimer.taskId !== task.id;

  function handleCommentSubmit(e: FormEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    addComment.mutate();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to={`/projects/${task.project.id}/sub-projects/${task.subProjectId}`} className="muted">
            ← {task.subProject.name || task.subProject.checklistItem.name} ({task.project.name})
          </Link>
          <h1 style={{ marginTop: 6 }}>{task.title}</h1>
        </div>
        {canWrite && (
          <button
            className="btn btn-danger"
            onClick={() => {
              if (confirm(t("taskDetail.confirmDeleteTask"))) {
                deleteTask.mutate();
              }
            }}
          >
            {t("taskDetail.deleteTask")}
          </button>
        )}
      </div>

      <div className="dashboard-grid">
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="field">
              <label>{t("common.description")}</label>
              <textarea
                defaultValue={task.description ?? ""}
                disabled={!canWrite}
                onBlur={(e) => {
                  if (e.target.value !== (task.description ?? "")) {
                    updateTask.mutate({ description: e.target.value || null });
                  }
                }}
              />
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="section-title">{t("taskDetail.comments")}</div>
            {task.comments.map((c) => (
              <div className="comment" key={c.id}>
                <div className="meta">
                  {c.author.name} · {formatRelativeTime(c.createdAt)}
                </div>
                <div>{c.body}</div>
              </div>
            ))}
            {task.comments.length === 0 && <p className="muted">{t("taskDetail.noCommentsYet")}</p>}
            {canWrite && (
              <form onSubmit={handleCommentSubmit} style={{ marginTop: 12 }}>
                <textarea
                  placeholder={t("taskDetail.addAComment")}
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                />
                {commentError && <div className="error-text">{commentError}</div>}
                <button className="btn btn-primary btn-sm" type="submit" disabled={addComment.isPending} style={{ marginTop: 8 }}>
                  {t("taskDetail.comment")}
                </button>
              </form>
            )}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="flex-between">
              <div className="section-title" style={{ marginBottom: 0 }}>
                {t("projectDetail.attachments")}
              </div>
              {canWrite && (
                <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploadAttachment.isPending}>
                  {t("projectDetail.uploadFile")}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadAttachment.mutate(file);
                  e.target.value = "";
                }}
              />
            </div>
            {task.attachments.length === 0 && <p className="muted" style={{ marginTop: 12 }}>{t("projectDetail.noAttachmentsYet")}</p>}
            {task.attachments.map((a) => (
              <div className="task-list-item" key={a.id}>
                <a href={`/api/attachments/${a.id}/download`}>{a.originalName}</a>
                <span className="muted">
                  {(a.size / 1024).toFixed(0)} KB · {a.uploader.name}
                </span>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="flex-between">
              <div className="section-title" style={{ marginBottom: 0 }}>
                {t("taskDetail.timeEntries")}
              </div>
              {canWrite && (
                <div className="gap-8">
                  <button className="btn btn-sm" onClick={() => setShowLogTime((v) => !v)}>
                    {showLogTime ? t("common.cancel") : t("taskDetail.logTime")}
                  </button>
                  {isTimerRunningHere ? (
                    <button className="btn btn-sm" onClick={() => stop.mutate(activeTimer!.id)}>
                      {t("taskDetail.stopTimer")}
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => startTimer.mutate()}
                      disabled={isTimerRunningElsewhere || startTimer.isPending}
                      title={isTimerRunningElsewhere ? t("taskDetail.stopOtherTimerFirst") : undefined}
                    >
                      {t("taskDetail.startTimer")}
                    </button>
                  )}
                </div>
              )}
            </div>
            {showLogTime && canWrite && (
              <form
                style={{ marginTop: 12, marginBottom: 4 }}
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  if (!logHours || Number(logHours) <= 0) return;
                  logTime.mutate();
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="field">
                    <label>{t("taskDetail.date")}</label>
                    <input type="date" required value={logDate} onChange={(e) => setLogDate(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>{t("taskDetail.hours")}</label>
                    <input
                      type="number"
                      required
                      min="0.25"
                      max="24"
                      step="0.25"
                      placeholder="e.g. 2.5"
                      value={logHours}
                      onChange={(e) => setLogHours(e.target.value)}
                    />
                  </div>
                </div>
                <div className="field">
                  <label>{t("taskDetail.noteOptional")}</label>
                  <input type="text" value={logNote} onChange={(e) => setLogNote(e.target.value)} />
                </div>
                {logError && <div className="error-text">{logError}</div>}
                <button className="btn btn-primary btn-sm" type="submit" disabled={logTime.isPending}>
                  {t("common.save")}
                </button>
              </form>
            )}
            {task.timeEntries.length === 0 && <p className="muted" style={{ marginTop: 12 }}>{t("taskDetail.noTimeLoggedYet")}</p>}
            {task.timeEntries.map((entry) => (
              <div className="task-list-item" key={entry.id}>
                <span>
                  {entry.user.name} {entry.endedAt ? "" : `(${t("taskDetail.running")})`}
                  {entry.note && <span className="muted"> — {entry.note}</span>}
                </span>
                <span className="muted">{formatMinutes(entry.durationMinutes)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="section-title">{t("taskDetail.details")}</div>
          <div className="field">
            <label>{t("common.status")}</label>
            {canWrite ? (
              <select
                value={task.status}
                onChange={(e) => updateTask.mutate({ status: e.target.value as TaskStatus })}
              >
                <option value="TODO">{t("common.statusTodo")}</option>
                <option value="IN_PROGRESS">{t("common.statusInProgress")}</option>
                <option value="DONE">{t("common.statusDone")}</option>
              </select>
            ) : (
              <span>{statusLabel(t, task.status)}</span>
            )}
          </div>
          <div className="field">
            <label>{t("subProjectDetail.priority")}</label>
            {canWrite ? (
              <select
                value={task.priority}
                onChange={(e) => updateTask.mutate({ priority: e.target.value as TaskPriority })}
              >
                <option value="LOW">{t("common.priorityLow")}</option>
                <option value="MEDIUM">{t("common.priorityMedium")}</option>
                <option value="HIGH">{t("common.priorityHigh")}</option>
              </select>
            ) : (
              <span>{priorityLabel(t, task.priority)}</span>
            )}
          </div>
          <div className="field">
            <label>{t("subProjectDetail.assignee")}</label>
            {canWrite ? (
              <select
                value={task.assignee?.id ?? ""}
                onChange={(e) => updateTask.mutate({ assigneeId: e.target.value || null })}
              >
                <option value="">{t("subProjectDetail.unassigned")}</option>
                {project?.members.map((m: UserSummary) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <span>{task.assignee?.name ?? t("subProjectDetail.unassigned")}</span>
            )}
          </div>
          <div className="field">
            <label>{t("subProjectDetail.dueDate")}</label>
            {canWrite ? (
              <input
                type="date"
                defaultValue={task.dueDate ? task.dueDate.slice(0, 10) : ""}
                onChange={(e) =>
                  updateTask.mutate({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })
                }
              />
            ) : (
              <span>{formatDate(task.dueDate)}</span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            {t("taskDetail.createdBy", { name: task.createdBy.name })} · {formatDate(task.createdAt)}
          </div>
        </div>
      </div>
    </div>
  );
}
