import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { Project, TaskDetail, TaskPriority, TaskStatus, TeamSupportActionType, UserSummary } from "../api/types";
import { extractErrorMessage, useAuth } from "../context/AuthContext";
import { useOpenTabs } from "../context/OpenTabsContext";
import { formatDate, formatMinutes, formatRelativeTime } from "../utils/format";
import { useActiveTimer } from "../hooks/useActiveTimer";

const COLLAPSED_COUNT = 3;

interface FeedItem {
  id: string;
  commentId: string | null;
  createdAt: string;
  authorName: string;
  body: string | null;
  durationMinutes: number | null;
  running: boolean;
  actionType: string | null;
  isPublic: boolean;
}

function statusLabel(t: (key: string) => string, status: TaskStatus): string {
  if (status === "IN_PROGRESS") return t("common.statusInProgress");
  if (status === "DONE") return t("common.statusDone");
  if (status === "NA") return t("common.statusNA");
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

  const { openTab } = useOpenTabs();
  useEffect(() => {
    if (task) openTab(task.id, "task", `${task.title} · ${task.project.name}`, `/tasks/${task.id}`);
  }, [task, openTab]);

  const { data: project } = useQuery({
    queryKey: ["project", task?.project.id],
    queryFn: () => api.get<Project>(`/projects/${task!.project.id}`),
    enabled: !!task,
  });

  const { data: actionTypes } = useQuery({
    queryKey: ["teamsupport-action-types"],
    queryFn: () => api.get<TeamSupportActionType[]>("/teamsupport-action-types"),
    enabled: !!project?.teamSupportTicketNumber,
  });

  const { activeTimer, stop } = useActiveTimer();

  const [commentBody, setCommentBody] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentDate, setCommentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [commentHours, setCommentHours] = useState("");
  const [actionTypeId, setActionTypeId] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [expanded, setExpanded] = useState(false);

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

  function handleStatusChange(status: TaskStatus) {
    if (status === "NA") {
      const reason = window.prompt(t("taskDetail.naReasonPrompt"));
      if (!reason || !reason.trim()) return;
      updateTask.mutate({ status, naReason: reason.trim() });
      return;
    }
    updateTask.mutate({ status });
  }

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
    mutationFn: () =>
      api.post(`/tasks/${taskId}/comments`, {
        body: commentBody,
        hours: commentHours ? Number(commentHours) : undefined,
        date: commentHours ? commentDate : undefined,
        actionTypeId: actionTypeId || undefined,
        isPublic,
        followUpDate: followUpDate || undefined,
      }),
    onSuccess: () => {
      setCommentBody("");
      setCommentError(null);
      setCommentHours("");
      setActionTypeId("");
      setIsPublic(false);
      if (followUpDate) {
        queryClient.invalidateQueries({ queryKey: ["calendar"] });
      }
      setFollowUpDate("");
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

  const deleteAttachment = useMutation({
    mutationFn: (attachmentId: string) => api.delete(`/attachments/${attachmentId}`),
    onSuccess: invalidateTask,
  });

  const deleteComment = useMutation({
    mutationFn: (commentId: string) => api.delete(`/tasks/${taskId}/comments/${commentId}`),
    onSuccess: invalidateTask,
  });

  if (isLoading || !task) {
    return <div className="muted">{t("taskDetail.loadingTask")}</div>;
  }

  // Starting a new timer from a task was removed — logging time now goes through the hours
  // field on a comment, or manual time entry. isTimerRunningHere still gates the Stop button
  // below, so a timer already running from before this change can still be stopped cleanly.
  const isTimerRunningHere = activeTimer?.taskId === task.id;

  // Comments and time entries are two separate tables, but a comment logged with hours
  // creates both — task.timeEntries only ever contains the bare (Start Timer/Stop) ones, so
  // combining them here can't double-count. Sorted newest-first, matching Recent Activity.
  const feedItems: FeedItem[] = [
    ...task.comments.map((c) => ({
      id: `comment-${c.id}`,
      commentId: c.id,
      createdAt: c.createdAt,
      authorName: c.author.name,
      body: c.body,
      durationMinutes: c.timeEntry?.durationMinutes ?? null,
      running: false,
      actionType: c.teamSupportActionType,
      isPublic: c.teamSupportIsPublic,
    })),
    ...task.timeEntries.map((entry) => ({
      id: `time-${entry.id}`,
      commentId: null,
      createdAt: entry.startedAt,
      authorName: entry.user.name,
      body: entry.note,
      durationMinutes: entry.durationMinutes,
      running: !entry.endedAt,
      actionType: null,
      isPublic: false,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const visibleFeedItems = expanded ? feedItems : feedItems.slice(0, COLLAPSED_COUNT);

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
            <div className="flex-between">
              <div className="section-title" style={{ marginBottom: 0 }}>
                {t("taskDetail.comments")}
              </div>
              <div className="gap-8">
                {feedItems.length > COLLAPSED_COUNT && (
                  <button className="btn btn-sm" onClick={() => setExpanded((v) => !v)}>
                    {expanded ? t("common.showLess") : t("common.showMore")}
                  </button>
                )}
                {canWrite && isTimerRunningHere && (
                  <button className="btn btn-sm" onClick={() => stop.mutate(activeTimer!.id)}>
                    {t("taskDetail.stopTimer")}
                  </button>
                )}
              </div>
            </div>
            {visibleFeedItems.map((item) => (
              <div className="comment" key={item.id}>
                <div className="meta">
                  {item.authorName} · {formatRelativeTime(item.createdAt)}
                  {item.durationMinutes != null && <> · {formatMinutes(item.durationMinutes)}</>}
                  {item.running && <> · ({t("taskDetail.running")})</>}
                  {item.actionType && (
                    <span className="badge" style={{ marginLeft: 6 }}>
                      {item.actionType}
                    </span>
                  )}
                  {item.isPublic && (
                    <span className="badge badge-admin" style={{ marginLeft: 6 }}>
                      {t("taskDetail.public")}
                    </span>
                  )}
                  {canWrite && item.commentId && (
                    <button
                      className="remove-link"
                      style={{ marginLeft: 6 }}
                      onClick={() => {
                        if (confirm(t("taskDetail.confirmDeleteComment"))) {
                          deleteComment.mutate(item.commentId!);
                        }
                      }}
                    >
                      {t("projectDetail.remove")}
                    </button>
                  )}
                </div>
                {item.body && <div>{item.body}</div>}
              </div>
            ))}
            {feedItems.length === 0 && <p className="muted">{t("taskDetail.noCommentsYet")}</p>}
            {canWrite && (
              <form onSubmit={handleCommentSubmit} style={{ marginTop: 12 }}>
                <textarea
                  placeholder={t("taskDetail.addAComment")}
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
                  <div className="field">
                    <label>{t("taskDetail.date")}</label>
                    <input type="date" value={commentDate} onChange={(e) => setCommentDate(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>
                      {t("taskDetail.hours")}
                      {project?.teamSupportTicketNumber && (
                        <span className="required-marker"> {t("taskDetail.requiredMarker")}</span>
                      )}
                    </label>
                    <input
                      type="number"
                      min="0.25"
                      max="24"
                      step="0.25"
                      placeholder="e.g. 2.5"
                      value={commentHours}
                      onChange={(e) => setCommentHours(e.target.value)}
                      required={!!project?.teamSupportTicketNumber}
                    />
                  </div>
                </div>
                <div className="field" style={{ marginTop: 8, maxWidth: 200 }}>
                  <label>{t("taskDetail.followUpDate")}</label>
                  <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
                </div>
                {project?.teamSupportTicketNumber && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
                    <div className="field">
                      <label>
                        {t("taskDetail.actionType")} <span className="required-marker">{t("taskDetail.requiredMarker")}</span>
                      </label>
                      <select value={actionTypeId} onChange={(e) => setActionTypeId(e.target.value)} required>
                        <option value="">{t("taskDetail.noActionType")}</option>
                        {(actionTypes ?? []).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>{t("taskDetail.visibility")}</label>
                      <select value={isPublic ? "public" : "private"} onChange={(e) => setIsPublic(e.target.value === "public")}>
                        <option value="private">{t("taskDetail.private")}</option>
                        <option value="public">{t("taskDetail.public")}</option>
                      </select>
                    </div>
                  </div>
                )}
                {commentError && <div className="error-text">{commentError}</div>}
                <button className="btn btn-primary btn-sm" type="submit" disabled={addComment.isPending} style={{ marginTop: 8 }}>
                  {t("taskDetail.postUpdate")}
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
                <span className="gap-8">
                  <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener noreferrer">
                    {a.originalName}
                  </a>
                  <a href={`/api/attachments/${a.id}/download`} className="muted attachment-download-link">
                    {t("common.download")}
                  </a>
                  {canWrite && (
                    <button
                      className="attachment-remove-link"
                      onClick={() => {
                        if (confirm(t("projectDetail.confirmDeleteAttachment", { name: a.originalName }))) {
                          deleteAttachment.mutate(a.id);
                        }
                      }}
                    >
                      {t("projectDetail.remove")}
                    </button>
                  )}
                </span>
                <span className="muted">
                  {(a.size / 1024).toFixed(0)} KB · {a.uploader.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="section-title">{t("taskDetail.details")}</div>
          <div className="field">
            <label>{t("common.status")}</label>
            {canWrite ? (
              <select value={task.status} onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}>
                <option value="TODO">{t("common.statusTodo")}</option>
                <option value="IN_PROGRESS">{t("common.statusInProgress")}</option>
                <option value="DONE">{t("common.statusDone")}</option>
                <option value="NA">{t("common.statusNA")}</option>
              </select>
            ) : (
              <span>{statusLabel(t, task.status)}</span>
            )}
          </div>
          {task.status === "NA" && task.naReason && (
            <div className="field">
              <label>{t("taskDetail.naReasonLabel")}</label>
              <span>{task.naReason}</span>
            </div>
          )}
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
