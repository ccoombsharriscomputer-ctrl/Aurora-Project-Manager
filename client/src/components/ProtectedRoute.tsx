import { Navigate, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="auth-page">{t("common.loading")}</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

export function AdminRoute() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="auth-page">{t("common.loading")}</div>;
  }
  if (!user || user.role !== "ADMIN") {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

export function ProjectLeadRoute() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="auth-page">{t("common.loading")}</div>;
  }
  if (!user || (user.role !== "ADMIN" && user.role !== "PROJECT_LEAD")) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}
