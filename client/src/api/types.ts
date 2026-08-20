export type UserRole = "ADMIN" | "PROJECT_LEAD" | "MEMBER" | "READ_ONLY";
export type ProjectMemberRole = "OWNER" | "MEMBER";
export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "NA";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";
export type ThemeMode = "LIGHT" | "DARK" | "SYSTEM";
export type AccentColor = "BLUE" | "GREEN" | "PURPLE" | "ORANGE" | "RED" | "TEAL";
export type Locale = "EN" | "ES" | "FR_CA";
export type ActivityType =
  | "PROJECT_CREATED"
  | "PROJECT_UPDATED"
  | "PROJECT_ARCHIVED"
  | "PROJECT_UNARCHIVED"
  | "PROJECT_DELETED"
  | "SUBPROJECT_DELETED"
  | "TASK_CREATED"
  | "TASK_DELETED"
  | "TASK_STATUS_CHANGED"
  | "TASK_ASSIGNED"
  | "COMMENT_ADDED"
  | "COMMENT_DELETED"
  | "ATTACHMENT_ADDED"
  | "ATTACHMENT_DELETED"
  | "TIME_LOGGED"
  | "FOLLOW_UP_SCHEDULED";

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
  // Lines this user can switch into: every line for an admin, or home + granted for
  // everyone else. Length 1 means there's nothing to switch between.
  accessibleSoftwareLines: SoftwareLine[];
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
  // Extra lines this user can switch into beyond their home softwareLine — only ever
  // non-empty for PROJECT_LEAD/MEMBER roles.
  grantedSoftwareLines: SoftwareLine[];
  teamSupportUserId: string | null;
  // Only meaningful for role ADMIN. If true, this admin gets emailed for every access
  // request regardless of software line; if false, only for lines in accessRequestLines.
  accessRequestNotifyAllLines: boolean;
  accessRequestLines: SoftwareLine[];
}

export interface TeamSupportUser {
  id: string;
  name: string;
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
  order: number;
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
  order: number;
  assignee: UserSummary | null;
  createdBy: UserSummary;
  dueDate: string | null;
  completedAt: string | null;
  naReason: string | null;
  createdAt: string;
  updatedAt: string;
  project?: { id: string; name: string };
  subProject?: { id: string; name: string | null; checklistItem: { name: string } };
  _count?: { comments: number; attachments: number };
}

export interface FollowUpItem {
  id: string;
  // Null for a project-level follow-up — scheduled directly on a project rather than from a
  // task's comment form. Exactly one of task/project context is ever present.
  taskId: string | null;
  taskTitle: string | null;
  dueDate: string;
  completedAt: string | null;
  user: UserSummary;
  project: { id: string; name: string } | null;
}

export interface CalendarResponse {
  tasks: Task[];
  followUps: FollowUpItem[];
}

// A project's own follow-ups list (Inside a project page) — same underlying row as
// FollowUpItem, just without the task/project context fields since they're implied by
// whichever project's list you're looking at.
export interface ProjectFollowUp {
  id: string;
  dueDate: string;
  completedAt: string | null;
  user: UserSummary;
}

export interface Comment {
  id: string;
  taskId: string;
  body: string;
  author: UserSummary;
  createdAt: string;
  teamSupportActionType: string | null;
  teamSupportIsPublic: boolean;
  timeEntry: { id: string; durationMinutes: number | null } | null;
}

export interface TeamSupportActionType {
  id: string;
  name: string;
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
  tasksCompletedThisWeek: number;
  projectProgress: { id: string; name: string; totalTasks: number; doneTasks: number; percent: number }[];
  myTasks: Task[];
  recentActivity: Activity[];
}

export interface HoursLoggedResponse {
  hours: number;
}

interface ReportStats {
  totalTasks: number;
  doneTasks: number;
  openTasks: number;
  naTasks: number;
  overdueOpen: number;
  completedLate: number;
  onTimeRate: number | null;
  avgCompletionDays: number | null;
  hoursLogged: number;
}

export interface UserReportRow extends ReportStats {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  projects: { id: string; name: string }[];
}

export interface ProjectReportRow extends ReportStats {
  id: string;
  name: string;
  projectType: { id: string; name: string };
  members: UserSummary[];
  totalSubProjects: number;
}

export interface ProjectTypeReportRow extends ReportStats {
  id: string;
  name: string;
  totalProjects: number;
}

export interface OverdueTaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  project: { id: string; name: string };
  subProject: { id: string; name: string };
  assignee: UserSummary | null;
  dueDate: string;
  completedAt: string | null;
  daysLate: number;
}

export interface ActivityReport {
  activities: Activity[];
  truncated: boolean;
}

export interface ExtractedProjectDetails {
  name: string | null;
  description: string | null;
  teamSupportTicketNumber: string | null;
  projectTypeId: string | null;
  checklistItemIds: string[];
  notes: string | null;
}

export interface TeamSupportTicket {
  ticketNumber: string;
  name: string;
  status: string;
  severity: string | null;
  groupName: string | null;
  assigneeName: string | null;
}

export type TeamSupportTicketResponse = { linked: false } | { linked: true; ticket: TeamSupportTicket };
