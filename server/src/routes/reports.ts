import { Request, Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { effectiveSoftwareLineId, requireAdmin, requireAuth } from "../middleware/auth";
import { computeTaskStats, sumHours, type DateRange } from "../lib/reportStats";
import { runTaskReport, TASK_REPORT_COLUMNS, type TaskReportColumnKey, type TaskReportFilters } from "../lib/reportBuilder";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

function parseUserId(req: Request): string | undefined {
  return typeof req.query.userId === "string" && req.query.userId.length > 0 ? req.query.userId : undefined;
}

function parseDateRange(req: Request): DateRange {
  const fromStr = typeof req.query.from === "string" ? req.query.from : undefined;
  const toStr = typeof req.query.to === "string" ? req.query.to : undefined;
  const from = fromStr ? new Date(fromStr) : undefined;
  let to: Date | undefined;
  if (toStr) {
    to = new Date(toStr);
    to.setHours(23, 59, 59, 999);
  }
  return { from, to };
}

const taskSelect = { status: true, dueDate: true, completedAt: true, createdAt: true } as const;
const timeEntrySelect = { durationMinutes: true, startedAt: true } as const;

// Row set is "users who are actually members of a project in this line" rather than
// "users whose home line is this line" — an admin's home line can differ from wherever
// they're currently active, and this way their real activity still surfaces correctly.
router.get("/by-user", async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const userId = parseUserId(req);
  const range = parseDateRange(req);
  const inLine = { project: { softwareLineId: lineId } };

  const memberships = await prisma.projectMember.findMany({
    where: inLine,
    select: { userId: true },
    distinct: ["userId"],
  });
  const memberIds = memberships.map((m) => m.userId);
  const targetIds = userId ? memberIds.filter((id) => id === userId) : memberIds;

  const users = await prisma.user.findMany({
    where: { id: { in: targetIds }, active: true },
    orderBy: { name: "asc" },
    include: {
      projectMemberships: { where: inLine, include: { project: { select: { id: true, name: true } } } },
      assignedTasks: { where: inLine, select: taskSelect },
      timeEntries: { where: { task: inLine }, select: timeEntrySelect },
    },
  });

  const rows = users.map((u) => {
    const stats = computeTaskStats(u.assignedTasks, range);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      projects: u.projectMemberships.map((m) => m.project),
      ...stats,
      hoursLogged: sumHours(u.timeEntries, range),
    };
  });

  res.json(rows);
});

router.get("/by-project", async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const userId = parseUserId(req);
  const range = parseDateRange(req);

  const projects = await prisma.project.findMany({
    where: { softwareLineId: lineId, ...(userId ? { members: { some: { userId } } } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      projectType: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true } } } },
      _count: { select: { subProjects: true } },
    },
  });

  const rows = await Promise.all(
    projects.map(async (p) => {
      const [tasks, entries] = await Promise.all([
        prisma.task.findMany({
          where: { projectId: p.id, ...(userId ? { assigneeId: userId } : {}) },
          select: taskSelect,
        }),
        prisma.timeEntry.findMany({
          where: { task: { projectId: p.id }, ...(userId ? { userId } : {}) },
          select: timeEntrySelect,
        }),
      ]);
      const stats = computeTaskStats(tasks, range);
      return {
        id: p.id,
        name: p.name,
        projectType: p.projectType,
        members: p.members.map((m) => m.user),
        totalSubProjects: p._count.subProjects,
        ...stats,
        hoursLogged: sumHours(entries, range),
      };
    })
  );

  res.json(rows);
});

router.get("/by-project-type", async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const userId = parseUserId(req);
  const range = parseDateRange(req);

  const types = await prisma.projectType.findMany({
    where: {
      softwareLineId: lineId,
      ...(userId ? { projects: { some: { members: { some: { userId } } } } } : {}),
    },
    orderBy: { name: "asc" },
    include: { _count: { select: { projects: true } } },
  });

  const rows = await Promise.all(
    types.map(async (t) => {
      const [tasks, entries] = await Promise.all([
        prisma.task.findMany({
          where: { projectTypeId: t.id, ...(userId ? { assigneeId: userId } : {}) },
          select: taskSelect,
        }),
        prisma.timeEntry.findMany({
          where: { task: { projectTypeId: t.id }, ...(userId ? { userId } : {}) },
          select: timeEntrySelect,
        }),
      ]);
      const stats = computeTaskStats(tasks, range);
      return {
        id: t.id,
        name: t.name,
        totalProjects: t._count.projects,
        ...stats,
        hoursLogged: sumHours(entries, range),
      };
    })
  );

  res.json(rows);
});

// Overdue = open tasks past their due date, plus DONE tasks completed after their due date.
// Prisma can't compare two columns in a where clause, so the completedAt > dueDate check
// happens in JS after a broad fetch.
router.get("/overdue", async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const userId = parseUserId(req);
  const range = parseDateRange(req);
  const now = new Date();
  const hasRange = Boolean(range.from || range.to);

  const tasks = await prisma.task.findMany({
    where: {
      project: { softwareLineId: lineId },
      ...(userId ? { assigneeId: userId } : {}),
      dueDate: { not: null },
      OR: [{ status: { notIn: ["DONE", "NA"] } }, { status: "DONE", completedAt: { not: null } }],
    },
    include: {
      project: { select: { id: true, name: true } },
      subProject: { select: { id: true, name: true, checklistItem: { select: { name: true } } } },
      assignee: { select: { id: true, name: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  const rows = tasks
    .filter((t) => {
      if (t.status !== "DONE") return t.dueDate! < now;
      if (!t.completedAt || t.completedAt <= t.dueDate!) return false;
      if (hasRange) {
        if (range.from && t.completedAt < range.from) return false;
        if (range.to && t.completedAt > range.to) return false;
      }
      return true;
    })
    .map((t) => {
      const referenceDate = t.status === "DONE" ? t.completedAt! : now;
      const daysLate = Math.round((referenceDate.getTime() - t.dueDate!.getTime()) / 86_400_000);
      return {
        id: t.id,
        title: t.title,
        status: t.status,
        project: t.project,
        subProject: { id: t.subProject.id, name: t.subProject.name || t.subProject.checklistItem.name },
        assignee: t.assignee,
        dueDate: t.dueDate,
        completedAt: t.completedAt,
        daysLate,
      };
    });

  res.json(rows);
});

const ACTIVITY_TYPES = [
  "PROJECT_CREATED",
  "PROJECT_DELETED",
  "SUBPROJECT_DELETED",
  "TASK_CREATED",
  "TASK_DELETED",
  "TASK_STATUS_CHANGED",
  "TASK_ASSIGNED",
  "COMMENT_ADDED",
  "ATTACHMENT_ADDED",
  "ATTACHMENT_DELETED",
  "TIME_LOGGED",
] as const;

// Audit trail: every logged activity in the line, newest first. Capped well above any
// realistic page size — if a filter combination still hits the cap, `truncated` tells the
// caller to narrow further rather than silently dropping rows.
const ACTIVITY_LIMIT = 1000;

router.get("/activity", async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const userId = parseUserId(req);
  const range = parseDateRange(req);
  const typeParam = typeof req.query.type === "string" ? req.query.type : undefined;
  const type = (ACTIVITY_TYPES as readonly string[]).includes(typeParam ?? "")
    ? (typeParam as (typeof ACTIVITY_TYPES)[number])
    : undefined;

  const activities = await prisma.activity.findMany({
    where: {
      softwareLineId: lineId,
      ...(userId ? { userId } : {}),
      ...(type ? { type } : {}),
      ...(range.from || range.to
        ? {
            createdAt: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: ACTIVITY_LIMIT + 1,
    include: {
      user: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      task: { select: { id: true, title: true } },
    },
  });

  res.json({
    activities: activities.slice(0, ACTIVITY_LIMIT),
    truncated: activities.length > ACTIVITY_LIMIT,
  });
});

// --- Report builder ---

const columnSchema = z.enum(TASK_REPORT_COLUMNS);

const filtersSchema = z.object({
  statuses: z.array(z.enum(["TODO", "IN_PROGRESS", "DONE", "NA"])).optional(),
  priorities: z.array(z.enum(["LOW", "MEDIUM", "HIGH"])).optional(),
  assigneeIds: z.array(z.string()).optional(),
  projectIds: z.array(z.string()).optional(),
  projectTypeIds: z.array(z.string()).optional(),
  dueFrom: z.string().optional(),
  dueTo: z.string().optional(),
  completedFrom: z.string().optional(),
  completedTo: z.string().optional(),
  overdueOnly: z.boolean().optional(),
}) satisfies z.ZodType<TaskReportFilters>;

const runSchema = z.object({
  filters: filtersSchema,
  sortBy: columnSchema.optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

// Runs a report ad hoc, without saving it — how the builder's live preview works. `columns`
// isn't part of this request at all: which columns to display is a client-side rendering
// choice over the same always-complete row shape (see reportBuilder.ts).
router.post("/builder/run", async (req, res) => {
  const parsed = runSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const lineId = effectiveSoftwareLineId(req.user!);
  const result = await runTaskReport(lineId, parsed.data.filters, parsed.data.sortBy, parsed.data.sortDir);
  res.json(result);
});

const savedReportSchema = z.object({
  name: z.string().min(1).max(120),
  columns: z.array(columnSchema).min(1),
  filters: filtersSchema,
  sortBy: columnSchema.optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

// Any admin in this line can see, run, edit, or delete any report saved in it — Reports is
// already admin-only, so this is a shared catalog the same way Project Types and Products are,
// not a personal list scoped to whoever created each one.
router.get("/saved", async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const reports = await prisma.savedReport.findMany({
    where: { softwareLineId: lineId },
    orderBy: { name: "asc" },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  res.json(reports);
});

router.post("/saved", async (req, res) => {
  const parsed = savedReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const lineId = effectiveSoftwareLineId(req.user!);
  const report = await prisma.savedReport.create({
    data: {
      name: parsed.data.name,
      columns: parsed.data.columns,
      filters: parsed.data.filters,
      sortBy: parsed.data.sortBy,
      sortDir: parsed.data.sortDir,
      softwareLineId: lineId,
      createdById: req.user!.id,
    },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  res.status(201).json(report);
});

router.patch("/saved/:id", async (req, res) => {
  const parsed = savedReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const lineId = effectiveSoftwareLineId(req.user!);
  const existing = await prisma.savedReport.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.softwareLineId !== lineId) {
    return res.status(404).json({ error: "Report not found" });
  }
  const report = await prisma.savedReport.update({
    where: { id: req.params.id },
    data: {
      name: parsed.data.name,
      columns: parsed.data.columns,
      filters: parsed.data.filters,
      sortBy: parsed.data.sortBy,
      sortDir: parsed.data.sortDir,
    },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  res.json(report);
});

router.delete("/saved/:id", async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const existing = await prisma.savedReport.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.softwareLineId !== lineId) {
    return res.status(404).json({ error: "Report not found" });
  }
  await prisma.savedReport.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

router.get("/saved/:id/run", async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const existing = await prisma.savedReport.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.softwareLineId !== lineId) {
    return res.status(404).json({ error: "Report not found" });
  }
  const result = await runTaskReport(
    lineId,
    existing.filters as TaskReportFilters,
    existing.sortBy as TaskReportColumnKey | undefined,
    existing.sortDir as "asc" | "desc" | undefined
  );
  res.json(result);
});

export default router;
