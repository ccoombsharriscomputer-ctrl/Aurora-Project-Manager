import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">Aurora PM</div>
        <NavLink to="/dashboard" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
          Dashboard
        </NavLink>
        <NavLink to="/projects" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
          Projects
        </NavLink>
        {(user?.role === "ADMIN" || user?.role === "PROJECT_LEAD") && (
          <NavLink to="/project-types" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
            Project Types
          </NavLink>
        )}
        {(user?.role === "ADMIN" || user?.role === "PROJECT_LEAD") && (
          <NavLink to="/modules" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
            Modules
          </NavLink>
        )}
        {user?.role === "ADMIN" && (
          <NavLink to="/admin/users" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
            Users
          </NavLink>
        )}
        {user?.role === "ADMIN" && (
          <NavLink to="/reports" className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}>
            Reports
          </NavLink>
        )}
        <div className="sidebar-footer">
          <div>{user?.name}</div>
          <div>{user?.email}</div>
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => logout()}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
