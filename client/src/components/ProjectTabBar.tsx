import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useOpenTabs } from "../context/OpenTabsContext";

export function ProjectTabBar() {
  const { t } = useTranslation();
  const { tabs, activeId, closeTab } = useOpenTabs();

  if (tabs.length === 0) return null;

  return (
    <div className="project-tab-bar">
      {tabs.map((tab) => (
        <div key={tab.id} className={`project-tab${tab.id === activeId ? " active" : ""}`}>
          <Link to={`/projects/${tab.id}`} className="project-tab-label">
            {tab.name}
          </Link>
          <button
            type="button"
            className="project-tab-close"
            aria-label={t("layout.closeTab", { name: tab.name })}
            onClick={() => closeTab(tab.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
