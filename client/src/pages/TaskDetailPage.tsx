import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Project, TaskDetail, TaskPriority, TaskStatus, UserSummary } from "../api/types";
import { extractErrorMessage } from "../context/AuthContext";
import { formatDate, formatMinutes, formatRelativeTime } from "../utils/format";
import { useActiveTimer } from "../hooks/useActiveTimer";

export function TaskDetailPage() {
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: task, isLoading } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.get<TaskDetail>(`/tasks/${taskId}`),
    enabled: !!taskId,
  });

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.get<Project>(`/projects/${projectId}`),
    enabled: !!projectId,
  });

  const { activeTimer, stop } = useActiveTimer();

  const [commentBody, setCommentBody] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);

  function invalidateTask() {
    queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }

  const updateTask = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/tasks/${taskId}`, data),
    onSuccess: invalidateTask,
  });

  const deleteTask = useMutation({
    mutationFn: () => api.delete(`/tasks/${taskId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      navigate(`/projects/${projectId}`);
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

  if (isLoading || !task) {
    return <div className="muted">Loading task…</div>;
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
          <Link to={`/projects/${projectId}`} className="muted">
            ← {project?.name ?? "Back to project"}
          </Link>
          <h1 style={{ marginTop: 6 }}>{task.title}</h1>
        </div>
        <button
          className="btn btn-danger"
          onClick={() => {
            if (confirm("Delete this task? This cannot be undone.")) {
              deleteTask.mutate();
            }
          }}
        >
          Delete task
        </button>
      </div>

      <div className="dashboard-grid">
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="field">
              <label>Description</label>
              <textarea
                defaultValue={task.description ?? ""}
                onBlur={(e) => {
                  if (e.target.value !== (task.description ?? "")) {
                    updateTask.mutate({ description: e.target.value || null });
                  }
                }}
              />
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="section-title">Comments</div>
            {task.comments.map((c) => (
              <div className="comment" key={c.id}>
                <div className="meta">
                  {c.author.name} · {formatRelativeTime(c.createdAt)}
                </div>
                <div>{c.body}</div>
              </div>
            ))}
            {task.comments.length === 0 && <p className="muted">No comments yet.</p>}
            <form onSubmit={handleCommentSubmit} style={{ marginTop: 12 }}>
              <textarea
                placeholder="Add a comment…"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
              />
              {commentError && <div className="error-text">{commentError}</div>}
              <button className="btn btn-primary btn-sm" type="submit" disabled={addComment.isPending} style={{ marginTop: 8 }}>
                Comment
              </button>
            </form>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="flex-between">
              <div className="section-title" style={{ marginBottom: 0 }}>
                Attachments
              </div>
              <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploadAttachment.isPending}>
                Upload file
              </button>
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
            {task.attachments.length === 0 && <p className="muted" style={{ marginTop: 12 }}>No attachments yet.</p>}
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
                Time entries
              </div>
              {isTimerRunningHere ? (
                <button className="btn btn-sm" onClick={() => stop.mutate(activeTimer!.id)}>
                  Stop timer
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => startTimer.mutate()}
                  disabled={isTimerRunningElsewhere || startTimer.isPending}
                  title={isTimerRunningElsewhere ? "Stop your other running timer first" : undefined}
                >
                  Start timer
                </button>
              )}
            </div>
            {task.timeEntries.length === 0 && <p className="muted" style={{ marginTop: 12 }}>No time logged yet.</p>}
            {task.timeEntries.map((entry) => (
              <div className="task-list-item" key={entry.id}>
                <span>
                  {entry.user.name} {entry.endedAt ? "" : "(running…)"}
                </span>
                <span className="muted">{formatMinutes(entry.durationMinutes)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="section-title">Details</div>
          <div className="field">
            <label>Status</label>
            <select
              value={task.status}
              onChange={(e) => updateTask.mutate({ status: e.target.value as TaskStatus })}
            >
              <option value="TODO">To Do</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="DONE">Done</option>
            </select>
          </div>
          <div className="field">
            <label>Priority</label>
            <select
              value={task.priority}
              onChange={(e) => updateTask.mutate({ priority: e.target.value as TaskPriority })}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </div>
          <div className="field">
            <label>Assignee</label>
            <select
              value={task.assignee?.id ?? ""}
              onChange={(e) => updateTask.mutate({ assigneeId: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {project?.members.map((m: UserSummary) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Due date</label>
            <input
              type="date"
              defaultValue={task.dueDate ? task.dueDate.slice(0, 10) : ""}
              onChange={(e) =>
                updateTask.mutate({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })
              }
            />
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Created by {task.createdBy.name} · {formatDate(task.createdAt)}
          </div>
        </div>
      </div>
    </div>
  );
}
