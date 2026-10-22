import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { DashboardWidgetKey } from "../api/types";

export function widgetLabel(t: TFunction, key: DashboardWidgetKey): string {
  if (key === "totalProjects") return t("dashboard.totalProjects");
  if (key === "completedThisWeek") return t("dashboard.completedThisWeek");
  if (key === "hoursLogged") return t("dashboard.widgetHoursLogged");
  if (key === "deadlines") return t("dashboard.widgetDeadlines");
  if (key === "projectProgress") return t("dashboard.projectProgress");
  if (key === "recentActivity") return t("dashboard.recentActivity");
  if (key === "myTasks") return t("dashboard.myTasks");
  return t("dashboard.myProjects");
}

// The strip shown above the Dashboard while it's being rearranged: save/reset/cancel, a one-line
// how-to, and the cards that have been hidden so they can be put back. The cards themselves are
// moved and resized right on the page (see DashboardGrid).
export function DashboardEditBar({
  hidden,
  saving,
  onAdd,
  onSave,
  onReset,
  onCancel,
}: {
  hidden: DashboardWidgetKey[];
  saving: boolean;
  onAdd: (key: DashboardWidgetKey) => void;
  onSave: () => void;
  onReset: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="flex-between" style={{ flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="section-title" style={{ marginBottom: 2 }}>
            {t("dashboard.customizeDashboard")}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {t("dashboard.editHint")}
          </div>
        </div>
        <div className="gap-8">
          <button className="btn btn-sm btn-primary" disabled={saving} onClick={onSave}>
            {t("common.save")}
          </button>
          <button className="btn btn-sm" disabled={saving} onClick={onReset}>
            {t("dashboard.resetToDefault")}
          </button>
          <button className="btn btn-sm" disabled={saving} onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
      {hidden.length > 0 && (
        <div className="gap-8" style={{ marginTop: 12, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {t("dashboard.hiddenWidgets")}:
          </span>
          {hidden.map((key) => (
            <button key={key} className="btn btn-sm" onClick={() => onAdd(key)}>
              + {widgetLabel(t, key)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
