import type { Prisma, TaskPriority, TaskStatus } from "@prisma/client";
import { prisma } from "./prisma";

// The report builder always computes every column for every matching task — `columns` (which
// ones to display, and in what order) is purely a client-side rendering concern, stored
// alongside the query on a saved report but never sent to this query itself. That keeps the
// query shape stable regardless of which columns a user happens to have checked, and means
// toggling a column on/off in the builder never needs a re-fetch.
export const TASK_REPORT_COLUMNS = [
  "title",
  "project",
  "projectType",
  "subProject",
  "assignee",
  "status",
  "priority",
  "dueDate",
  "completedAt",
  "daysLate",
  "naReason",
  "createdBy",
  "createdAt",
  "hoursLogged",
] as const;

export type TaskReportColumnKey = (typeof TASK_REPORT_COLUMNS)[number];

// A pseudo-id for "no assignee" in the assigneeIds filter, alongside real user ids — matches
// how the task board itself treats an unassigned task as a real, filterable state rather than
// an edge case to special-case out.
export const UNASSIGNED_SENTINEL = "UNASSIGNED";

export interface TaskReportFilters {
  statuses?: TaskStatus[];
  priorities?: TaskPriority[];
  assigneeIds?: string[];
  projectIds?: string[];
  projectTypeIds?: string[];
  dueFrom?: string;
  dueTo?: string;
  completedFrom?: string;
  completedTo?: string;
  // Open and past due, or completed after its due date — the same definition /reports/overdue
  // uses. Independent of dueFrom/dueTo/completedFrom/completedTo, which a user can still layer
  // on top for more precision (e.g. "overdue, and due sometime last quarter").
  overdueOnly?: boolean;
}

export interface TaskReportRow {
  id: string;
  title: string;
  project: { id: string; name: string };
  projectType: { id: string; name: string };
  subProject: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  completedAt: string | null;
  daysLate: number | null;
  naReason: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  hoursLogged: number;
}

// Bounded well above any realistic result set, matching /reports/activity's own cap — a
// report this wide is meant for building/exporting, not for showing a runaway query in full.
const REPORT_ROW_LIMIT = 2000;

function endOfDay(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setHours(23, 59, 59, 999);
  return d;
}

function buildWhere(lineId: string, filters: TaskReportFilters): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = { project: { softwareLineId: lineId } };

  if (filters.statuses?.length) where.status = { in: filters.statuses };
  if (filters.priorities?.length) where.priority = { in: filters.priorities };
  if (filters.projectIds?.length) where.projectId = { in: filters.projectIds };
  if (filters.projectTypeIds?.length) where.projectTypeId = { in: filters.projectTypeIds };

  if (filters.assigneeIds?.length) {
    const wantsUnassigned = filters.assigneeIds.includes(UNASSIGNED_SENTINEL);
    const realIds = filters.assigneeIds.filter((id) => id !== UNASSIGNED_SENTINEL);
    if (wantsUnassigned && realIds.length) {
      where.OR = [{ assigneeId: { in: realIds } }, { assigneeId: null }];
    } else if (wantsUnassigned) {
      where.assigneeId = null;
    } else {
      where.assigneeId = { in: realIds };
    }
  }

  if (filters.dueFrom || filters.dueTo) {
    where.dueDate = {
      ...(filters.dueFrom ? { gte: new Date(filters.dueFrom) } : {}),
      ...(filters.dueTo ? { lte: endOfDay(filters.dueTo) } : {}),
    };
  }
  if (filters.completedFrom || filters.completedTo) {
    where.completedAt = {
      ...(filters.completedFrom ? { gte: new Date(filters.completedFrom) } : {}),
      ...(filters.completedTo ? { lte: endOfDay(filters.completedTo) } : {}),
    };
  }

  return where;
}

function sortValue(row: TaskReportRow, key: TaskReportColumnKey): string | number {
  switch (key) {
    case "project":
      return row.project.name.toLowerCase();
    case "projectType":
      return row.projectType.name.toLowerCase();
    case "subProject":
      return row.subProject.name.toLowerCase();
    case "assignee":
      return row.assignee?.name.toLowerCase() ?? "";
    case "createdBy":
      return row.createdBy.name.toLowerCase();
    case "dueDate":
      return row.dueDate ?? "";
    case "completedAt":
      return row.completedAt ?? "";
    case "daysLate":
      return row.daysLate ?? -Infinity;
    case "hoursLogged":
      return row.hoursLogged;
    case "naReason":
      return row.naReason?.toLowerCase() ?? "";
    case "createdAt":
      return row.createdAt;
    default:
      return String(row[key] ?? "").toLowerCase();
  }
}

export async function runTaskReport(
  lineId: string,
  filters: TaskReportFilters,
  sortBy: TaskReportColumnKey = "dueDate",
  sortDir: "asc" | "desc" = "asc"
): Promise<{ rows: TaskReportRow[]; truncated: boolean }> {
  const now = new Date();
  const tasks = await prisma.task.findMany({
    where: buildWhere(lineId, filters),
    include: {
      project: { select: { id: true, name: true } },
      projectType: { select: { id: true, name: true } },
      subProject: { select: { id: true, name: true, checklistItem: { select: { name: true } } } },
      assignee: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      timeEntries: { select: { durationMinutes: true } },
    },
  });

  let rows: TaskReportRow[] = tasks.map((t) => {
    const isOverdue =
      t.status !== "DONE" && t.status !== "NA" && t.dueDate != null && t.dueDate < now;
    const completedLate = t.status === "DONE" && t.completedAt != null && t.dueDate != null && t.completedAt > t.dueDate;
    const daysLate =
      isOverdue && t.dueDate
        ? Math.round((now.getTime() - t.dueDate.getTime()) / 86_400_000)
        : completedLate && t.completedAt && t.dueDate
          ? Math.round((t.completedAt.getTime() - t.dueDate.getTime()) / 86_400_000)
          : null;
    const hoursLogged =
      Math.round((t.timeEntries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0) / 60) * 10) / 10;

    return {
      id: t.id,
      title: t.title,
      project: t.project,
      projectType: t.projectType,
      subProject: { id: t.subProject.id, name: t.subProject.name || t.subProject.checklistItem.name },
      assignee: t.assignee,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      daysLate,
      naReason: t.naReason,
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
      hoursLogged,
    };
  });

  if (filters.overdueOnly) {
    rows = rows.filter((r) => {
      if (r.status === "DONE") return r.daysLate != null && r.completedAt != null && r.dueDate != null && r.completedAt > r.dueDate;
      if (r.status === "NA") return false;
      return r.dueDate != null && r.dueDate < now.toISOString();
    });
  }

  rows.sort((a, b) => {
    const av = sortValue(a, sortBy);
    const bv = sortValue(b, sortBy);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "desc" ? -cmp : cmp;
  });

  const truncated = rows.length > REPORT_ROW_LIMIT;
  return { rows: rows.slice(0, REPORT_ROW_LIMIT), truncated };
}
