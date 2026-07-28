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

  const followUpRows = await prisma.followUp.findMany({
    where: {
      dueDate: { gte: new Date(start), lte: endOfDay },
      task: { project: { softwareLineId: effectiveSoftwareLineId(req.user!), archivedAt: null } },
    },
    orderBy: { dueDate: "asc" },
    include: {
      task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
  const followUps = followUpRows.map((f) => ({
    id: f.id,
    taskId: f.task.id,
    taskTitle: f.task.title,
    dueDate: f.dueDate,
    user: f.user,
    project: f.task.project,
  }));

  res.json({ tasks, followUps });
});

export default router;
