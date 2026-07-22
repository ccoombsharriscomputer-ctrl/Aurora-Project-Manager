import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute, AdminRoute, ProjectLeadRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { RequestAccessPage } from "./pages/RequestAccessPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CalendarPage } from "./pages/CalendarPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { SubProjectDetailPage } from "./pages/SubProjectDetailPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { ProjectTypesPage } from "./pages/ProjectTypesPage";
import { ModulesPage } from "./pages/ModulesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useRealtimeInvalidation } from "./hooks/useRealtimeInvalidation";
import { useApplyTheme } from "./hooks/useApplyTheme";
import { useAuth } from "./context/AuthContext";

function App() {
  useRealtimeInvalidation();
  const { user } = useAuth();
  useApplyTheme(user);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/request-access" element={<RequestAccessPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/projects/:projectId/sub-projects/:subProjectId" element={<SubProjectDetailPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route element={<AdminRoute />}>
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/reports" element={<ReportsPage />} />
          </Route>
          <Route element={<ProjectLeadRoute />}>
            <Route path="/project-types" element={<ProjectTypesPage />} />
            <Route path="/modules" element={<ModulesPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;
