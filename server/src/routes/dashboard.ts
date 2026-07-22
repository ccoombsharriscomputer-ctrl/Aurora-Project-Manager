import { Router } from "express";
import { prisma } from "../lib/prisma";
import { effectiveSoftwareLineId, requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

router.get("/summary", async (req, res) => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const lineId = effectiveSoftwareLineId(req.user!);
  const inLine = { project: { softwareLineId: lineId } };

  const [
    totalProjects,
    totalOpenTasks,
    tasksCompletedThisWeek,
    timeEntriesThisWeek,
    statusCounts,
    projects,
    myTasks,
    recentActivity,
  ] = await Promise.all([
    prisma.project.count({ where: { softwareLineId: lineId } }),
    prisma.task.count({ where: { status: { not: "DONE" }, ...inLine } }),
    prisma.task.count({ where: { status: "DONE", updatedAt: { gte: weekAgo }, ...inLine } }),
    prisma.timeEntry.findMany({
      where: { startedAt: { gte: weekAgo }, durationMinutes: { not: null }, task: inLine },
      select: { durationMinutes: true },
    }),
    prisma.task.groupBy({ by: ["status"], _count: { status: true }, where: inLine }),
    prisma.project.findMany({ where: { softwareLineId: lineId }, select: { id: true, name: true } }),
    prisma.task.findMany({
      where: { assigneeId: req.user!.id, status: { not: "DONE" }, ...inLine },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      include: { project: { select: { id: true, name: true } } },
      take: 20,
    }),
    prisma.activity.findMany({
      where: inLine,
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

  const statusBreakdown = { TODO: 0, IN_PROGRESS: 0, DONE: 0 } as Record<string, number>;
  for (const row of statusCounts) {
    statusBreakdown[row.status] = row._count.status;
  }

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
    totalOpenTasks,
    tasksCompletedThisWeek,
    hoursLoggedThisWeek: Math.round(hoursLoggedThisWeek * 10) / 10,
    statusBreakdown,
    projectProgress,
    myTasks,
    recentActivity,
  });
});

export default router;
