import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { effectiveSoftwareLineId, requireAuth, requireProjectTypeManager } from "../middleware/auth";
import { emitUpdate } from "../lib/realtime";

const router = Router();
router.use(requireAuth);

// Per-line product catalog — any authenticated user (needed for the Products page, the
// new-project product picker, and the cross-type "add sub-project" picker).
router.get("/", async (req, res) => {
  const items = await prisma.checklistItem.findMany({
    where: { softwareLineId: effectiveSoftwareLineId(req.user!) },
    orderBy: { name: "asc" },
  });
  res.json(items);
});

const createSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(1000).optional(),
});

router.post("/", requireProjectTypeManager, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const item = await prisma.checklistItem.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      softwareLineId: effectiveSoftwareLineId(req.user!),
      createdById: req.user!.id,
    },
  });

  emitUpdate({ scope: "products" });
  res.status(201).json(item);
});

const updateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  description: z.string().max(1000).nullable().optional(),
  active: z.boolean().optional(),
});

router.patch("/:id", requireProjectTypeManager, async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const existing = await prisma.checklistItem.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.softwareLineId !== lineId) {
    return res.status(404).json({ error: "Product not found" });
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const item = await prisma.checklistItem.update({
    where: { id: req.params.id },
    data: parsed.data,
  });

  emitUpdate({ scope: "products" });
  res.json(item);
});

router.delete("/:id", requireProjectTypeManager, async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const item = await prisma.checklistItem.findUnique({ where: { id: req.params.id } });
  if (!item || item.softwareLineId !== lineId) {
    return res.status(404).json({ error: "Product not found" });
  }

  const subProjectCount = await prisma.subProject.count({ where: { checklistItemId: item.id } });
  if (subProjectCount > 0) {
    return res.status(400).json({
      error: `Can't delete "${item.name}" — ${subProjectCount} sub-project${subProjectCount === 1 ? "" : "s"} still use${subProjectCount === 1 ? "s" : ""} it. Deactivate it instead.`,
    });
  }

  await prisma.checklistItem.delete({ where: { id: item.id } });
  emitUpdate({ scope: "products" });
  res.status(204).send();
});

// Any authenticated user can list task templates (not needed for a picker today, but
// consistent with how products themselves are readable by everyone).
router.get("/:id/task-templates", async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const item = await prisma.checklistItem.findUnique({ where: { id: req.params.id } });
  if (!item || item.softwareLineId !== lineId) {
    return res.status(404).json({ error: "Product not found" });
  }

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
  const lineId = effectiveSoftwareLineId(req.user!);
  const checklistItem = await prisma.checklistItem.findUnique({ where: { id: req.params.id } });
  if (!checklistItem || checklistItem.softwareLineId !== lineId) {
    return res.status(404).json({ error: "Product not found" });
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

  emitUpdate({ scope: "products" });
  res.status(201).json(template);
});

export default router;
