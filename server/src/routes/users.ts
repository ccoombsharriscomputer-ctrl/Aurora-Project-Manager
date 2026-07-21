import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { emitUpdate } from "../lib/realtime";
import { hashPassword } from "../lib/auth";

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

const createSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  role: z.enum(["ADMIN", "PROJECT_LEAD", "MEMBER"]).optional(),
});

router.post("/", requireAdmin, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { name, email, password, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role: role ?? "MEMBER" },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
  });

  emitUpdate({ scope: "users" });
  res.status(201).json(user);
});

const updateSchema = z.object({
  role: z.enum(["ADMIN", "PROJECT_LEAD", "MEMBER"]).optional(),
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
