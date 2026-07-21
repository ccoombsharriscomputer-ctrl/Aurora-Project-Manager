import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { COOKIE_NAME, comparePassword, hashPassword, signToken } from "../lib/auth";
import { requireAuth } from "../middleware/auth";

const router = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  const userCount = await prisma.user.count();
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: userCount === 0 ? "ADMIN" : "MEMBER",
    },
  });

  const token = signToken(user.id);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

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
