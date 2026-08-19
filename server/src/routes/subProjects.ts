import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { blockReadOnly, effectiveSoftwareLineId, requireAuth } from "../middleware/auth";
import { logActivity } from "../lib/activity";
import { emitUpdate } from "../lib/realtime";
import { loadSubProjectInScope, userHasLineAccess } from "../lib/scope";
import { notifyTaskAssigned } from "../lib/email";

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

router.patch("/:id", blockReadOnly, async (req, res) => {
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

router.delete("/:id", blockReadOnly, async (req, res) => {
  const subProject = await loadSubProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!subProject) {
    return res.status(404).json({ error: "Sub-project not found" });
  }
  if (!canManageProject(subProject.project.createdById, req)) {
    return res.status(403).json({ error: "Only the project creator or an admin can delete this sub-project" });
  }
  const checklistItem = await prisma.checklistItem.findUnique({
    where: { id: subProject.checklistItemId },
    select: { name: true },
  });
  const displayName = subProject.name || checklistItem?.name || "sub-project";

  await prisma.subProject.delete({ where: { id: req.params.id } });
  // The parent project isn't being deleted, so projectId stays valid here.
  await logActivity({
    type: "SUBPROJECT_DELETED",
    message: `${req.user!.name} deleted sub-project "${displayName}" from "${subProject.project.name}"`,
    userId: req.user!.id,
    softwareLineId: subProject.project.softwareLineId,
    projectId: subProject.projectId,
  });
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
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
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

router.post("/:id/tasks", blockReadOnly, async (req, res) => {
  const subProject = await loadSubProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!subProject) {
    return res.status(404).json({ error: "Sub-project not found" });
  }
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  if (parsed.data.assigneeId) {
    const assignee = await prisma.user.findUnique({
      where: { id: parsed.data.assigneeId },
      include: { softwareLineGrants: true },
    });
    if (!assignee || !userHasLineAccess(assignee, subProject.project.softwareLineId)) {
      return res.status(400).json({ error: "Assignee belongs to a different software line" });
    }
  }

  // Same rule as editing a task later (routes/tasks.ts) — a task with a real assignee
  // always needs a due date, whether it ends up that way at creation or via a later edit.
  if (parsed.data.assigneeId && !parsed.data.dueDate) {
    return res.status(400).json({ error: "A due date is required when a task is assigned to someone" });
  }

  const maxOrder = await prisma.task.aggregate({
    where: { subProjectId: subProject.id },
    _max: { order: true },
  });

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
      order: (maxOrder._max.order ?? -10) + 10,
    },
    include: { assignee: { select: { id: true, name: true } } },
  });

  await logActivity({
    type: "TASK_CREATED",
    message: `${req.user!.name} created task "${task.title}"`,
    userId: req.user!.id,
    softwareLineId: subProject.project.softwareLineId,
    projectId: subProject.projectId,
    taskId: task.id,
  });

  // Same notification as assigning someone on an already-existing task (routes/tasks.ts) —
  // being assigned at creation time is no different from being assigned via a later edit.
  if (task.assignee && task.dueDate) {
    const [assignee, checklistItem] = await Promise.all([
      prisma.user.findUnique({
        where: { id: task.assignee.id },
        select: { email: true, locale: true, active: true, emailNotifications: true },
      }),
      subProject.name ? null : prisma.checklistItem.findUnique({ where: { id: subProject.checklistItemId }, select: { name: true } }),
    ]);
    if (assignee?.active && assignee.emailNotifications) {
      notifyTaskAssigned({
        to: assignee.email,
        locale: assignee.locale,
        taskTitle: task.title,
        projectName: subProject.project.name,
        subProjectName: subProject.name || checklistItem!.name,
        dueDate: task.dueDate,
        taskId: task.id,
      }).catch((err) => console.error(`Failed to notify ${assignee.email} of task assignment:`, err));
    }
  }

  emitUpdate({ scope: "sub-project", subProjectId: subProject.id });
  emitUpdate({ scope: "project", projectId: subProject.projectId });
  emitUpdate({ scope: "dashboard" });

  res.status(201).json(task);
});

const reorderTasksSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1),
});

// Reorders whichever subset of a sub-project's tasks the client sends — typically one
// kanban column's worth, since that's the only set the board ever drags within — by
// re-numbering just those tasks' `order` field. Tasks outside the subset keep their
// existing order value, so this can't be used to smuggle in tasks from elsewhere.
router.patch("/:id/tasks/reorder", blockReadOnly, async (req, res) => {
  const subProject = await loadSubProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!subProject) {
    return res.status(404).json({ error: "Sub-project not found" });
  }
  const parsed = reorderTasksSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const matching = await prisma.task.findMany({
    where: { id: { in: parsed.data.taskIds }, subProjectId: subProject.id },
    select: { id: true },
  });
  if (matching.length !== parsed.data.taskIds.length) {
    return res.status(400).json({ error: "One or more tasks don't belong to this sub-project" });
  }

  await prisma.$transaction(
    parsed.data.taskIds.map((id, index) => prisma.task.update({ where: { id }, data: { order: index * 10 } }))
  );

  emitUpdate({ scope: "sub-project", subProjectId: subProject.id });
  res.status(204).send();
});

export default router;
