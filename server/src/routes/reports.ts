import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

function toHours(minutes: number | null | undefined): number {
  return Math.round(((minutes ?? 0) / 60) * 10) / 10;
}

router.get("/by-user", async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    include: {
      projectMemberships: { include: { project: { select: { id: true, name: true } } } },
      assignedTasks: { select: { status: true } },
      timeEntries: { select: { durationMinutes: true } },
    },
  });

  const rows = users.map((u) => {
    const openTasks = u.assignedTasks.filter((t) => t.status !== "DONE").length;
    const doneTasks = u.assignedTasks.filter((t) => t.status === "DONE").length;
    const totalMinutes = u.timeEntries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      projects: u.projectMemberships.map((m) => m.project),
      openTasks,
      doneTasks,
      hoursLogged: toHours(totalMinutes),
    };
  });

  res.json(rows);
});

router.get("/by-project", async (_req, res) => {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      projectType: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true } } } },
      _count: { select: { subProjects: true } },
    },
  });

  const rows = await Promise.all(
    projects.map(async (p) => {
      const [totalTasks, doneTasks, timeAgg] = await Promise.all([
        prisma.task.count({ where: { projectId: p.id } }),
        prisma.task.count({ where: { projectId: p.id, status: "DONE" } }),
        prisma.timeEntry.aggregate({
          where: { task: { projectId: p.id } },
          _sum: { durationMinutes: true },
        }),
      ]);
      return {
        id: p.id,
        name: p.name,
        projectType: p.projectType,
        members: p.members.map((m) => m.user),
        totalSubProjects: p._count.subProjects,
        totalTasks,
        doneTasks,
        openTasks: totalTasks - doneTasks,
        hoursLogged: toHours(timeAgg._sum.durationMinutes),
      };
    })
  );

  res.json(rows);
});

router.get("/by-project-type", async (_req, res) => {
  const types = await prisma.projectType.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { projects: true } } },
  });

  const rows = await Promise.all(
    types.map(async (t) => {
      const [totalTasks, doneTasks, timeAgg] = await Promise.all([
        prisma.task.count({ where: { projectTypeId: t.id } }),
        prisma.task.count({ where: { projectTypeId: t.id, status: "DONE" } }),
        prisma.timeEntry.aggregate({
          where: { task: { projectTypeId: t.id } },
          _sum: { durationMinutes: true },
        }),
      ]);
      return {
        id: t.id,
        name: t.name,
        totalProjects: t._count.projects,
        totalTasks,
        doneTasks,
        openTasks: totalTasks - doneTasks,
        hoursLogged: toHours(timeAgg._sum.durationMinutes),
      };
    })
  );

  res.json(rows);
});

export default router;
