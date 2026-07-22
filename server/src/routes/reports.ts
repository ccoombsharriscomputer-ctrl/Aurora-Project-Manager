import { Router } from "express";
import { prisma } from "../lib/prisma";
import { effectiveSoftwareLineId, requireAdmin, requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

function toHours(minutes: number | null | undefined): number {
  return Math.round(((minutes ?? 0) / 60) * 10) / 10;
}

// Row set is "users who are actually members of a project in this line" rather than
// "users whose home line is this line" — an admin's home line can differ from wherever
// they're currently active, and this way their real activity still surfaces correctly.
router.get("/by-user", async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const inLine = { project: { softwareLineId: lineId } };

  const memberships = await prisma.projectMember.findMany({
    where: inLine,
    select: { userId: true },
    distinct: ["userId"],
  });
  const userIds = memberships.map((m) => m.userId);

  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, active: true },
    orderBy: { name: "asc" },
    include: {
      projectMemberships: { where: inLine, include: { project: { select: { id: true, name: true } } } },
      assignedTasks: { where: inLine, select: { status: true } },
      timeEntries: { where: { task: inLine }, select: { durationMinutes: true } },
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

router.get("/by-project", async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const projects = await prisma.project.findMany({
    where: { softwareLineId: lineId },
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

router.get("/by-project-type", async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const types = await prisma.projectType.findMany({
    where: { softwareLineId: lineId },
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
