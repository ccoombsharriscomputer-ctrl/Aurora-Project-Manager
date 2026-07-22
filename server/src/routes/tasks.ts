import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { effectiveSoftwareLineId, requireAuth } from "../middleware/auth";
import { logActivity } from "../lib/activity";
import { emitUpdate } from "../lib/realtime";
import { upload } from "../lib/upload";
import { loadTaskInScope } from "../lib/scope";

const router = Router();
router.use(requireAuth);

router.get("/:id", async (req, res) => {
  const scoped = await loadTaskInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!scoped) {
    return res.status(404).json({ error: "Task not found" });
  }
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: {
      project: { select: { id: true, name: true } },
      subProject: { select: { id: true, name: true, checklistItem: { select: { id: true, name: true } } } },
      assignee: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true } } },
      },
      attachments: {
        orderBy: { createdAt: "asc" },
        include: { uploader: { select: { id: true, name: true } } },
      },
      timeEntries: {
        orderBy: { startedAt: "desc" },
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });
  res.json(task);
});

const updateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

router.patch("/:id", async (req, res) => {
  const existing = await loadTaskInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!existing) {
    return res.status(404).json({ error: "Task not found" });
  }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  if (parsed.data.assigneeId) {
    const assignee = await prisma.user.findUnique({ where: { id: parsed.data.assigneeId } });
    if (!assignee || (assignee.role !== "ADMIN" && assignee.softwareLineId !== existing.project.softwareLineId)) {
      return res.status(400).json({ error: "Assignee belongs to a different software line" });
    }
  }

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.dueDate !== undefined) {
    data.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
  }

  const task = await prisma.task.update({
    where: { id: req.params.id },
    data,
    include: { assignee: { select: { id: true, name: true } } },
  });

  if (parsed.data.status && parsed.data.status !== existing.status) {
    await logActivity({
      type: "TASK_STATUS_CHANGED",
      message: `${req.user!.name} moved "${task.title}" to ${parsed.data.status.replace("_", " ")}`,
      userId: req.user!.id,
      projectId: task.projectId,
      taskId: task.id,
    });
  }
  if (parsed.data.assigneeId !== undefined && parsed.data.assigneeId !== existing.assigneeId) {
    await logActivity({
      type: "TASK_ASSIGNED",
      message: task.assignee
        ? `${req.user!.name} assigned "${task.title}" to ${task.assignee.name}`
        : `${req.user!.name} unassigned "${task.title}"`,
      userId: req.user!.id,
      projectId: task.projectId,
      taskId: task.id,
    });
  }

  emitUpdate({ scope: "task", taskId: task.id });
  emitUpdate({ scope: "project", projectId: task.projectId });
  emitUpdate({ scope: "sub-project", subProjectId: task.subProjectId });
  if (parsed.data.status || parsed.data.assigneeId !== undefined) {
    emitUpdate({ scope: "dashboard" });
  }

  res.json(task);
});

router.delete("/:id", async (req, res) => {
  const task = await loadTaskInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  await prisma.task.delete({ where: { id: req.params.id } }).catch(() => null);
  emitUpdate({ scope: "project", projectId: task.projectId });
  emitUpdate({ scope: "sub-project", subProjectId: task.subProjectId });
  emitUpdate({ scope: "task", taskId: task.id });
  emitUpdate({ scope: "dashboard" });
  res.status(204).send();
});

// --- Comments ---

router.get("/:id/comments", async (req, res) => {
  const task = await loadTaskInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  const comments = await prisma.comment.findMany({
    where: { taskId: req.params.id },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true } } },
  });
  res.json(comments);
});

const commentSchema = z.object({ body: z.string().min(1).max(5000) });

router.post("/:id/comments", async (req, res) => {
  const task = await loadTaskInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const comment = await prisma.comment.create({
    data: { taskId: task.id, authorId: req.user!.id, body: parsed.data.body },
    include: { author: { select: { id: true, name: true } } },
  });

  await logActivity({
    type: "COMMENT_ADDED",
    message: `${req.user!.name} commented on "${task.title}"`,
    userId: req.user!.id,
    projectId: task.projectId,
    taskId: task.id,
  });
  emitUpdate({ scope: "task", taskId: task.id });
  emitUpdate({ scope: "dashboard" });

  res.status(201).json(comment);
});

// --- Attachments ---

router.get("/:id/attachments", async (req, res) => {
  const task = await loadTaskInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  const attachments = await prisma.attachment.findMany({
    where: { taskId: req.params.id },
    orderBy: { createdAt: "asc" },
    include: { uploader: { select: { id: true, name: true } } },
  });
  res.json(attachments);
});

router.post("/:id/attachments", upload.single("file"), async (req, res) => {
  const task = await loadTaskInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const attachment = await prisma.attachment.create({
    data: {
      taskId: task.id,
      uploaderId: req.user!.id,
      storedFilename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    },
    include: { uploader: { select: { id: true, name: true } } },
  });

  await logActivity({
    type: "ATTACHMENT_ADDED",
    message: `${req.user!.name} attached "${attachment.originalName}" to "${task.title}"`,
    userId: req.user!.id,
    projectId: task.projectId,
    taskId: task.id,
  });
  emitUpdate({ scope: "task", taskId: task.id });
  emitUpdate({ scope: "dashboard" });

  res.status(201).json(attachment);
});

// --- Time entries ---

router.get("/:id/time-entries", async (req, res) => {
  const task = await loadTaskInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  const entries = await prisma.timeEntry.findMany({
    where: { taskId: req.params.id },
    orderBy: { startedAt: "desc" },
    include: { user: { select: { id: true, name: true } } },
  });
  res.json(entries);
});

router.post("/:id/time-entries/start", async (req, res) => {
  const task = await loadTaskInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  const running = await prisma.timeEntry.findFirst({
    where: { userId: req.user!.id, endedAt: null },
  });
  if (running) {
    return res.status(409).json({ error: "You already have a running timer. Stop it before starting another." });
  }

  const entry = await prisma.timeEntry.create({
    data: { taskId: task.id, userId: req.user!.id, startedAt: new Date() },
    include: { user: { select: { id: true, name: true } } },
  });
  emitUpdate({ scope: "task", taskId: task.id });
  res.status(201).json(entry);
});

const manualEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  hours: z.number().positive().max(24),
  note: z.string().max(1000).optional(),
});

router.post("/:id/time-entries", async (req, res) => {
  const task = await loadTaskInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  const parsed = manualEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const durationMinutes = Math.round(parsed.data.hours * 60);
  const startedAt = new Date(`${parsed.data.date}T12:00:00.000Z`);
  const endedAt = new Date(startedAt.getTime() + durationMinutes * 60000);

  const entry = await prisma.timeEntry.create({
    data: {
      taskId: task.id,
      userId: req.user!.id,
      startedAt,
      endedAt,
      durationMinutes,
      note: parsed.data.note,
    },
    include: { user: { select: { id: true, name: true } } },
  });

  await logActivity({
    type: "TIME_LOGGED",
    message: `${req.user!.name} logged ${(durationMinutes / 60).toFixed(1)}h on "${task.title}"`,
    userId: req.user!.id,
    projectId: task.projectId,
    taskId: task.id,
  });
  emitUpdate({ scope: "task", taskId: task.id });
  emitUpdate({ scope: "dashboard" });

  res.status(201).json(entry);
});

export default router;
