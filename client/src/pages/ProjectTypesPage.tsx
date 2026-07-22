import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { ProjectType } from "../api/types";
import { extractErrorMessage } from "../context/AuthContext";
import { formatDate } from "../utils/format";

function CreateTypeForm() {
  const { t } = useTranslation();
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
        {t("projectTypes.newProjectType")}
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
        <label>{t("common.name")}</label>
        <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>{t("common.description")}</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="gap-8">
        <button className="btn btn-primary" type="submit" disabled={createType.isPending}>
          {t("common.create")}
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

export function ProjectTypesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const { data: types, isLoading } = useQuery({
    queryKey: ["project-types"],
    queryFn: () => api.get<ProjectType[]>("/project-types"),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/project-types/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-types"] }),
  });

  const updateType = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/project-types/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-types"] });
      setEditingId(null);
      setEditError(null);
    },
    onError: (err) => setEditError(extractErrorMessage(err)),
  });

  const deleteType = useMutation({
    mutationFn: (id: string) => api.delete(`/project-types/${id}`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["project-types"] });
      setDeleteErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    onError: (err, id) => setDeleteErrors((prev) => ({ ...prev, [id]: extractErrorMessage(err) })),
  });

  function startEdit(type: ProjectType) {
    setEditingId(type.id);
    setEditName(type.name);
    setEditDescription(type.description ?? "");
    setEditError(null);
  }

  if (isLoading || !types) {
    return <div className="muted">{t("projectTypes.loadingProjectTypes")}</div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t("layout.projectTypes")}</h1>
        <CreateTypeForm />
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        {t("projectTypes.intro")}
      </p>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>{t("common.name")}</th>
              <th>{t("common.description")}</th>
              <th>{t("common.status")}</th>
              <th>{t("common.created")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {types.map((t2) =>
              editingId === t2.id ? (
                <tr key={t2.id}>
                  <td colSpan={5}>
                    <form
                      className="card"
                      style={{ margin: "8px 0" }}
                      onSubmit={(e: FormEvent) => {
                        e.preventDefault();
                        if (!editName.trim()) return;
                        updateType.mutate({
                          id: t2.id,
                          data: { name: editName, description: editDescription || null },
                        });
                      }}
                    >
                      <div className="field">
                        <label>{t("common.name")}</label>
                        <input type="text" required value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>{t("common.description")}</label>
                        <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                      </div>
                      {editError && <div className="error-text">{editError}</div>}
                      <div className="gap-8">
                        <button className="btn btn-sm btn-primary" type="submit" disabled={updateType.isPending}>
                          {t("common.save")}
                        </button>
                        <button className="btn btn-sm" type="button" onClick={() => setEditingId(null)}>
                          {t("common.cancel")}
                        </button>
                      </div>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={t2.id}>
                  <td>{t2.name}</td>
                  <td>{t2.description || "—"}</td>
                  <td>{t2.active ? t("common.active") : t("common.inactive")}</td>
                  <td>{formatDate(t2.createdAt)}</td>
                  <td className="gap-8">
                    <button className="btn btn-sm" onClick={() => startEdit(t2)}>
                      {t("common.edit")}
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => toggleActive.mutate({ id: t2.id, active: !t2.active })}
                    >
                      {t2.active ? t("common.deactivate") : t("common.reactivate")}
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => {
                        if (confirm(t("projectTypes.confirmDeleteType", { name: t2.name }))) {
                          deleteType.mutate(t2.id);
                        }
                      }}
                    >
                      {t("common.delete")}
                    </button>
                    {deleteErrors[t2.id] && <div className="error-text">{deleteErrors[t2.id]}</div>}
                  </td>
                </tr>
              )
            )}
            {types.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {t("projectTypes.noProjectTypesYet")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
