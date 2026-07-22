import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { ChecklistItem, TaskPriority, TaskTemplate } from "../api/types";
import { extractErrorMessage } from "../context/AuthContext";

function priorityLabel(t: (key: string) => string, priority: TaskPriority): string {
  if (priority === "LOW") return t("common.priorityLow");
  if (priority === "HIGH") return t("common.priorityHigh");
  return t("common.priorityMedium");
}

function TaskTemplatesPanel({ checklistItemId }: { checklistItemId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [error, setError] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["task-templates", checklistItemId],
    queryFn: () => api.get<TaskTemplate[]>(`/checklist-items/${checklistItemId}/task-templates`),
  });

  const createTemplate = useMutation({
    mutationFn: () => api.post<TaskTemplate>(`/checklist-items/${checklistItemId}/task-templates`, { title, priority }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-templates", checklistItemId] });
      setTitle("");
      setPriority("MEDIUM");
      setError(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/task-templates/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task-templates", checklistItemId] }),
  });

  return (
    <div style={{ marginLeft: 20, marginTop: 6, marginBottom: 10, paddingLeft: 12, borderLeft: "2px solid var(--border)" }}>
      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        {t("products.taskTemplatesIntro")}
      </p>
      {isLoading && <p className="muted">{t("common.loading")}</p>}
      {templates?.map((template) => (
        <div className="task-list-item" key={template.id}>
          <span>
            {template.title} <span className={`badge priority-${template.priority}`}>{priorityLabel(t, template.priority)}</span>
          </span>
          <span className="gap-8">
            <span className="muted">{template.active ? t("common.active") : t("common.inactive")}</span>
            <button className="btn btn-sm" onClick={() => toggleActive.mutate({ id: template.id, active: !template.active })}>
              {template.active ? t("common.deactivate") : t("common.reactivate")}
            </button>
          </span>
        </div>
      ))}
      {templates?.length === 0 && <p className="muted">{t("products.noTaskTemplatesYet")}</p>}
      <form
        className="gap-8"
        style={{ marginTop: 10 }}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!title.trim()) return;
          createTemplate.mutate();
        }}
      >
        <input type="text" placeholder={t("products.taskTitlePlaceholder")} value={title} onChange={(e) => setTitle(e.target.value)} />
        <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} style={{ width: "auto" }}>
          <option value="LOW">{t("common.priorityLow")}</option>
          <option value="MEDIUM">{t("common.priorityMedium")}</option>
          <option value="HIGH">{t("common.priorityHigh")}</option>
        </select>
        <button className="btn btn-sm btn-primary" type="submit" disabled={createTemplate.isPending}>
          {t("common.add")}
        </button>
      </form>
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

function CreateProductForm() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createItem = useMutation({
    mutationFn: () => api.post<ChecklistItem>("/checklist-items", { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-items"] });
      setName("");
      setError(null);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  return (
    <form
      className="gap-8"
      style={{ marginTop: 12 }}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        createItem.mutate();
      }}
    >
      <input type="text" placeholder={t("products.productNamePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn btn-sm btn-primary" type="submit" disabled={createItem.isPending}>
        {t("products.addProduct")}
      </button>
      {error && <div className="error-text">{error}</div>}
    </form>
  );
}

export function ProductsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  const { data: products, isLoading } = useQuery({
    queryKey: ["checklist-items"],
    queryFn: () => api.get<ChecklistItem[]>("/checklist-items"),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/checklist-items/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["checklist-items"] }),
  });

  const updateItem = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/checklist-items/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-items"] });
      setEditingItemId(null);
    },
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => api.delete(`/checklist-items/${id}`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["checklist-items"] });
      setDeleteErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    onError: (err, id) => setDeleteErrors((prev) => ({ ...prev, [id]: extractErrorMessage(err) })),
  });

  function startEdit(item: ChecklistItem) {
    setEditingItemId(item.id);
    setEditName(item.name);
    setEditDescription(item.description ?? "");
  }

  if (isLoading || !products) {
    return <div className="muted">{t("products.loadingProducts")}</div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t("layout.products")}</h1>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        {t("products.intro")}
      </p>
      <div className="card">
        {products.map((item) => (
          <div key={item.id}>
            {editingItemId === item.id ? (
              <form
                className="card"
                style={{ marginBottom: 8 }}
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  if (!editName.trim()) return;
                  updateItem.mutate({
                    id: item.id,
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
                <div className="gap-8">
                  <button className="btn btn-sm btn-primary" type="submit" disabled={updateItem.isPending}>
                    {t("common.save")}
                  </button>
                  <button className="btn btn-sm" type="button" onClick={() => setEditingItemId(null)}>
                    {t("common.cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <div className="task-list-item">
                <span>{item.name}</span>
                <span className="gap-8">
                  <span className="muted">{item.active ? t("common.active") : t("common.inactive")}</span>
                  <button
                    className="btn btn-sm"
                    onClick={() => setExpandedItemId(expandedItemId === item.id ? null : item.id)}
                  >
                    {expandedItemId === item.id ? t("products.hideTasks") : t("products.manageTasks")}
                  </button>
                  <button className="btn btn-sm" onClick={() => startEdit(item)}>
                    {t("common.edit")}
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => toggleActive.mutate({ id: item.id, active: !item.active })}
                  >
                    {item.active ? t("common.deactivate") : t("common.reactivate")}
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => {
                      if (confirm(t("products.confirmDeleteProduct", { name: item.name }))) {
                        deleteItem.mutate(item.id);
                      }
                    }}
                  >
                    {t("common.delete")}
                  </button>
                </span>
              </div>
            )}
            {deleteErrors[item.id] && <div className="error-text">{deleteErrors[item.id]}</div>}
            {expandedItemId === item.id && <TaskTemplatesPanel checklistItemId={item.id} />}
          </div>
        ))}
        {products.length === 0 && <p className="muted">{t("products.noProductsYetAddFirst")}</p>}
        <CreateProductForm />
      </div>
    </div>
  );
}
