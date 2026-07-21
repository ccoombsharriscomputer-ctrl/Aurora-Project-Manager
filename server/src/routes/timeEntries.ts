import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { logActivity } from "../lib/activity";
import { emitUpdate } from "../lib/realtime";

const router = Router();
router.use(requireAuth);

router.get("/active", async (req, res) => {
  const entry = await prisma.timeEntry.findFirst({
    where: { userId: req.user!.id, endedAt: null },
    include: { task: { include: { project: { select: { id: true, name: true } } } } },
  });
  res.json(entry ?? null);
});

const stopSchema = z.object({ note: z.string().max(1000).optional() });

router.post("/:id/stop", async (req, res) => {
  const entry = await prisma.timeEntry.findUnique({ where: { id: req.params.id }, include: { task: true } });
  if (!entry) {
    return res.status(404).json({ error: "Time entry not found" });
  }
  if (entry.userId !== req.user!.id) {
    return res.status(403).json({ error: "You can only stop your own timer" });
  }
  if (entry.endedAt) {
    return res.status(400).json({ error: "Timer already stopped" });
  }

  const parsed = stopSchema.safeParse(req.body ?? {});
  const endedAt = new Date();
  const durationMinutes = Math.max(1, Math.round((endedAt.getTime() - entry.startedAt.getTime()) / 60000));

  const updated = await prisma.timeEntry.update({
    where: { id: entry.id },
    data: { endedAt, durationMinutes, note: parsed.success ? parsed.data.note : undefined },
    include: { user: { select: { id: true, name: true } } },
  });

  await logActivity({
    type: "TIME_LOGGED",
    message: `${req.user!.name} logged ${(durationMinutes / 60).toFixed(1)}h on "${entry.task.title}"`,
    userId: req.user!.id,
    projectId: entry.task.projectId,
    taskId: entry.task.id,
  });
  emitUpdate({ scope: "task", taskId: entry.task.id });
  emitUpdate({ scope: "dashboard" });

  res.json(updated);
});

export default router;
