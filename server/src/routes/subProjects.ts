import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { effectiveSoftwareLineId, requireAuth } from "../middleware/auth";
import { logActivity } from "../lib/activity";
import { emitUpdate } from "../lib/realtime";
import { loadSubProjectInScope } from "../lib/scope";

const router = Router();
router.use(requireAuth);

function canManageProject(projectCreatedById: string, req: import("express").Request) {
  return req.user!.role === "ADMIN" || req.user!.id === projectCreatedById;
}

router.get("/:id", async (req, res) => {
  const subProject = await loadSubProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!subProject) {
    return res.status(404).json({ error: "Sub-project not found" });
  }
  const withMembers = await prisma.subProject.findUnique({
    where: { id: req.params.id },
    include: {
      checklistItem: true,
      project: {
        include: {
          members: { include: { user: { select: { id: true, name: true, email: true } } } },
        },
      },
    },
  });
  const full = withMembers!;
  res.json({
    id: full.id,
    name: full.name,
    checklistItem: full.checklistItem,
    createdAt: full.createdAt,
    project: {
      id: full.project.id,
      name: full.project.name,
      createdById: full.project.createdById,
      members: full.project.members.map((m) => ({ ...m.user, role: m.role })),
    },
  });
});

const updateSchema = z.object({
  name: z.string().max(200).nullable().optional(),
});

router.patch("/:id", async (req, res) => {
  const subProject = await loadSubProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!subProject) {
    return res.status(404).json({ error: "Sub-project not found" });
  }
  if (!canManageProject(subProject.project.createdById, req)) {
    return res.status(403).json({ error: "Only the project creator or an admin can edit this sub-project" });
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const updated = await prisma.subProject.update({ where: { id: req.params.id }, data: parsed.data });
  emitUpdate({ scope: "project", projectId: subProject.projectId });
  emitUpdate({ scope: "sub-project", subProjectId: updated.id });
  res.json(updated);
});

router.delete("/:id", async (req, res) => {
  const subProject = await loadSubProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!subProject) {
    return res.status(404).json({ error: "Sub-project not found" });
  }
  if (!canManageProject(subProject.project.createdById, req)) {
    return res.status(403).json({ error: "Only the project creator or an admin can delete this sub-project" });
  }
  await prisma.subProject.delete({ where: { id: req.params.id } });
  emitUpdate({ scope: "project", projectId: subProject.projectId });
  emitUpdate({ scope: "dashboard" });
  res.status(204).send();
});

router.get("/:id/tasks", async (req, res) => {
  const subProject = await loadSubProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!subProject) {
    return res.status(404).json({ error: "Sub-project not found" });
  }

  const tasks = await prisma.task.findMany({
    where: { subProjectId: req.params.id },
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
  const subProject = await loadSubProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!subProject) {
    return res.status(404).json({ error: "Sub-project not found" });
  }
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  if (parsed.data.assigneeId) {
    const assignee = await prisma.user.findUnique({ where: { id: parsed.data.assigneeId } });
    if (!assignee || (assignee.role !== "ADMIN" && assignee.softwareLineId !== subProject.project.softwareLineId)) {
      return res.status(400).json({ error: "Assignee belongs to a different software line" });
    }
  }

  const task = await prisma.task.create({
    data: {
      subProjectId: subProject.id,
      projectId: subProject.projectId,
      projectTypeId: subProject.project.projectTypeId,
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
    message: `${req.user!.name} created task "${task.title}"`,
    userId: req.user!.id,
    projectId: subProject.projectId,
    taskId: task.id,
  });
  emitUpdate({ scope: "sub-project", subProjectId: subProject.id });
  emitUpdate({ scope: "project", projectId: subProject.projectId });
  emitUpdate({ scope: "dashboard" });

  res.status(201).json(task);
});

export default router;
