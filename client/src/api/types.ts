export type UserRole = "ADMIN" | "PROJECT_LEAD" | "MEMBER" | "READ_ONLY";
export type ProjectMemberRole = "OWNER" | "MEMBER";
export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";
export type ThemeMode = "LIGHT" | "DARK" | "SYSTEM";
export type AccentColor = "BLUE" | "GREEN" | "PURPLE" | "ORANGE" | "RED" | "TEAL";
export type Locale = "EN" | "ES" | "FR_CA";
export type ActivityType =
  | "PROJECT_CREATED"
  | "TASK_CREATED"
  | "TASK_STATUS_CHANGED"
  | "TASK_ASSIGNED"
  | "COMMENT_ADDED"
  | "ATTACHMENT_ADDED"
  | "TIME_LOGGED";

export interface SoftwareLine {
  id: string;
  name: string;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  theme: ThemeMode;
  accentColor: AccentColor;
  locale: Locale;
  softwareLineId: string;
  activeSoftwareLineId: string | null;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
}

export interface AdminUser extends UserSummary {
  role: UserRole;
  active: boolean;
  createdAt: string;
  softwareLine: SoftwareLine;
}

export interface AccessRequest {
  id: string;
  name: string;
  email: string;
  message: string | null;
  status: "PENDING" | "APPROVED" | "DENIED";
  createdAt: string;
  decidedAt: string | null;
  softwareLine: SoftwareLine;
}

export interface ProjectMember extends UserSummary {
  role: ProjectMemberRole;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  teamSupportTicketNumber: string | null;
  projectType: { id: string; name: string };
  createdBy: UserSummary;
  createdAt: string;
  archivedAt: string | null;
  members: ProjectMember[];
  totalTasks: number;
  doneTasks: number;
}

export interface ProjectType {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: string;
}

export interface ChecklistItem {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: string;
}

export interface TaskTemplate {
  id: string;
  checklistItemId: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  active: boolean;
  createdAt: string;
}

export interface SubProject {
  id: string;
  projectId: string;
  name: string | null;
  checklistItem: ChecklistItem;
  createdBy: UserSummary;
  createdAt: string;
  totalTasks: number;
  doneTasks: number;
}

export interface SubProjectDetail {
  id: string;
  name: string | null;
  checklistItem: ChecklistItem;
  createdAt: string;
  project: {
    id: string;
    name: string;
    createdById: string;
    members: ProjectMember[];
  };
}

export interface Task {
  id: string;
  projectId: string;
  subProjectId: string;
  projectTypeId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: UserSummary | null;
  createdBy: UserSummary;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  project?: { id: string; name: string };
  _count?: { comments: number; attachments: number };
}

export interface Comment {
  id: string;
  taskId: string;
  body: string;
  author: UserSummary;
  createdAt: string;
}

export interface Attachment {
  id: string;
  taskId: string | null;
  projectId: string | null;
  originalName: string;
  mimeType: string;
  size: number;
  uploader: UserSummary;
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  taskId: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  note: string | null;
  user: UserSummary;
  task?: { id: string; title: string; project: { id: string; name: string } };
}

export interface TaskDetail extends Task {
  project: { id: string; name: string };
  subProject: { id: string; name: string | null; checklistItem: { id: string; name: string } };
  comments: Comment[];
  attachments: Attachment[];
  timeEntries: TimeEntry[];
}

export interface Activity {
  id: string;
  type: ActivityType;
  message: string;
  createdAt: string;
  user: UserSummary;
  project: { id: string; name: string } | null;
  task: { id: string; title: string } | null;
}

export interface DashboardSummary {
  totalProjects: number;
  totalOpenTasks: number;
  tasksCompletedThisWeek: number;
  hoursLoggedThisWeek: number;
  statusBreakdown: Record<TaskStatus, number>;
  projectProgress: { id: string; name: string; totalTasks: number; doneTasks: number; percent: number }[];
  myTasks: Task[];
  recentActivity: Activity[];
}

export interface UserReportRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  projects: { id: string; name: string }[];
  openTasks: number;
  doneTasks: number;
  hoursLogged: number;
}

export interface ProjectReportRow {
  id: string;
  name: string;
  projectType: { id: string; name: string };
  members: UserSummary[];
  totalSubProjects: number;
  totalTasks: number;
  doneTasks: number;
  openTasks: number;
  hoursLogged: number;
}

export interface ProjectTypeReportRow {
  id: string;
  name: string;
  totalProjects: number;
  totalTasks: number;
  doneTasks: number;
  openTasks: number;
  hoursLogged: number;
}
