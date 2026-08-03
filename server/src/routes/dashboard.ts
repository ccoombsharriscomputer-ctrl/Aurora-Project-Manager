import { Router } from "express";
import { prisma } from "../lib/prisma";
import { effectiveSoftwareLineId, requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

router.get("/summary", async (req, res) => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const lineId = effectiveSoftwareLineId(req.user!);
  // Archived projects drop out of every "what's active right now" view.
  const inLine = { project: { softwareLineId: lineId, archivedAt: null } };

  const [
    totalProjects,
    tasksCompletedThisWeek,
    timeEntriesThisWeek,
    projects,
    myTasks,
    recentActivity,
  ] = await Promise.all([
    prisma.project.count({ where: { softwareLineId: lineId, archivedAt: null } }),
    prisma.task.count({ where: { status: "DONE", updatedAt: { gte: weekAgo }, ...inLine } }),
    prisma.timeEntry.findMany({
      where: { startedAt: { gte: weekAgo }, durationMinutes: { not: null }, task: inLine },
      select: { durationMinutes: true },
    }),
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

  const hoursLoggedThisWeek =
    timeEntriesThisWeek.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0) / 60;

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
    hoursLoggedThisWeek: Math.round(hoursLoggedThisWeek * 10) / 10,
    projectProgress,
    myTasks,
    recentActivity,
  });
});

// Drill-down lists behind the dashboard's clickable stat tiles — each mirrors the exact
// filter used to compute that tile's number in /summary, so the list always matches the count.
router.get("/completed-this-week", async (req, res) => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const lineId = effectiveSoftwareLineId(req.user!);
  const inLine = { project: { softwareLineId: lineId, archivedAt: null } };

  const tasks = await prisma.task.findMany({
    where: { status: "DONE", updatedAt: { gte: weekAgo }, ...inLine },
    orderBy: { updatedAt: "desc" },
    include: {
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
    },
  });
  res.json(tasks);
});

router.get("/time-entries-this-week", async (req, res) => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const lineId = effectiveSoftwareLineId(req.user!);

  const entries = await prisma.timeEntry.findMany({
    where: {
      startedAt: { gte: weekAgo },
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
