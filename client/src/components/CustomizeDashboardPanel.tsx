import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { CurrentUser, DashboardWidgetEntry, DashboardWidgetKey, DashboardWidgetSize } from "../api/types";
import { DASHBOARD_WIDGET_SIZES, widgetsAllowedForRole } from "../api/types";

function widgetLabel(t: TFunction, key: DashboardWidgetKey): string {
  if (key === "totalProjects") return t("dashboard.totalProjects");
  if (key === "completedThisWeek") return t("dashboard.completedThisWeek");
  if (key === "hoursLogged") return t("dashboard.widgetHoursLogged");
  if (key === "deadlines") return t("dashboard.widgetDeadlines");
  if (key === "projectProgress") return t("dashboard.projectProgress");
  if (key === "recentActivity") return t("dashboard.recentActivity");
  return t("dashboard.myTasks");
}

function sizeLabel(t: TFunction, size: DashboardWidgetSize): string {
  if (size === "S") return t("dashboard.sizeSmall");
  if (size === "L") return t("dashboard.sizeLarge");
  return t("dashboard.sizeMedium");
}

// Inline panel, not a modal — matches how every other in-app editor (FollowUpsPanel, the
// report builder) is a card on the page rather than an overlay; this app has no modal pattern.
export function CustomizeDashboardPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { user, updateUser } = useAuth();
  const queryClient = useQueryClient();
  const allowed = widgetsAllowedForRole(user!.role);
  // Visible widgets keep the user's saved order (and size); anything allowed but not yet in
  // that list (e.g. never customized, or a widget added after they last saved) starts out
  // hidden, appended in catalog order so it's still reachable from the Hidden list below.
  const [visible, setVisible] = useState<DashboardWidgetEntry[]>(
    user!.dashboardLayout.filter((entry) => allowed.includes(entry.key))
  );
  const [dragKey, setDragKey] = useState<DashboardWidgetKey | null>(null);
  const hidden = allowed.filter((key) => !visible.some((entry) => entry.key === key));

  const save = useMutation({
    mutationFn: (layout: DashboardWidgetEntry[] | null) => api.patch<CurrentUser>("/auth/me", { dashboardLayout: layout }),
    onSuccess: (updated) => {
      updateUser(updated);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
  });

  function show(key: DashboardWidgetKey) {
    setVisible((v) => [...v, { key, size: "M" }]);
  }
  function hide(key: DashboardWidgetKey) {
    setVisible((v) => v.filter((entry) => entry.key !== key));
  }
  function setSize(key: DashboardWidgetKey, size: DashboardWidgetSize) {
    setVisible((v) => v.map((entry) => (entry.key === key ? { ...entry, size } : entry)));
  }
  function reorder(dragged: DashboardWidgetKey, target: DashboardWidgetKey) {
    if (dragged === target) return;
    setVisible((v) => {
      const draggedEntry = v.find((entry) => entry.key === dragged)!;
      const next = v.filter((entry) => entry.key !== dragged);
      next.splice(
        next.findIndex((entry) => entry.key === target),
        0,
        draggedEntry
      );
      return next;
    });
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="section-title">{t("dashboard.customizeDashboard")}</div>

      <div className="field" style={{ marginBottom: 16 }}>
        <label>{t("dashboard.visibleWidgets")}</label>
        {visible.length === 0 && <p className="muted" style={{ fontSize: 13, margin: "4px 0" }}>{t("dashboard.noWidgetsVisible")}</p>}
        {visible.map((entry) => (
          <div
            key={entry.key}
            className={`task-list-item${dragKey === entry.key ? " dragging" : ""}`}
            draggable
            onDragStart={() => setDragKey(entry.key)}
            onDragEnd={() => setDragKey(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragKey) reorder(dragKey, entry.key);
            }}
            style={{ cursor: "grab" }}
          >
            <span>⠿ {widgetLabel(t, entry.key)}</span>
            <span className="gap-8">
              <select value={entry.size} onChange={(e) => setSize(entry.key, e.target.value as DashboardWidgetSize)}>
                {DASHBOARD_WIDGET_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {sizeLabel(t, size)}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" onClick={() => hide(entry.key)}>
                {t("dashboard.hide")}
              </button>
            </span>
          </div>
        ))}
      </div>

      {hidden.length > 0 && (
        <div className="field" style={{ marginBottom: 16 }}>
          <label>{t("dashboard.hiddenWidgets")}</label>
          {hidden.map((key) => (
            <div className="task-list-item" key={key}>
              <span>{widgetLabel(t, key)}</span>
              <button className="btn btn-sm" onClick={() => show(key)}>
                {t("dashboard.show")}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="gap-8">
        <button className="btn btn-sm btn-primary" disabled={save.isPending} onClick={() => save.mutate(visible)}>
          {t("common.save")}
        </button>
        <button className="btn btn-sm" disabled={save.isPending} onClick={() => save.mutate(null)}>
          {t("dashboard.resetToDefault")}
        </button>
        <button className="btn btn-sm" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
