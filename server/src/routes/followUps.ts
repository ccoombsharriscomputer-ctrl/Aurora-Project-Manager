import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { blockReadOnly, effectiveSoftwareLineId, requireAuth } from "../middleware/auth";
import { loadFollowUpInScope } from "../lib/scope";
import { emitUpdate } from "../lib/realtime";

const router = Router();
router.use(requireAuth);

const updateSchema = z.object({
  completed: z.boolean(),
});

// Marking a follow-up complete/incomplete — the one lifecycle action a follow-up has, whether
// it's task-linked (scheduled from a comment) or project-level (routes/projects.ts). Only
// whoever scheduled it, or an admin, can change it — a follow-up is a personal reminder for a
// specific person to do something, not a shared team field like a task's status.
router.patch("/:id", blockReadOnly, async (req, res) => {
  const followUp = await loadFollowUpInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!followUp) {
    return res.status(404).json({ error: "Follow-up not found" });
  }
  if (followUp.userId !== req.user!.id && req.user!.role !== "ADMIN") {
    return res.status(403).json({ error: "Only the person who scheduled this follow-up (or an admin) can mark it complete" });
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const updated = await prisma.followUp.update({
    where: { id: followUp.id },
    data: { completedAt: parsed.data.completed ? new Date() : null },
    include: { user: { select: { id: true, name: true } } },
  });

  emitUpdate({ scope: "dashboard" });
  if (followUp.projectId) emitUpdate({ scope: "project", projectId: followUp.projectId });
  if (followUp.taskId) emitUpdate({ scope: "task", taskId: followUp.taskId });

  res.json(updated);
});

export default router;
