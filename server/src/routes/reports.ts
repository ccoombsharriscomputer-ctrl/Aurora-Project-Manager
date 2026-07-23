import { Request, Router } from "express";
import { prisma } from "../lib/prisma";
import { effectiveSoftwareLineId, requireAdmin, requireAuth } from "../middleware/auth";
import { computeTaskStats, sumHours, type DateRange } from "../lib/reportStats";

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
      OR: [{ status: { not: "DONE" } }, { status: "DONE", completedAt: { not: null } }],
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

export default router;
