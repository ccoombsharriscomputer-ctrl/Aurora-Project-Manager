import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { ChecklistItem, ExtractedProjectDetails, Project, ProjectType, UserSummary } from "../api/types";
import { extractErrorMessage, useAuth } from "../context/AuthContext";

export function ProjectsPage() {
  const { t } = useTranslation();
  const { user, canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [filterProjectTypeId, setFilterProjectTypeId] = useState("");
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects", showArchived],
    queryFn: () => api.get<Project[]>(`/projects${showArchived ? "?includeArchived=true" : ""}`),
  });

  const { data: projectTypes } = useQuery({
    queryKey: ["project-types"],
    queryFn: () => api.get<ProjectType[]>("/project-types"),
  });

  const { data: products } = useQuery({
    queryKey: ["checklist-items"],
    queryFn: () => api.get<ChecklistItem[]>("/checklist-items"),
  });

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<UserSummary[]>("/users"),
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [teamSupportTicketNumber, setTeamSupportTicketNumber] = useState("");
  const [projectTypeId, setProjectTypeId] = useState("");
  const [checklistItemIds, setChecklistItemIds] = useState<string[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [contractError, setContractError] = useState<string | null>(null);
  const [contractNotes, setContractNotes] = useState<string | null>(null);
  const contractInputRef = useRef<HTMLInputElement>(null);

  const activeTypes = (projectTypes ?? []).filter((t) => t.active);
  const activeProducts = (products ?? []).filter((p) => p.active);
  const otherUsers = (users ?? []).filter((u) => u.id !== user?.id);
  const filteredProjects = (projects ?? []).filter(
    (p) => !filterProjectTypeId || p.projectType.id === filterProjectTypeId
  );

  function toggleProduct(id: string) {
    setChecklistItemIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  }

  function toggleMember(id: string) {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  }

  const allMembersSelected = otherUsers.length > 0 && otherUsers.every((u) => memberIds.includes(u.id));

  function toggleAllMembers() {
    setMemberIds(allMembersSelected ? [] : otherUsers.map((u) => u.id));
  }

  const createProject = useMutation({
    mutationFn: () =>
      api.post<Project>("/projects", {
        name,
        description: description || undefined,
        teamSupportTicketNumber: teamSupportTicketNumber || undefined,
        projectTypeId,
        checklistItemIds,
        memberIds,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setName("");
      setDescription("");
      setTeamSupportTicketNumber("");
      setProjectTypeId("");
      setChecklistItemIds([]);
      setMemberIds([]);
      setShowForm(false);
      setError(null);
      setContractNotes(null);
      setContractError(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const parseContract = useMutation({
    mutationFn: (form: FormData) => api.postForm<ExtractedProjectDetails>("/projects/parse-contract", form),
    onSuccess: (result) => {
      if (result.name) setName(result.name);
      if (result.description) setDescription(result.description);
      if (result.teamSupportTicketNumber) setTeamSupportTicketNumber(result.teamSupportTicketNumber);
      if (result.projectTypeId) setProjectTypeId(result.projectTypeId);
      if (result.checklistItemIds.length > 0) setChecklistItemIds(result.checklistItemIds);
      setContractNotes(result.notes);
      setContractError(null);
    },
    onError: (err) => setContractError(extractErrorMessage(err)),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!projectTypeId) return;
    createProject.mutate();
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t("layout.projects")}</h1>
        <div className="gap-8">
          <select value={filterProjectTypeId} onChange={(e) => setFilterProjectTypeId(e.target.value)}>
            <option value="">{t("projects.allProjectTypes")}</option>
            {(projectTypes ?? []).map((pt) => (
              <option key={pt.id} value={pt.id}>
                {pt.name}
              </option>
            ))}
          </select>
          <label className="gap-8" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <span>{t("projects.showArchived")}</span>
          </label>
          {canWrite && (
            <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? t("common.cancel") : t("projects.newProject")}
            </button>
          )}
        </div>
      </div>

      {showForm && canWrite && (
        <form className="card" style={{ marginBottom: 20 }} onSubmit={handleSubmit}>
          <div className="field" style={{ paddingBottom: 16, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
            <label>{t("projects.fillFromContract")}</label>
            <p className="muted" style={{ fontSize: 12, margin: "2px 0 8px" }}>
              {t("projects.fillFromContractHint")}
            </p>
            <input
              ref={contractInputRef}
              type="file"
              accept="application/pdf"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const form = new FormData();
                  form.append("file", file);
                  parseContract.mutate(form);
                }
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => contractInputRef.current?.click()}
              disabled={parseContract.isPending}
            >
              {parseContract.isPending ? t("projects.extractingContract") : t("projects.uploadContract")}
            </button>
            {contractError && (
              <div className="error-text" style={{ marginTop: 8 }}>
                {contractError}
              </div>
            )}
            {contractNotes && (
              <p className="muted" style={{ fontSize: 12, marginTop: 8, fontStyle: "italic" }}>
                {contractNotes}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="name">{t("common.name")}</label>
            <input id="name" type="text" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="projectType">{t("projects.projectType")}</label>
            <select
              id="projectType"
              required
              value={projectTypeId}
              onChange={(e) => setProjectTypeId(e.target.value)}
            >
              <option value="">{t("projects.selectProjectType")}</option>
              {activeTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {activeTypes.length === 0 && (
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {t("projects.noProjectTypesYet")}
              </p>
            )}
          </div>
          <div className="gap-8" style={{ display: "flex", alignItems: "flex-start" }}>
            <div className="field" style={{ flex: 1 }}>
              <label>{t("projects.productsToInclude")}</label>
              {activeProducts.length === 0 && (
                <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  {t("projects.noProductsYet")}
                </p>
              )}
              {activeProducts.map((p) => (
                <label key={p.id} className="gap-8" style={{ display: "flex", margin: "4px 0", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={checklistItemIds.includes(p.id)}
                    onChange={() => toggleProduct(p.id)}
                  />
                  <span>{p.name}</span>
                </label>
              ))}
            </div>
            <div className="field" style={{ flex: 1 }}>
              <div className="flex-between">
                <label>{t("projects.membersToAdd")}</label>
                {otherUsers.length > 0 && (
                  <button type="button" className="btn btn-sm" onClick={toggleAllMembers}>
                    {allMembersSelected ? t("projects.clearAll") : t("projects.selectAll")}
                  </button>
                )}
              </div>
              {otherUsers.length === 0 && (
                <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  {t("projects.noOtherUsersYet")}
                </p>
              )}
              {otherUsers.map((u) => (
                <label key={u.id} className="gap-8" style={{ display: "flex", margin: "4px 0", cursor: "pointer" }}>
                  <input type="checkbox" checked={memberIds.includes(u.id)} onChange={() => toggleMember(u.id)} />
                  <span>{u.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="description">{t("common.description")}</label>
            <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="teamSupportTicketNumber">{t("projects.teamSupportTicketNumber")}</label>
            <input
              id="teamSupportTicketNumber"
              type="text"
              value={teamSupportTicketNumber}
              onChange={(e) => setTeamSupportTicketNumber(e.target.value)}
            />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={createProject.isPending || !projectTypeId}>
            {t("projects.createProject")}
          </button>
        </form>
      )}

      {isLoading && <p className="muted">{t("projects.loadingProjects")}</p>}
      {!isLoading && projects?.length === 0 && <p className="muted">{t("projects.noProjectsYet")}</p>}
      {!isLoading && (projects?.length ?? 0) > 0 && filteredProjects.length === 0 && (
        <p className="muted">{t("projects.noProjectsMatchFilter")}</p>
      )}

      <div className="project-grid">
        {filteredProjects.map((p) => {
          const percent = p.totalTasks === 0 ? 0 : Math.round((p.doneTasks / p.totalTasks) * 100);
          return (
            <Link key={p.id} to={`/projects/${p.id}`} className="card project-card">
              <div className="flex-between">
                <h3>{p.name}</h3>
                {p.archivedAt && <span className="badge badge-archived">{t("projects.archived")}</span>}
              </div>
              <p className="muted" style={{ fontSize: 12, margin: "-4px 0 8px" }}>
                {p.projectType.name}
              </p>
              <p>{p.description || t("projects.noDescription")}</p>
              <div className="progress-row-top">
                <span className="muted">{t("dashboard.tasksCount", { done: p.doneTasks, total: p.totalTasks })}</span>
                <span className="muted">{percent}%</span>
              </div>
              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                {t("projects.memberCount", { count: p.members.length })}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
