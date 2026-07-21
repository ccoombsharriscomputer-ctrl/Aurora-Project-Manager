import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="auth-page">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

export function AdminRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="auth-page">Loading…</div>;
  }
  if (!user || user.role !== "ADMIN") {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

export function ProjectLeadRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="auth-page">Loading…</div>;
  }
  if (!user || (user.role !== "ADMIN" && user.role !== "PROJECT_LEAD")) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}
