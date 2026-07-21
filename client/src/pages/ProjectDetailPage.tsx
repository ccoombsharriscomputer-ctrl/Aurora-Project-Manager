import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Attachment, ChecklistItem, Project, SubProject, UserSummary } from "../api/types";
import { extractErrorMessage, useAuth } from "../context/AuthContext";

function NewSubProjectForm({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [checklistItemId, setChecklistItemId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Modules are a shared catalog — any module can become a sub-project on any project,
  // regardless of the project's own type.
  const { data: checklistItems } = useQuery({
    queryKey: ["checklist-items"],
    queryFn: () => api.get<ChecklistItem[]>("/checklist-items"),
    enabled: open,
  });

  const activeItems = (checklistItems ?? []).filter((i) => i.active);

  const createSubProject = useMutation({
    mutationFn: () =>
      api.post<SubProject>(`/projects/${projectId}/sub-projects`, {
        checklistItemId,
        name: name || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-sub-projects", projectId] });
      setChecklistItemId("");
      setName("");
      setOpen(false);
      setError(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        New sub-project
      </button>
    );
  }

  return (
    <form
      className="card"
      style={{ marginBottom: 16 }}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!checklistItemId) return;
        createSubProject.mutate();
      }}
    >
      <div className="field">
        <label>Module</label>
        <select value={checklistItemId} onChange={(e) => setChecklistItemId(e.target.value)} required>
          <option value="">Select a module…</option>
          {activeItems.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        {activeItems.length === 0 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            No modules in the catalog yet — add one on the Modules page.
          </p>
        )}
      </div>
      <div className="field">
        <label>Custom name (optional)</label>
        <input
          type="text"
          placeholder="Defaults to the module's name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="gap-8">
        <button className="btn btn-primary" type="submit" disabled={createSubProject.isPending || !checklistItemId}>
          Create
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

function AttachmentsPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: attachments } = useQuery({
    queryKey: ["project-attachments", projectId],
    queryFn: () => api.get<Attachment[]>(`/projects/${projectId}/attachments`),
  });

  const uploadAttachment = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.postForm(`/projects/${projectId}/attachments`, form);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-attachments", projectId] }),
  });

  return (
    <div className="card">
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
      {attachments?.length === 0 && <p className="muted" style={{ marginTop: 12 }}>No attachments yet.</p>}
      {attachments?.map((a) => (
        <div className="task-list-item" key={a.id}>
          <a href={`/api/attachments/${a.id}/download`}>{a.originalName}</a>
          <span className="muted">
            {(a.size / 1024).toFixed(0)} KB · {a.uploader.name}
          </span>
        </div>
      ))}
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

  const { data: subProjects, isLoading: subProjectsLoading } = useQuery({
    queryKey: ["project-sub-projects", projectId],
    queryFn: () => api.get<SubProject[]>(`/projects/${projectId}/sub-projects`),
    enabled: !!projectId,
  });

  const { data: allUsers } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<UserSummary[]>("/users"),
  });

  const deleteProject = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate("/projects");
    },
  });

  const updateProject = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/projects/${projectId}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
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
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {project.projectType.name}
            {project.description ? ` · ${project.description}` : ""}
          </p>
          <div className="gap-8" style={{ marginTop: 8 }}>
            <label style={{ margin: 0 }}>TeamSupport Ticket #</label>
            {canManage ? (
              <input
                type="text"
                placeholder="e.g. 255219"
                defaultValue={project.teamSupportTicketNumber ?? ""}
                style={{ width: 140 }}
                onBlur={(e) => {
                  if (e.target.value !== (project.teamSupportTicketNumber ?? "")) {
                    updateProject.mutate({ teamSupportTicketNumber: e.target.value || null });
                  }
                }}
              />
            ) : (
              <span>{project.teamSupportTicketNumber || "—"}</span>
            )}
          </div>
        </div>
        <div className="gap-8">
          <NewSubProjectForm projectId={project.id} />
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
          {subProjectsLoading && <p className="muted">Loading sub-projects…</p>}
          {!subProjectsLoading && subProjects?.length === 0 && (
            <p className="muted">No sub-projects yet — add one to start creating tasks.</p>
          )}
          <div className="project-grid">
            {subProjects?.map((sp) => {
              const percent = sp.totalTasks === 0 ? 0 : Math.round((sp.doneTasks / sp.totalTasks) * 100);
              return (
                <Link key={sp.id} to={`/projects/${project.id}/sub-projects/${sp.id}`} className="card project-card">
                  <h3>{sp.name || sp.checklistItem.name}</h3>
                  <p>{sp.name ? sp.checklistItem.name : " "}</p>
                  <div className="progress-row-top">
                    <span className="muted">
                      {sp.doneTasks}/{sp.totalTasks} tasks
                    </span>
                    <span className="muted">{percent}%</span>
                  </div>
                  <div className="progress-bar-track">
                    <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        <div>
          <MembersPanel project={project} allUsers={allUsers ?? []} />
          <div style={{ marginTop: 16 }}>
            <AttachmentsPanel projectId={project.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
