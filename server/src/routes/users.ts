import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { emitUpdate } from "../lib/realtime";

const router = Router();

router.use(requireAuth);

// Any authenticated user can list users (needed for assignee/member pickers).
router.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    orderBy: { name: "asc" },
  });
  res.json(users);
});

const updateSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER"]).optional(),
  active: z.boolean().optional(),
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  if (req.params.id === req.user!.id && parsed.data.active === false) {
    return res.status(400).json({ error: "You cannot deactivate your own account" });
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: parsed.data,
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
  });
  emitUpdate({ scope: "users" });
  res.json(user);
});

export default router;
