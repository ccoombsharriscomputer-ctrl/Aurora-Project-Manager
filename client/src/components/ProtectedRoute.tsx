import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";

// The only pages a support-line person can open (the server refuses them everything else).
const SUPPORT_ONLY_PATHS = ["/fix-playbooks", "/fix-playbooks/knowledge-base", "/settings"];

export function ProtectedRoute() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  if (loading) {
    return <div className="auth-page">{t("common.loading")}</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.supportOnly && !SUPPORT_ONLY_PATHS.includes(pathname)) {
    return <Navigate to="/fix-playbooks" replace />;
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

// Fix playbooks: admins, plus users an admin has given playbook access.
export function PlaybookEditorRoute() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="auth-page">{t("common.loading")}</div>;
  }
  if (!user || !user.canEditPlaybooks) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

// Knowledge Base import: only users its owner has given it to (not every admin).
export function KbImporterRoute() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="auth-page">{t("common.loading")}</div>;
  }
  if (!user || !user.canImportKb) {
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
