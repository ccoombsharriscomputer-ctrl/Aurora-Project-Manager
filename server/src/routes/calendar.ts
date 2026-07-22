import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

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

  const tasks = await prisma.task.findMany({
    where: {
      status: { not: "DONE" },
      dueDate: { gte: new Date(start), lte: new Date(end) },
    },
    orderBy: { dueDate: "asc" },
    include: {
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true, email: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  res.json(tasks);
});

export default router;
