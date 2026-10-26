import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { blockReadOnly, effectiveSoftwareLineId, requireAuth } from "../middleware/auth";
import { emitUpdate } from "../lib/realtime";
import { loadProjectInScope } from "../lib/scope";
import { CONTRACT_CATEGORIES } from "../lib/contractCategories";

const router = Router();
router.use(requireAuth);

export const contractLineSchema = z.object({
  category: z.enum(CONTRACT_CATEGORIES),
  description: z.string().trim().min(1).max(300),
  checklistItemId: z.string().min(1).nullable().optional(),
  hours: z.number().positive().max(100000).nullable().optional(),
  amount: z.number().min(0).max(100000000).nullable().optional(),
});

async function linesWithUsage(projectId: string) {
  const lines = await prisma.contractLine.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    include: { checklistItem: { select: { id: true, name: true } } },
  });
  const used = await prisma.timeEntry.groupBy({
    by: ["contractLineId"],
    where: { contractLineId: { in: lines.map((l) => l.id) } },
    _sum: { durationMinutes: true },
  });
  const minutesByLine = new Map(used.map((u) => [u.contractLineId, u._sum.durationMinutes ?? 0]));
  return lines.map((line) => ({
    ...line,
    hoursUsed: Math.round(((minutesByLine.get(line.id) ?? 0) / 60) * 100) / 100,
  }));
}

// A product has to be one from this software line's own catalog — same scoping as everywhere
// else, so a line can't point at another line's product.
async function productInLine(checklistItemId: string | null | undefined, lineId: string): Promise<boolean> {
  if (!checklistItemId) return true;
  const item = await prisma.checklistItem.findUnique({ where: { id: checklistItemId } });
  return !!item && item.softwareLineId === lineId;
}

router.get("/:id/contract-lines", async (req, res) => {
  const project = await loadProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(await linesWithUsage(project.id));
});

router.post("/:id/contract-lines", blockReadOnly, async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const project = await loadProjectInScope(req.params.id, lineId);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const parsed = contractLineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (!(await productInLine(parsed.data.checklistItemId, lineId))) {
    return res.status(404).json({ error: "Product not found" });
  }

  await prisma.contractLine.create({
    data: {
      projectId: project.id,
      category: parsed.data.category,
      description: parsed.data.description,
      checklistItemId: parsed.data.checklistItemId ?? null,
      hours: parsed.data.hours ?? null,
      amount: parsed.data.amount ?? null,
    },
  });
  emitUpdate({ scope: "project", projectId: project.id });
  res.status(201).json(await linesWithUsage(project.id));
});

router.patch("/:id/contract-lines/:lineId", blockReadOnly, async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const project = await loadProjectInScope(req.params.id, lineId);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const existing = await prisma.contractLine.findUnique({ where: { id: req.params.lineId } });
  if (!existing || existing.projectId !== project.id) return res.status(404).json({ error: "Contract line not found" });
  const parsed = contractLineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (!(await productInLine(parsed.data.checklistItemId, lineId))) {
    return res.status(404).json({ error: "Product not found" });
  }

  await prisma.contractLine.update({
    where: { id: existing.id },
    data: {
      category: parsed.data.category,
      description: parsed.data.description,
      checklistItemId: parsed.data.checklistItemId ?? null,
      hours: parsed.data.hours ?? null,
      amount: parsed.data.amount ?? null,
    },
  });
  emitUpdate({ scope: "project", projectId: project.id });
  res.json(await linesWithUsage(project.id));
});

// Time already logged against the line stays on its time entries — they just stop pointing at it.
router.delete("/:id/contract-lines/:lineId", blockReadOnly, async (req, res) => {
  const project = await loadProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!project) return res.status(404).json({ error: "Project not found" });
  const existing = await prisma.contractLine.findUnique({ where: { id: req.params.lineId } });
  if (!existing || existing.projectId !== project.id) return res.status(404).json({ error: "Contract line not found" });

  await prisma.contractLine.delete({ where: { id: existing.id } });
  emitUpdate({ scope: "project", projectId: project.id });
  res.json(await linesWithUsage(project.id));
});

export default router;
