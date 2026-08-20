import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { effectiveSoftwareLineId, requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

const querySchema = z.object({
  start: z.string(),
  end: z.string(),
});

router.get("/", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "start and end query params are required" });
  }
  const { start, end } = parsed.data;

  // `end` is a plain date (e.g. "2026-07-27"); parsing it alone gives UTC midnight, which
  // would exclude same-day tasks whose dueDate carries a later time-of-day component (e.g.
  // one stamped at completion time). Push the upper bound to the end of that day instead.
  const endOfDay = new Date(end);
  endOfDay.setUTCHours(23, 59, 59, 999);

  // Every task with a due date in range, regardless of status — this doubles as a schedule
  // of what happened (or didn't) on past days, not just a forward-looking deadline list.
  const tasks = await prisma.task.findMany({
    where: {
      dueDate: { gte: new Date(start), lte: endOfDay },
      project: { softwareLineId: effectiveSoftwareLineId(req.user!), archivedAt: null },
    },
    orderBy: { dueDate: "asc" },
    include: {
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true, email: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  // Either a task-linked follow-up (scheduled from a comment) whose task's project is in
  // scope, or a project-level one (scheduled directly on the project) whose own project is in
  // scope — see the FollowUp model's comment for why exactly one of task/project is ever set.
  const lineFilter = { softwareLineId: effectiveSoftwareLineId(req.user!), archivedAt: null };
  const followUpRows = await prisma.followUp.findMany({
    where: {
      dueDate: { gte: new Date(start), lte: endOfDay },
      OR: [{ task: { project: lineFilter } }, { project: lineFilter }],
    },
    orderBy: { dueDate: "asc" },
    include: {
      task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } },
      project: { select: { id: true, name: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
  const followUps = followUpRows.map((f) => ({
    id: f.id,
    taskId: f.task?.id ?? null,
    taskTitle: f.task?.title ?? null,
    dueDate: f.dueDate,
    completedAt: f.completedAt,
    user: f.user,
    project: f.task?.project ?? f.project ?? null,
  }));

  res.json({ tasks, followUps });
});

export default router;
