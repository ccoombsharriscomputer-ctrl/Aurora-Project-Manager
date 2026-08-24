import { Request, Router } from "express";
import { prisma } from "../lib/prisma";
import { effectiveSoftwareLineId, requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

// Sunday-through-Saturday, anchored at UTC midnight like every other day boundary in this
// app (see calendar.ts) — matches the calendar's own week-view convention (see the client's
// calendarPeriod.ts startOfWeek) instead of a rolling 7-day lookback.
function startOfWeekUTC(now: Date): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start;
}

router.get("/summary", async (req, res) => {
  const weekStart = startOfWeekUTC(new Date());
  const lineId = effectiveSoftwareLineId(req.user!);
  // Archived projects drop out of every "what's active right now" view.
  const inLine = { project: { softwareLineId: lineId, archivedAt: null } };

  const [
    totalProjects,
    tasksCompletedThisWeek,
    projects,
    myTasks,
    recentActivity,
  ] = await Promise.all([
    prisma.project.count({ where: { softwareLineId: lineId, archivedAt: null } }),
    prisma.task.count({ where: { status: "DONE", updatedAt: { gte: weekStart }, ...inLine } }),
    prisma.project.findMany({ where: { softwareLineId: lineId, archivedAt: null }, select: { id: true, name: true } }),
    prisma.task.findMany({
      where: { assigneeId: req.user!.id, status: { notIn: ["DONE", "NA"] }, ...inLine },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      include: {
        project: { select: { id: true, name: true } },
        subProject: { select: { id: true, name: true, checklistItem: { select: { name: true } } } },
      },
      take: 20,
    }),
    // Activity carries its own softwareLineId (not derived through project), so this stays
    // scoped correctly even for entries whose project/task has since been deleted — except
    // a PROJECT_DELETED entry itself, which has no project left to satisfy "not archived"
    // and so naturally drops off this live feed while still living on in the Activity report.
    prisma.activity.findMany({
      where: { softwareLineId: lineId, project: { archivedAt: null } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        user: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
      },
    }),
  ]);

  const projectProgress = await Promise.all(
    projects.map(async (p) => {
      const [total, done] = await Promise.all([
        prisma.task.count({ where: { projectId: p.id } }),
        prisma.task.count({ where: { projectId: p.id, status: "DONE" } }),
      ]);
      return {
        id: p.id,
        name: p.name,
        totalTasks: total,
        doneTasks: done,
        percent: total === 0 ? 0 : Math.round((done / total) * 100),
      };
    })
  );

  res.json({
    totalProjects,
    tasksCompletedThisWeek,
    projectProgress,
    myTasks,
    recentActivity,
  });
});

// Backs the "Hours logged" dashboard tile, which tracks whatever period the deadlines
// calendar is currently showing (day/week/month) rather than a fixed rolling window.
function parseRangeParam(req: Request, key: "start" | "end", fallback: Date): Date {
  const raw = req.query[key];
  if (typeof raw !== "string") return fallback;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

router.get("/hours-logged", async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const start = parseRangeParam(req, "start", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const end = parseRangeParam(req, "end", new Date());

  const entries = await prisma.timeEntry.findMany({
    where: {
      startedAt: { gte: start, lte: end },
      durationMinutes: { not: null },
      task: { project: { softwareLineId: lineId, archivedAt: null } },
    },
    select: { durationMinutes: true },
  });

  const hours = entries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0) / 60;
  res.json({ hours: Math.round(hours * 10) / 10 });
});

// Drill-down lists behind the dashboard's clickable stat tiles — each mirrors the exact
// filter used to compute that tile's number in /summary, so the list always matches the count.
router.get("/completed-this-week", async (req, res) => {
  const weekStart = startOfWeekUTC(new Date());
  const lineId = effectiveSoftwareLineId(req.user!);
  const inLine = { project: { softwareLineId: lineId, archivedAt: null } };

  const tasks = await prisma.task.findMany({
    where: { status: "DONE", updatedAt: { gte: weekStart }, ...inLine },
    orderBy: { updatedAt: "desc" },
    include: {
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
    },
  });
  res.json(tasks);
});

router.get("/time-entries-this-week", async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const start = parseRangeParam(req, "start", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const end = parseRangeParam(req, "end", new Date());

  const entries = await prisma.timeEntry.findMany({
    where: {
      startedAt: { gte: start, lte: end },
      durationMinutes: { not: null },
      task: { project: { softwareLineId: lineId, archivedAt: null } },
    },
    orderBy: { startedAt: "desc" },
    include: {
      user: { select: { id: true, name: true } },
      task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } },
    },
  });
  res.json(entries);
});

export default router;
