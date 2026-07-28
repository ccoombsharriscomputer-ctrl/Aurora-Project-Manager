import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { blockReadOnly, effectiveSoftwareLineId, requireAuth } from "../middleware/auth";
import { logActivity } from "../lib/activity";
import { emitUpdate } from "../lib/realtime";
import { upload } from "../lib/upload";
import { loadTaskInScope } from "../lib/scope";
import { PS_ACTION_TYPES, syncTaskUpdateToTeamSupport } from "../lib/teamSupport";
import { formatHours } from "../lib/format";

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
        include: {
          author: { select: { id: true, name: true } },
          timeEntry: { select: { id: true, durationMinutes: true } },
        },
      },
      attachments: {
        orderBy: { createdAt: "asc" },
        include: { uploader: { select: { id: true, name: true } } },
      },
      // Entries with a commentId are already represented by their comment above (which
      // carries its own durationMinutes) — only bare Start Timer/Stop entries belong here.
      timeEntries: {
        where: { commentId: null },
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
  status: z.enum(["TODO", "IN_PROGRESS", "DONE", "NA"]).optional(),
  naReason: z.string().max(2000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

router.patch("/:id", blockReadOnly, async (req, res) => {
  const existing = await loadTaskInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!existing) {
    return res.status(404).json({ error: "Task not found" });
  }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  if (parsed.data.status === "NA" && !parsed.data.naReason?.trim()) {
    return res.status(400).json({ error: "A reason is required when marking a task N/A" });
  }

  if (parsed.data.assigneeId) {
    const assignee = await prisma.user.findUnique({ where: { id: parsed.data.assigneeId } });
    if (!assignee || (assignee.role !== "ADMIN" && assignee.softwareLineId !== existing.project.softwareLineId)) {
      return res.status(400).json({ error: "Assignee belongs to a different software line" });
    }
  }

  const { naReason, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if (parsed.data.dueDate !== undefined) {
    data.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
  }
  if (parsed.data.status && parsed.data.status !== existing.status) {
    data.completedAt = parsed.data.status === "DONE" ? new Date() : null;
    data.naReason = parsed.data.status === "NA" ? naReason!.trim() : null;
  }

  const task = await prisma.task.update({
    where: { id: req.params.id },
    data,
    include: { assignee: { select: { id: true, name: true } } },
  });

  if (parsed.data.status && parsed.data.status !== existing.status) {
    const message =
      parsed.data.status === "NA"
        ? `${req.user!.name} marked "${task.title}" as N/A: ${task.naReason}`
        : `${req.user!.name} moved "${task.title}" to ${parsed.data.status.replace("_", " ")}`;
    await logActivity({
      type: "TASK_STATUS_CHANGED",
      message,
      userId: req.user!.id,
      softwareLineId: existing.project.softwareLineId,
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
      softwareLineId: existing.project.softwareLineId,
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

router.delete("/:id", blockReadOnly, async (req, res) => {
  const task = await loadTaskInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  await prisma.task.delete({ where: { id: req.params.id } }).catch(() => null);
  // Logged after the delete, with taskId omitted since the task is already gone by this
  // point — projectId still stands since only the task, not the project, was removed.
  await logActivity({
    type: "TASK_DELETED",
    message: `${req.user!.name} deleted task "${task.title}"`,
    userId: req.user!.id,
    softwareLineId: task.project.softwareLineId,
    projectId: task.projectId,
  });
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
    include: {
      author: { select: { id: true, name: true } },
      timeEntry: { select: { id: true, durationMinutes: true } },
    },
  });
  res.json(comments);
});

const commentSchema = z.object({
  body: z.string().min(1).max(5000),
  hours: z.number().positive().max(24).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional(),
  actionTypeId: z.string().optional(),
  isPublic: z.boolean().optional(),
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Follow-up date must be in YYYY-MM-DD format")
    .optional(),
});

const FOLLOW_UP_TITLE_MAX = 80;

router.post("/:id/comments", blockReadOnly, async (req, res) => {
  const task = await loadTaskInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const actionType = parsed.data.actionTypeId
    ? PS_ACTION_TYPES.find((t) => t.id === parsed.data.actionTypeId)
    : undefined;

  // Hours and action type are only ever shown to the user on a task whose project has a
  // TeamSupport ticket linked — that's the only place this requirement applies.
  if (task.project.teamSupportTicketNumber) {
    if (!parsed.data.hours) {
      return res.status(400).json({ error: "Hours are required when posting an update on a project linked to TeamSupport" });
    }
    if (!actionType) {
      return res.status(400).json({ error: "An action type is required when posting an update on a project linked to TeamSupport" });
    }
  }

  const comment = await prisma.comment.create({
    data: {
      taskId: task.id,
      authorId: req.user!.id,
      body: parsed.data.body,
      teamSupportActionType: actionType?.name ?? null,
      teamSupportIsPublic: parsed.data.isPublic ?? false,
    },
    include: {
      author: { select: { id: true, name: true } },
      timeEntry: { select: { id: true, durationMinutes: true } },
    },
  });

  await logActivity({
    type: "COMMENT_ADDED",
    message: `${req.user!.name} commented on "${task.title}"`,
    userId: req.user!.id,
    softwareLineId: task.project.softwareLineId,
    projectId: task.projectId,
    taskId: task.id,
  });

  let timeEntry = null;
  if (parsed.data.hours) {
    const durationMinutes = Math.round(parsed.data.hours * 60);
    const dateStr = parsed.data.date ?? new Date().toISOString().slice(0, 10);
    const startedAt = new Date(`${dateStr}T12:00:00.000Z`);
    const endedAt = new Date(startedAt.getTime() + durationMinutes * 60000);

    timeEntry = await prisma.timeEntry.create({
      data: {
        taskId: task.id,
        userId: req.user!.id,
        startedAt,
        endedAt,
        durationMinutes,
        note: parsed.data.body,
        commentId: comment.id,
      },
      include: { user: { select: { id: true, name: true } } },
    });

    await logActivity({
      type: "TIME_LOGGED",
      message: `${req.user!.name} logged ${formatHours(parsed.data.hours)}h on "${task.title}"`,
      userId: req.user!.id,
      softwareLineId: task.project.softwareLineId,
      projectId: task.projectId,
      taskId: task.id,
    });
  }

  if (task.project.teamSupportTicketNumber) {
    syncTaskUpdateToTeamSupport(task.project.teamSupportTicketNumber, parsed.data.body, {
      hours: parsed.data.hours,
      creatorId: req.user!.teamSupportUserId,
      actionTypeId: actionType?.id,
      isPublic: parsed.data.isPublic ?? false,
    });
  }

  // A follow-up is just a normal task due on the chosen date, in the same sub-project as the
  // one being commented on — it shows up on the Dashboard calendar the same way any other
  // open task with a due date does, no separate reminder mechanism needed.
  let followUpTask = null;
  if (parsed.data.followUpDate) {
    const titleSource = parsed.data.body.trim().replace(/\s+/g, " ");
    const title = `Follow up: ${
      titleSource.length > FOLLOW_UP_TITLE_MAX ? `${titleSource.slice(0, FOLLOW_UP_TITLE_MAX)}…` : titleSource
    }`;

    followUpTask = await prisma.task.create({
      data: {
        projectId: task.projectId,
        subProjectId: task.subProjectId,
        projectTypeId: task.projectTypeId,
        title,
        dueDate: new Date(parsed.data.followUpDate),
        assigneeId: req.user!.id,
        createdById: req.user!.id,
      },
    });

    await logActivity({
      type: "TASK_CREATED",
      message: `${req.user!.name} scheduled a follow-up: "${followUpTask.title}"`,
      userId: req.user!.id,
      softwareLineId: task.project.softwareLineId,
      projectId: task.projectId,
      taskId: followUpTask.id,
    });

    emitUpdate({ scope: "sub-project", subProjectId: task.subProjectId });
  }

  emitUpdate({ scope: "task", taskId: task.id });
  emitUpdate({ scope: "dashboard" });

  res.status(201).json({ comment, timeEntry, followUpTask });
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

router.post("/:id/attachments", blockReadOnly, upload.single("file"), async (req, res) => {
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
    softwareLineId: task.project.softwareLineId,
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
    where: { taskId: req.params.id, commentId: null },
    orderBy: { startedAt: "desc" },
    include: { user: { select: { id: true, name: true } } },
  });
  res.json(entries);
});

router.post("/:id/time-entries/start", blockReadOnly, async (req, res) => {
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

router.post("/:id/time-entries", blockReadOnly, async (req, res) => {
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
    message: `${req.user!.name} logged ${formatHours(durationMinutes / 60)}h on "${task.title}"`,
    userId: req.user!.id,
    softwareLineId: task.project.softwareLineId,
    projectId: task.projectId,
    taskId: task.id,
  });

  if (task.project.teamSupportTicketNumber) {
    const hours = parsed.data.hours;
    const body = parsed.data.note || `${formatHours(hours)}h logged`;
    syncTaskUpdateToTeamSupport(task.project.teamSupportTicketNumber, body, {
      hours,
      creatorId: req.user!.teamSupportUserId,
    });
  }

  emitUpdate({ scope: "task", taskId: task.id });
  emitUpdate({ scope: "dashboard" });

  res.status(201).json(entry);
});

export default router;
