export type UserRole = "ADMIN" | "PROJECT_LEAD" | "MEMBER";
export type ProjectMemberRole = "OWNER" | "MEMBER";
export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";
export type ActivityType =
  | "PROJECT_CREATED"
  | "TASK_CREATED"
  | "TASK_STATUS_CHANGED"
  | "TASK_ASSIGNED"
  | "COMMENT_ADDED"
  | "ATTACHMENT_ADDED"
  | "TIME_LOGGED";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
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
}

export interface ProjectMember extends UserSummary {
  role: ProjectMemberRole;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdBy: UserSummary;
  createdAt: string;
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

export interface SubProject {
  id: string;
  projectId: string;
  name: string | null;
  projectType: ProjectType;
  createdBy: UserSummary;
  createdAt: string;
  totalTasks: number;
  doneTasks: number;
}

export interface SubProjectDetail {
  id: string;
  name: string | null;
  projectType: ProjectType;
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
  taskId: string;
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
  subProject: { id: string; name: string | null; projectType: { id: string; name: string } };
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
