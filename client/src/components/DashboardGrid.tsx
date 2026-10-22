import { useMemo, type ReactNode } from "react";
import ReactGridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useTranslation } from "react-i18next";
import type { DashboardWidgetEntry, DashboardWidgetKey, DashboardWidgetSize } from "../api/types";
import { GRID_COLS, GRID_MARGIN, GRID_MIN_WIDTH, GRID_ROW_HEIGHT, placeEntries, toGridLayout } from "../utils/dashboardGrid";
import { widgetLabel } from "./DashboardEditBar";

// The Dashboard's cards on a free grid: in edit mode each one can be dragged by its title bar
// and resized from its bottom-right corner, and the others shuffle out of the way. Outside edit
// mode it's the same grid with dragging and resizing switched off, so nothing moves around when
// you switch. On a narrow window there's no room for a grid, so the cards just stack in order.
export function DashboardGrid({
  entries,
  editing,
  renderWidget,
  onLayoutChange,
  onHide,
}: {
  entries: DashboardWidgetEntry[];
  editing: boolean;
  renderWidget: (key: DashboardWidgetKey, size: DashboardWidgetSize) => ReactNode;
  onLayoutChange: (layout: Layout) => void;
  onHide: (key: DashboardWidgetKey) => void;
}) {
  const { t } = useTranslation();
  const { width, containerRef, mounted } = useContainerWidth();
  const placed = useMemo(() => placeEntries(entries), [entries]);
  const layout = useMemo(() => toGridLayout(entries), [entries]);
  const stacked = width < GRID_MIN_WIDTH;

  return (
    <div ref={containerRef}>
      {mounted &&
        (stacked ? (
          <div className="dashboard-stack">
            {editing && <p className="muted">{t("dashboard.needsWiderWindow")}</p>}
            {placed.map((e) => (
              <div key={e.key}>{renderWidget(e.key, e.size)}</div>
            ))}
          </div>
        ) : (
          <ReactGridLayout
            width={width}
            layout={layout}
            gridConfig={{ cols: GRID_COLS, rowHeight: GRID_ROW_HEIGHT, margin: GRID_MARGIN, containerPadding: [0, 0] }}
            dragConfig={{ enabled: editing, handle: ".dash-edit-bar", cancel: ".dash-hide" }}
            resizeConfig={{ enabled: editing, handles: ["se"] }}
            onLayoutChange={onLayoutChange}
          >
            {placed.map((e) => (
              <div key={e.key} className={`dash-cell${editing ? " editing" : ""}`}>
                <div className="dash-cell-inner">
                  {editing && (
                    <div className="dash-edit-bar">
                      <span>⠿ {widgetLabel(t, e.key)}</span>
                      <button type="button" className="dash-hide" onClick={() => onHide(e.key)} title={t("dashboard.hide")}>
                        ✕
                      </button>
                    </div>
                  )}
                  {renderWidget(e.key, e.size)}
                </div>
              </div>
            ))}
          </ReactGridLayout>
        ))}
    </div>
  );
}
