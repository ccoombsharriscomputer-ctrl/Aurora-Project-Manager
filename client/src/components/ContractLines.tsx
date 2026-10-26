import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { ChecklistItem, ContractLine, ContractLineDraft } from "../api/types";
import { extractErrorMessage, useAuth } from "../context/AuthContext";

// Same names as the server's lib/contractCategories.ts.
export const CONTRACT_CATEGORIES = [
  "Project Management",
  "Installation",
  "Data Conversion",
  "Training",
  "Go Live",
  "Support",
  "Other",
] as const;

// Same rate as the server's CONVERSION_RATE_PER_HOUR (lib/contractCategories.ts).
const CONVERSION_RATE_PER_HOUR = 200;

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatHoursValue(hours: number): string {
  return String(Math.round(hours * 100) / 100);
}

function useCategoryLabel() {
  const { t } = useTranslation();
  return (category: string) => t(`contractLines.categories.${category}`, { defaultValue: category });
}

// One line's fields: used to add a new line and to edit an existing one, on the New project form
// and on the project page.
function ContractLineForm({
  initial,
  products,
  submitLabel,
  error,
  pending,
  isNew,
  onSubmit,
  onCancel,
}: {
  initial: ContractLineDraft;
  isNew?: boolean;
  products: ChecklistItem[];
  submitLabel: string;
  error?: string | null;
  pending?: boolean;
  onSubmit: (line: ContractLineDraft) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const categoryLabel = useCategoryLabel();
  const [category, setCategory] = useState(initial.category);
  const [description, setDescription] = useState(initial.description);
  const [checklistItemId, setChecklistItemId] = useState(initial.checklistItemId ?? "");
  const [hours, setHours] = useState(initial.hours != null ? String(initial.hours) : "");
  const [amount, setAmount] = useState(initial.amount != null ? String(initial.amount) : "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const amountValue = amount ? Number(amount) : null;
    // A new conversion line with no hours gets them from its amount, at the conversion rate.
    const hoursValue = hours
      ? Number(hours)
      : isNew && category === "Data Conversion" && amountValue
        ? Math.round((amountValue / CONVERSION_RATE_PER_HOUR) * 100) / 100
        : null;
    onSubmit({
      category,
      description: description.trim(),
      checklistItemId: checklistItemId || null,
      hours: hoursValue,
      amount: amountValue,
    });
  }

  // This sits inside the New project <form>, so its own buttons can't be a nested <form>'s
  // submit; Enter in a field and the Save button both go through the same handler instead.
  return (
    <div
      className="contract-line-form"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") handleSubmit(e as unknown as FormEvent);
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label>{t("contractLines.product")}</label>
          <select value={checklistItemId} onChange={(e) => setChecklistItemId(e.target.value)}>
            <option value="">{t("contractLines.noProduct")}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t("contractLines.category")}</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CONTRACT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>{t("contractLines.description")}</label>
        <input type="text" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label>{t("contractLines.hoursSold")}</label>
          <input type="number" min="0.25" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} />
          {category === "Data Conversion" && <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t("contractLines.conversionHint")}</p>}
        </div>
        <div className="field">
          <label>{t("contractLines.amount")}</label>
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="gap-8">
        <button type="button" className="btn btn-sm btn-primary" disabled={pending || !description.trim()} onClick={handleSubmit}>
          {submitLabel}
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

const EMPTY_LINE: ContractLineDraft = {
  category: "Project Management",
  description: "",
  checklistItemId: null,
  hours: null,
  amount: null,
};

// The lines read from a contract, shown on the New project form for review before the project is
// created. Nothing is saved until the form is submitted.
export function ContractLinesDraftEditor({
  lines,
  products,
  onChange,
}: {
  lines: ContractLineDraft[];
  products: ChecklistItem[];
  onChange: (lines: ContractLineDraft[]) => void;
}) {
  const { t } = useTranslation();
  const categoryLabel = useCategoryLabel();
  // null = nothing open; -1 = adding a new line; otherwise the index being edited.
  const [editing, setEditing] = useState<number | null>(null);
  const productName = (id: string | null) => products.find((p) => p.id === id)?.name ?? t("contractLines.noProduct");

  return (
    <div className="field">
      <label>{t("contractLines.title")}</label>
      <p className="muted" style={{ fontSize: 12, margin: "2px 0 8px" }}>
        {t("contractLines.draftHint")}
      </p>
      {lines.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>{t("contractLines.product")}</th>
              <th>{t("contractLines.category")}</th>
              <th>{t("contractLines.description")}</th>
              <th>{t("contractLines.hoursSold")}</th>
              <th>{t("contractLines.amount")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) =>
              editing === i ? (
                <tr key={i}>
                  <td colSpan={6}>
                    <ContractLineForm
                      initial={line}
                      products={products}
                      submitLabel={t("common.save")}
                      onSubmit={(updated) => {
                        onChange(lines.map((l, j) => (j === i ? updated : l)));
                        setEditing(null);
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={i}>
                  <td>{productName(line.checklistItemId)}</td>
                  <td>{categoryLabel(line.category)}</td>
                  <td>{line.description}</td>
                  <td>{line.hours != null ? formatHoursValue(line.hours) : "—"}</td>
                  <td>{line.amount != null ? money.format(line.amount) : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="remove-link" onClick={() => setEditing(i)}>
                      {t("contractLines.edit")}
                    </button>{" "}
                    <button type="button" className="remove-link" onClick={() => onChange(lines.filter((_, j) => j !== i))}>
                      {t("projectDetail.remove")}
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      )}
      {editing === -1 ? (
        <ContractLineForm
          initial={EMPTY_LINE}
          isNew
          products={products}
          submitLabel={t("contractLines.add")}
          onSubmit={(line) => {
            onChange([...lines, line]);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setEditing(-1)}>
          {t("contractLines.addLine")}
        </button>
      )}
    </div>
  );
}

const OPEN_STORAGE_KEY = "aurora-contract-lines-open";

function hoursText(n: number): string {
  return formatHoursValue(n);
}

// Purple when on track, amber when nearly out, red when over.
function barColor(used: number, sold: number): string {
  if (used > sold) return "var(--danger)";
  if (used / sold >= 0.9) return "#ba7517";
  return "var(--accent-color)";
}

function HoursBar({ used, sold }: { used: number; sold: number }) {
  const percent = Math.min(100, Math.round((used / sold) * 100));
  return (
    <div className="progress-bar-track">
      <div className="progress-bar-fill" style={{ width: `${percent}%`, background: barColor(used, sold) }} />
    </div>
  );
}

// The project page's "Contract lines" card: what was sold, how many hours have been logged against
// it, and what's left. Hours are only tracked on lines that have hours; the others just show their amount.
export function ContractLinesCard({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const categoryLabel = useCategoryLabel();
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null); // a line id, or "new"
  const [error, setError] = useState<string | null>(null);
  // Open or closed is remembered on this device. Starts closed, with a one-line summary in the header.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  function toggleOpen() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_STORAGE_KEY, String(next));
    } catch {
      // Remembering the choice is a nicety; the card still works without it.
    }
  }

  const { data: lines } = useQuery({
    queryKey: ["contract-lines", projectId],
    queryFn: () => api.get<ContractLine[]>(`/projects/${projectId}/contract-lines`),
  });
  const { data: products } = useQuery({
    queryKey: ["checklist-items"],
    queryFn: () => api.get<ChecklistItem[]>("/checklist-items"),
  });

  function done(updated: ContractLine[]) {
    queryClient.setQueryData(["contract-lines", projectId], updated);
    setEditing(null);
    setError(null);
  }

  const save = useMutation({
    mutationFn: (line: ContractLineDraft) =>
      editing === "new"
        ? api.post<ContractLine[]>(`/projects/${projectId}/contract-lines`, line)
        : api.patch<ContractLine[]>(`/projects/${projectId}/contract-lines/${editing}`, line),
    onSuccess: done,
    onError: (err) => setError(extractErrorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (lineId: string) => api.delete<ContractLine[]>(`/projects/${projectId}/contract-lines/${lineId}`),
    onSuccess: done,
    onError: (err) => setError(extractErrorMessage(err)),
  });

  const allProducts = (products ?? []).filter((p) => p.active);
  const allLines = lines ?? [];
  const totalAmount = allLines.reduce((sum, l) => sum + (l.amount ?? 0), 0);
  // Only lines with hours count toward the hour totals.
  const hourLines = allLines.filter((l) => l.hours != null);
  const soldTotal = hourLines.reduce((sum, l) => sum + (l.hours ?? 0), 0);
  const usedTotal = hourLines.reduce((sum, l) => sum + l.hoursUsed, 0);
  const overCount = hourLines.filter((l) => l.hoursUsed > (l.hours ?? 0)).length;

  // Nothing to show on a project with no lines, unless someone can add one.
  if (allLines.length === 0 && !canWrite) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="flex-between">
        <button
          type="button"
          className="contract-lines-toggle"
          onClick={toggleOpen}
          aria-expanded={open}
          title={open ? t("contractLines.collapse") : t("contractLines.expand")}
        >
          <span aria-hidden="true" className="contract-lines-chevron">
            {open ? "▾" : "▸"}
          </span>
          <span className="section-title" style={{ marginBottom: 0 }}>
            {t("contractLines.title")}
          </span>
          {!open && allLines.length > 0 && (
            <span className="contract-lines-summary muted">
              {t("contractLines.linesCount", { count: allLines.length })} · {money.format(totalAmount)}
            </span>
          )}
        </button>
        {canWrite && editing === null && (
          <button
            className="btn btn-sm"
            onClick={() => {
              if (!open) toggleOpen();
              setEditing("new");
            }}
          >
            {t("contractLines.addLine")}
          </button>
        )}
      </div>
      {allLines.length === 0 && editing === null && (
        <p className="muted" style={{ marginTop: 12 }}>
          {t("contractLines.none")}
        </p>
      )}
      {hourLines.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="contract-hours-tiles">
            <div className="contract-hours-tile">
              <div className="label">{t("contractLines.hoursSold")}</div>
              <div className="value">{hoursText(soldTotal)}</div>
              <div className="note">{t("contractLines.linesWithHours", { count: hourLines.length })}</div>
            </div>
            <div className="contract-hours-tile">
              <div className="label">{t("contractLines.hoursUsed")}</div>
              <div className="value">{hoursText(usedTotal)}</div>
              <div className="note">{t("contractLines.percentUsed", { percent: Math.round((usedTotal / soldTotal) * 100) })}</div>
            </div>
            <div className="contract-hours-tile">
              <div className="label">{t("contractLines.hoursLeft")}</div>
              <div className="value">{hoursText(soldTotal - usedTotal)}</div>
              <div className="note" style={overCount > 0 ? { color: "var(--danger)" } : undefined}>
                {overCount > 0 ? t("contractLines.linesOver", { count: overCount }) : " "}
              </div>
            </div>
          </div>
          <HoursBar used={usedTotal} sold={soldTotal} />
        </div>
      )}
      {open && (
        <>
      {allLines.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>{t("contractLines.product")}</th>
                <th>{t("contractLines.category")}</th>
                <th>{t("contractLines.description")}</th>
                <th style={{ minWidth: 150 }}>{t("contractLines.hours")}</th>
                <th>{t("contractLines.amount")}</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {allLines.map((line) =>
                editing === line.id ? (
                  <tr key={line.id}>
                    <td colSpan={6}>
                      <ContractLineForm
                        initial={line}
                        products={allProducts}
                        submitLabel={t("common.save")}
                        error={error}
                        pending={save.isPending}
                        onSubmit={(draft) => save.mutate(draft)}
                        onCancel={() => {
                          setEditing(null);
                          setError(null);
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={line.id}>
                    <td>{line.checklistItem?.name ?? "—"}</td>
                    <td>{categoryLabel(line.category)}</td>
                    <td>{line.description}</td>
                    <td>
                      {line.hours != null ? (
                        <>
                          <div
                            className="muted"
                            style={{ fontSize: 12, marginBottom: 4, ...(line.hoursUsed > line.hours ? { color: "var(--danger)" } : {}) }}
                          >
                            {line.hoursUsed > line.hours
                              ? t("contractLines.hoursOver", {
                                  used: hoursText(line.hoursUsed),
                                  sold: hoursText(line.hours),
                                  over: hoursText(line.hoursUsed - line.hours),
                                })
                              : t("contractLines.hoursOf", {
                                  used: hoursText(line.hoursUsed),
                                  sold: hoursText(line.hours),
                                  left: hoursText(line.hours - line.hoursUsed),
                                })}
                          </div>
                          <HoursBar used={line.hoursUsed} sold={line.hours} />
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{line.amount != null ? money.format(line.amount) : "—"}</td>
                    {canWrite && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="remove-link" onClick={() => setEditing(line.id)}>
                          {t("contractLines.edit")}
                        </button>{" "}
                        <button
                          className="remove-link"
                          onClick={() => {
                            if (confirm(t("contractLines.confirmRemove", { name: line.description }))) remove.mutate(line.id);
                          }}
                        >
                          {t("projectDetail.remove")}
                        </button>
                      </td>
                    )}
                  </tr>
                )
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={{ fontWeight: 600 }}>
                  {t("contractLines.total")}
                </td>
                <td style={{ fontWeight: 600 }}>{money.format(totalAmount)}</td>
                {canWrite && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {editing === "new" && (
        <div style={{ marginTop: 12 }}>
          <ContractLineForm
            initial={EMPTY_LINE}
            isNew
            products={allProducts}
            submitLabel={t("contractLines.add")}
            error={error}
            pending={save.isPending}
            onSubmit={(draft) => save.mutate(draft)}
            onCancel={() => {
              setEditing(null);
              setError(null);
            }}
          />
        </div>
      )}
      {error && editing === null && <div className="error-text">{error}</div>}
      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        {t("contractLines.hint")}
      </p>
        </>
      )}
    </div>
  );
}
