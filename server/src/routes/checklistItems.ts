import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireProjectTypeManager } from "../middleware/auth";
import { emitUpdate } from "../lib/realtime";

const router = Router();
router.use(requireAuth);

const updateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  description: z.string().max(1000).nullable().optional(),
  active: z.boolean().optional(),
});

router.patch("/:id", requireProjectTypeManager, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const item = await prisma.checklistItem.update({
    where: { id: req.params.id },
    data: parsed.data,
  });

  emitUpdate({ scope: "project-types" });
  res.json(item);
});

// Any authenticated user can list task templates (not needed for a picker today, but
// consistent with how checklist items themselves are readable by everyone).
router.get("/:id/task-templates", async (req, res) => {
  const templates = await prisma.taskTemplate.findMany({
    where: { checklistItemId: req.params.id },
    orderBy: { createdAt: "asc" },
  });
  res.json(templates);
});

const createTaskTemplateSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
});

router.post("/:id/task-templates", requireProjectTypeManager, async (req, res) => {
  const checklistItem = await prisma.checklistItem.findUnique({ where: { id: req.params.id } });
  if (!checklistItem) {
    return res.status(404).json({ error: "Checklist item not found" });
  }
  const parsed = createTaskTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const template = await prisma.taskTemplate.create({
    data: {
      checklistItemId: checklistItem.id,
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority ?? "MEDIUM",
      createdById: req.user!.id,
    },
  });

  emitUpdate({ scope: "project-types" });
  res.status(201).json(template);
});

export default router;
