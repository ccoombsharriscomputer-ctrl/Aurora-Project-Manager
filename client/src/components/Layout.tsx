import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { SoftwareLineSwitcher } from "./SoftwareLineSwitcher";

export function Layout() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src="/logo.png" alt="" className="sidebar-brand-logo" />
          Aurora PM
        </div>
        <SoftwareLineSwitcher />
        <NavLink to="/dashboard" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
          {t("layout.dashboard")}
        </NavLink>
        <NavLink to="/projects" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
          {t("layout.projects")}
        </NavLink>
        {(user?.role === "ADMIN" || user?.role === "PROJECT_LEAD") && (
          <NavLink to="/project-types" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
            {t("layout.projectTypes")}
          </NavLink>
        )}
        {(user?.role === "ADMIN" || user?.role === "PROJECT_LEAD") && (
          <NavLink to="/products" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
            {t("layout.products")}
          </NavLink>
        )}
        {user?.role === "ADMIN" && (
          <NavLink to="/admin/users" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
            {t("layout.users")}
          </NavLink>
        )}
        {user?.role === "ADMIN" && (
          <NavLink to="/reports" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
            {t("layout.reports")}
          </NavLink>
        )}
        <NavLink to="/settings" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
          {t("layout.settings")}
        </NavLink>
        <div className="sidebar-footer">
          <div>{user?.name}</div>
          <div>{user?.email}</div>
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => logout()}>
            {t("layout.logOut")}
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
