import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api } from "../api/client";
import type {
  Project,
  ProjectType,
  SavedReport,
  TaskPriority,
  TaskReportColumnKey,
  TaskReportFilters,
  TaskReportResult,
  TaskReportRow,
  TaskStatus,
  UserSummary,
} from "../api/types";
import { UNASSIGNED_SENTINEL } from "../api/types";
import { downloadCsv } from "../utils/csv";
import { formatDate, formatDueDate } from "../utils/format";
import { extractErrorMessage, useAuth } from "../context/AuthContext";

// Canonical display order — a saved/in-progress report's `columns` is a Set, this is what
// turns it back into a stable, predictable column order regardless of check/uncheck order.
export const REPORT_COLUMN_ORDER: TaskReportColumnKey[] = [
  "title",
  "project",
  "projectType",
  "subProject",
  "assignee",
  "status",
  "priority",
  "dueDate",
  "completedAt",
  "daysLate",
  "naReason",
  "createdBy",
  "createdAt",
  "hoursLogged",
];

const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE", "NA"];
const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH"];

function statusLabel(t: TFunction, status: TaskStatus): string {
  if (status === "IN_PROGRESS") return t("common.statusInProgress");
  if (status === "DONE") return t("common.statusDone");
  if (status === "NA") return t("common.statusNA");
  return t("common.statusTodo");
}

function priorityLabel(t: TFunction, priority: TaskPriority): string {
  if (priority === "HIGH") return t("common.priorityHigh");
  if (priority === "LOW") return t("common.priorityLow");
  return t("common.priorityMedium");
}

function columnLabel(t: TFunction, key: TaskReportColumnKey): string {
  return t(`reports.col.${key}`);
}

function cellText(t: TFunction, row: TaskReportRow, key: TaskReportColumnKey): string {
  switch (key) {
    case "title":
      return row.title;
    case "project":
      return row.project.name;
    case "projectType":
      return row.projectType.name;
    case "subProject":
      return row.subProject.name;
    case "assignee":
      return row.assignee?.name ?? t("subProjectDetail.unassigned");
    case "status":
      return statusLabel(t, row.status);
    case "priority":
      return priorityLabel(t, row.priority);
    case "dueDate":
      return formatDueDate(row.dueDate);
    case "completedAt":
      return formatDate(row.completedAt);
    case "daysLate":
      return row.daysLate == null ? "—" : String(row.daysLate);
    case "naReason":
      return row.naReason ?? "—";
    case "createdBy":
      return row.createdBy.name;
    case "createdAt":
      return formatDate(row.createdAt);
    case "hoursLogged":
      return `${row.hoursLogged}h`;
    default:
      return "";
  }
}

function csvValue(t: TFunction, row: TaskReportRow, key: TaskReportColumnKey): string | number {
  if (key === "dueDate") return row.dueDate ?? "";
  if (key === "completedAt") return row.completedAt ?? "";
  if (key === "createdAt") return row.createdAt;
  if (key === "daysLate") return row.daysLate ?? "";
  if (key === "hoursLogged") return row.hoursLogged;
  return cellText(t, row, key);
}

export function useSavedReports() {
  return useQuery({
    queryKey: ["reports", "saved"],
    queryFn: () => api.get<SavedReport[]>("/reports/saved"),
  });
}

function ResultsTable({
  columns,
  result,
  isLoading,
}: {
  columns: TaskReportColumnKey[];
  result: TaskReportResult | undefined;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const ordered = REPORT_COLUMN_ORDER.filter((c) => columns.includes(c));

  if (isLoading) return <p className="muted">{t("common.loading")}</p>;
  if (!result) return null;

  return (
    <div>
      {result.truncated && (
        <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          {t("reports.builderTruncatedNotice", { count: result.rows.length })}
        </p>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              {ordered.map((c) => (
                <th key={c}>{columnLabel(t, c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.id}>
                {ordered.map((c) => (
                  <td key={c}>{cellText(t, r, c)}</td>
                ))}
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={ordered.length || 1} className="muted">
                  {t("reports.builderNoRows")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CheckboxList<T extends string>({
  options,
  selected,
  onToggle,
  labelFor,
}: {
  options: T[];
  selected: T[];
  onToggle: (value: T) => void;
  labelFor: (value: T) => string;
}) {
  return (
    <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}>
      {options.map((opt) => (
        <label key={opt} className="gap-8" style={{ display: "flex", margin: "4px 0", cursor: "pointer" }}>
          <input type="checkbox" checked={selected.includes(opt)} onChange={() => onToggle(opt)} />
          <span>{labelFor(opt)}</span>
        </label>
      ))}
      {options.length === 0 && <p className="muted" style={{ fontSize: 12, margin: 0 }}>—</p>}
    </div>
  );
}

interface BuilderState {
  columns: TaskReportColumnKey[];
  filters: TaskReportFilters;
  sortBy: TaskReportColumnKey;
  sortDir: "asc" | "desc";
}

const DEFAULT_STATE: BuilderState = {
  columns: ["title", "project", "subProject", "assignee", "status", "dueDate"],
  filters: {},
  sortBy: "dueDate",
  sortDir: "asc",
};

function toBuilderState(report: SavedReport): BuilderState {
  return {
    columns: report.columns,
    filters: report.filters,
    sortBy: report.sortBy ?? "dueDate",
    sortDir: report.sortDir ?? "asc",
  };
}

// Both "build a new report" and "edit a saved one" are the same form — editing just starts
// pre-filled and swaps the Save button for Update/Delete.
export function ReportBuilderForm({
  editing,
  onSaved,
  onDeleted,
  onCancel,
}: {
  editing?: SavedReport;
  onSaved: (report: SavedReport) => void;
  onDeleted?: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // Entry into edit mode is already gated to the creator at the list/view level — this is
  // just defense in depth in case that ever changes, so the form itself never lets someone
  // else's report be silently saved over or deleted.
  const canEdit = !editing || editing.createdBy.id === user?.id;
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [state, setState] = useState<BuilderState>(editing ? toBuilderState(editing) : DEFAULT_STATE);
  const [preview, setPreview] = useState<TaskReportResult | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => api.get<UserSummary[]>("/users") });
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: () => api.get<Project[]>("/projects") });
  const { data: projectTypes } = useQuery({
    queryKey: ["project-types"],
    queryFn: () => api.get<ProjectType[]>("/project-types"),
  });

  const previewMutation = useMutation({
    mutationFn: () =>
      api.post<TaskReportResult>("/reports/builder/run", {
        filters: state.filters,
        sortBy: state.sortBy,
        sortDir: state.sortDir,
      }),
    onSuccess: setPreview,
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        columns: state.columns,
        filters: state.filters,
        sortBy: state.sortBy,
        sortDir: state.sortDir,
      };
      return editing
        ? api.patch<SavedReport>(`/reports/saved/${editing.id}`, body)
        : api.post<SavedReport>("/reports/saved", body);
    },
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ["reports", "saved"] });
      onSaved(report);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/reports/saved/${editing!.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports", "saved"] });
      onDeleted?.();
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  function toggleColumn(key: TaskReportColumnKey) {
    setState((s) => ({
      ...s,
      columns: s.columns.includes(key) ? s.columns.filter((c) => c !== key) : [...s.columns, key],
    }));
  }
  function setFilters(patch: Partial<TaskReportFilters>) {
    setState((s) => ({ ...s, filters: { ...s.filters, ...patch } }));
  }
  function toggleInFilter<K extends "statuses" | "priorities" | "assigneeIds" | "projectIds" | "projectTypeIds">(
    key: K,
    value: NonNullable<TaskReportFilters[K]>[number]
  ) {
    setState((s) => {
      const current = (s.filters[key] as string[] | undefined) ?? [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...s, filters: { ...s.filters, [key]: next.length ? next : undefined } };
    });
  }

  const canSave = name.trim().length > 0 && state.columns.length > 0 && canEdit;

  return (
    <div className="card">
      <div className="section-title">{editing ? t("reports.editReport") : t("reports.newReport")}</div>

      <div className="field" style={{ maxWidth: 360, marginBottom: 16 }}>
        <label>{t("reports.reportName")}</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("reports.reportNamePlaceholder")} />
      </div>

      <div className="field" style={{ maxWidth: 480, marginBottom: 16 }}>
        <label>{t("common.description")}</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("reports.reportDescriptionPlaceholder")}
        />
      </div>

      <div className="field" style={{ marginBottom: 16 }}>
        <label>{t("reports.columns")}</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
          {REPORT_COLUMN_ORDER.map((c) => (
            <label key={c} className="gap-8" style={{ display: "flex", cursor: "pointer" }}>
              <input type="checkbox" checked={state.columns.includes(c)} onChange={() => toggleColumn(c)} />
              <span>{columnLabel(t, c)}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div className="field">
          <label>{t("common.status")}</label>
          <CheckboxList
            options={STATUSES}
            selected={state.filters.statuses ?? []}
            onToggle={(v) => toggleInFilter("statuses", v)}
            labelFor={(v) => statusLabel(t, v)}
          />
        </div>
        <div className="field">
          <label>{t("subProjectDetail.priority")}</label>
          <CheckboxList
            options={PRIORITIES}
            selected={state.filters.priorities ?? []}
            onToggle={(v) => toggleInFilter("priorities", v)}
            labelFor={(v) => priorityLabel(t, v)}
          />
        </div>
        <div className="field">
          <label>{t("subProjectDetail.assignee")}</label>
          <CheckboxList
            options={[UNASSIGNED_SENTINEL, ...(users ?? []).map((u) => u.id)]}
            selected={state.filters.assigneeIds ?? []}
            onToggle={(v) => toggleInFilter("assigneeIds", v)}
            labelFor={(v) => (v === UNASSIGNED_SENTINEL ? t("subProjectDetail.unassigned") : (users ?? []).find((u) => u.id === v)?.name ?? v)}
          />
        </div>
        <div className="field">
          <label>{t("reports.project")}</label>
          <CheckboxList
            options={(projects ?? []).map((p) => p.id)}
            selected={state.filters.projectIds ?? []}
            onToggle={(v) => toggleInFilter("projectIds", v)}
            labelFor={(v) => (projects ?? []).find((p) => p.id === v)?.name ?? v}
          />
        </div>
        <div className="field">
          <label>{t("reports.type")}</label>
          <CheckboxList
            options={(projectTypes ?? []).map((pt) => pt.id)}
            selected={state.filters.projectTypeIds ?? []}
            onToggle={(v) => toggleInFilter("projectTypeIds", v)}
            labelFor={(v) => (projectTypes ?? []).find((pt) => pt.id === v)?.name ?? v}
          />
        </div>
      </div>

      <div className="gap-8" style={{ flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
        <div className="field">
          <label>{t("reports.dueFrom")}</label>
          <input type="date" value={state.filters.dueFrom ?? ""} onChange={(e) => setFilters({ dueFrom: e.target.value || undefined })} />
        </div>
        <div className="field">
          <label>{t("reports.dueTo")}</label>
          <input type="date" value={state.filters.dueTo ?? ""} onChange={(e) => setFilters({ dueTo: e.target.value || undefined })} />
        </div>
        <div className="field">
          <label>{t("reports.completedFrom")}</label>
          <input type="date" value={state.filters.completedFrom ?? ""} onChange={(e) => setFilters({ completedFrom: e.target.value || undefined })} />
        </div>
        <div className="field">
          <label>{t("reports.completedTo")}</label>
          <input type="date" value={state.filters.completedTo ?? ""} onChange={(e) => setFilters({ completedTo: e.target.value || undefined })} />
        </div>
        <label className="gap-8" style={{ display: "flex", alignItems: "center", height: 38, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={state.filters.overdueOnly ?? false}
            onChange={(e) => setFilters({ overdueOnly: e.target.checked || undefined })}
          />
          <span>{t("reports.overdueOnly")}</span>
        </label>
      </div>

      <div className="gap-8" style={{ alignItems: "flex-end", marginBottom: 16 }}>
        <div className="field">
          <label>{t("reports.sortBy")}</label>
          <select value={state.sortBy} onChange={(e) => setState((s) => ({ ...s, sortBy: e.target.value as TaskReportColumnKey }))}>
            {REPORT_COLUMN_ORDER.map((c) => (
              <option key={c} value={c}>
                {columnLabel(t, c)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t("reports.sortDir")}</label>
          <select value={state.sortDir} onChange={(e) => setState((s) => ({ ...s, sortDir: e.target.value as "asc" | "desc" }))}>
            <option value="asc">{t("reports.sortAsc")}</option>
            <option value="desc">{t("reports.sortDesc")}</option>
          </select>
        </div>
        <button className="btn btn-sm" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending}>
          {t("reports.preview")}
        </button>
      </div>

      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="gap-8" style={{ marginBottom: preview ? 16 : 0 }}>
        <button className="btn btn-sm btn-primary" disabled={!canSave || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          {editing ? t("common.save") : t("reports.saveReport")}
        </button>
        {editing && canEdit && (
          <button
            className="btn btn-sm btn-danger"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (confirm(t("reports.confirmDeleteReport", { name: editing.name }))) deleteMutation.mutate();
            }}
          >
            {t("common.delete")}
          </button>
        )}
        <button className="btn btn-sm" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>

      {preview && <ResultsTable columns={state.columns} result={preview} isLoading={previewMutation.isPending} />}
    </div>
  );
}

export function SavedReportView({
  report,
  canEdit,
  onEdit,
  onBack,
}: {
  report: SavedReport;
  canEdit: boolean;
  onEdit: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { data: result, isLoading } = useQuery({
    queryKey: ["reports", "saved", report.id, "run"],
    queryFn: () => api.get<TaskReportResult>(`/reports/saved/${report.id}/run`),
  });

  return (
    <div className="card">
      <button className="btn btn-sm" style={{ marginBottom: 12 }} onClick={onBack}>
        {t("reports.backToSavedReports")}
      </button>
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <div>
          <div className="section-title" style={{ marginBottom: 2 }}>
            {report.name}
          </div>
          {report.description && (
            <p className="muted" style={{ fontSize: 13, margin: "4px 0" }}>
              {report.description}
            </p>
          )}
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            {t("reports.createdBy", { name: report.createdBy.name })}
          </p>
        </div>
        <div className="gap-8">
          <button
            className="btn btn-sm"
            disabled={!result || result.rows.length === 0}
            onClick={() =>
              result &&
              downloadCsv(
                `${report.name}.csv`,
                result.rows,
                REPORT_COLUMN_ORDER.filter((c) => report.columns.includes(c)).map((c) => ({
                  header: columnLabel(t, c),
                  value: (r: TaskReportRow) => csvValue(t, r, c),
                }))
              )
            }
          >
            {t("reports.exportCsv")}
          </button>
          {canEdit && (
            <button className="btn btn-sm" onClick={onEdit}>
              {t("common.edit")}
            </button>
          )}
        </div>
      </div>
      <ResultsTable columns={report.columns} result={result} isLoading={isLoading} />
    </div>
  );
}

// The "Saved reports" tab itself — a management list (name, description, who made it, and
// View/Edit/Delete) that swaps in the builder form or the results view in place of the list,
// rather than each report getting its own top-level tab.
type SavedReportsView = { mode: "list" } | { mode: "new" } | { mode: "view" | "edit"; id: string };

export function SavedReportsTab() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: reports, isLoading } = useSavedReports();
  const [view, setView] = useState<SavedReportsView>({ mode: "list" });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/reports/saved/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports", "saved"] }),
  });

  if (view.mode === "new") {
    return <ReportBuilderForm onSaved={(report) => setView({ mode: "view", id: report.id })} onCancel={() => setView({ mode: "list" })} />;
  }

  if (view.mode === "view" || view.mode === "edit") {
    const report = reports?.find((r) => r.id === view.id);
    if (!report) return <p className="muted">{t("common.loading")}</p>;
    const canEdit = report.createdBy.id === user?.id;
    if (view.mode === "edit" && canEdit) {
      return (
        <ReportBuilderForm
          editing={report}
          onSaved={() => setView({ mode: "view", id: report.id })}
          onDeleted={() => setView({ mode: "list" })}
          onCancel={() => setView({ mode: "view", id: report.id })}
        />
      );
    }
    return (
      <SavedReportView
        report={report}
        canEdit={canEdit}
        onEdit={() => setView({ mode: "edit", id: report.id })}
        onBack={() => setView({ mode: "list" })}
      />
    );
  }

  return (
    <div className="card">
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>
          {t("reports.savedReports")}
        </div>
        <button className="btn btn-sm btn-primary" onClick={() => setView({ mode: "new" })}>
          + {t("reports.newReport")}
        </button>
      </div>
      {isLoading && <p className="muted">{t("common.loading")}</p>}
      {reports && (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t("common.name")}</th>
                <th>{t("common.description")}</th>
                <th>{t("reports.createdByColumn")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.description || "—"}</td>
                  <td>{r.createdBy.name}</td>
                  <td>
                    <div className="gap-8">
                      <button className="btn btn-sm" onClick={() => setView({ mode: "view", id: r.id })}>
                        {t("reports.viewReport")}
                      </button>
                      {r.createdBy.id === user?.id && (
                        <>
                          <button className="btn btn-sm" onClick={() => setView({ mode: "edit", id: r.id })}>
                            {t("common.edit")}
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={deleteMutation.isPending}
                            onClick={() => {
                              if (confirm(t("reports.confirmDeleteReport", { name: r.name }))) deleteMutation.mutate(r.id);
                            }}
                          >
                            {t("common.delete")}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {reports.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    {t("reports.noSavedReportsYet")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
