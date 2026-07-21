import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireProjectTypeManager } from "../middleware/auth";
import { emitUpdate } from "../lib/realtime";

const router = Router();
router.use(requireAuth);

// Any authenticated user can list types (needed for the "add sub-project" dropdown).
router.get("/", async (_req, res) => {
  const types = await prisma.projectType.findMany({
    orderBy: { name: "asc" },
  });
  res.json(types);
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

  const existing = await prisma.projectType.findUnique({ where: { name: parsed.data.name } });
  if (existing) {
    return res.status(409).json({ error: "A project type with that name already exists" });
  }

  const type = await prisma.projectType.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      createdById: req.user!.id,
    },
  });

  emitUpdate({ scope: "project-types" });
  res.status(201).json(type);
});

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

  const type = await prisma.projectType.update({
    where: { id: req.params.id },
    data: parsed.data,
  });

  emitUpdate({ scope: "project-types" });
  res.json(type);
});

export default router;
