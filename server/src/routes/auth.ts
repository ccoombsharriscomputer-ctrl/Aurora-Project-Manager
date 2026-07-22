import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { COOKIE_NAME, comparePassword, signToken } from "../lib/auth";
import { requireAuth } from "../middleware/auth";

const router = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid email or password" });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = signToken(user.id);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.status(204).send();
});

router.get("/me", requireAuth, (req, res) => {
  res.json(req.user);
});

export default router;
