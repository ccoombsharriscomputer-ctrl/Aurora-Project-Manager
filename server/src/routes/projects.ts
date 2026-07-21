import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { logActivity } from "../lib/activity";
import { emitUpdate } from "../lib/realtime";

const router = Router();

router.use(requireAuth);

// All authenticated users can see all projects (shared team visibility).
router.get("/", async (_req, res) => {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
      _count: { select: { tasks: true } },
    },
  });

  const withProgress = await Promise.all(
    projects.map(async (p) => {
      const doneCount = await prisma.task.count({ where: { projectId: p.id, status: "DONE" } });
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        createdBy: p.createdBy,
        createdAt: p.createdAt,
        members: p.members.map((m) => ({ ...m.user, role: m.role })),
        totalTasks: p._count.tasks,
        doneTasks: doneCount,
      };
    })
  );

  res.json(withProgress);
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const project = await prisma.project.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      createdById: req.user!.id,
      members: {
        create: { userId: req.user!.id, role: "OWNER" },
      },
    },
    include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
  });

  await logActivity({
    type: "PROJECT_CREATED",
    message: `${req.user!.name} created project "${project.name}"`,
    userId: req.user!.id,
    projectId: project.id,
  });
  emitUpdate({ scope: "dashboard" });
  emitUpdate({ scope: "projects" });

  res.status(201).json(project);
});

router.get("/:id", async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      createdBy: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  res.json({
    ...project,
    members: project.members.map((m) => ({ ...m.user, role: m.role })),
  });
});

function canManageProject(projectCreatedById: string, req: import("express").Request) {
  return req.user!.role === "ADMIN" || req.user!.id === projectCreatedById;
}

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
});

router.patch("/:id", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  if (!canManageProject(project.createdById, req)) {
    return res.status(403).json({ error: "Only the project creator or an admin can edit this project" });
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const updated = await prisma.project.update({ where: { id: req.params.id }, data: parsed.data });
  emitUpdate({ scope: "project", projectId: updated.id });
  emitUpdate({ scope: "projects" });
  res.json(updated);
});

router.delete("/:id", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  if (!canManageProject(project.createdById, req)) {
    return res.status(403).json({ error: "Only the project creator or an admin can delete this project" });
  }
  await prisma.project.delete({ where: { id: req.params.id } });
  emitUpdate({ scope: "dashboard" });
  emitUpdate({ scope: "projects" });
  emitUpdate({ scope: "project", projectId: req.params.id });
  res.status(204).send();
});

const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["OWNER", "MEMBER"]).optional(),
});

router.post("/:id/members", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const member = await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: req.params.id, userId: parsed.data.userId } },
    update: { role: parsed.data.role ?? "MEMBER" },
    create: { projectId: req.params.id, userId: parsed.data.userId, role: parsed.data.role ?? "MEMBER" },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  emitUpdate({ scope: "project", projectId: req.params.id });
  res.status(201).json(member);
});

router.delete("/:id/members/:userId", async (req, res) => {
  await prisma.projectMember
    .delete({ where: { projectId_userId: { projectId: req.params.id, userId: req.params.userId } } })
    .catch(() => null);
  emitUpdate({ scope: "project", projectId: req.params.id });
  res.status(204).send();
});

router.get("/:id/tasks", async (req, res) => {
  const tasks = await prisma.task.findMany({
    where: { projectId: req.params.id },
    orderBy: { createdAt: "asc" },
    include: {
      assignee: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      _count: { select: { comments: true, attachments: true } },
    },
  });
  res.json(tasks);
});

const createTaskSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  assigneeId: z.string().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
});

router.post("/:id/tasks", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const task = await prisma.task.create({
    data: {
      projectId: req.params.id,
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority ?? "MEDIUM",
      assigneeId: parsed.data.assigneeId ?? null,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      createdById: req.user!.id,
    },
    include: { assignee: { select: { id: true, name: true } } },
  });

  await logActivity({
    type: "TASK_CREATED",
    message: `${req.user!.name} created task "${task.title}" in ${project.name}`,
    userId: req.user!.id,
    projectId: project.id,
    taskId: task.id,
  });
  emitUpdate({ scope: "project", projectId: project.id });
  emitUpdate({ scope: "dashboard" });

  res.status(201).json(task);
});

export default router;
