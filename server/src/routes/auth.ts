import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { COOKIE_NAME, comparePassword, hashPassword, signToken } from "../lib/auth";
import { requireAuth } from "../middleware/auth";
import { buildCurrentUserPayload } from "../lib/currentUser";

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

  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (!user || !user.active) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  // Each fresh login starts a user back on their home line, even if a previous session
  // left them switched into another one (admin or a granted Project Lead/Member alike).
  // Mid-session switches (via PATCH /active-line) still stick until the next login.
  const loggedInUser = user.activeSoftwareLineId
    ? await prisma.user.update({ where: { id: user.id }, data: { activeSoftwareLineId: null } })
    : user;

  const grants = await prisma.userSoftwareLineGrant.findMany({
    where: { userId: loggedInUser.id },
    select: { softwareLineId: true },
  });

  const token = signToken(loggedInUser.id);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
  res.json(
    await buildCurrentUserPayload({
      ...loggedInUser,
      grantedSoftwareLineIds: grants.map((g) => g.softwareLineId),
    })
  );
});

router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.status(204).send();
});

router.get("/me", requireAuth, async (req, res) => {
  res.json(await buildCurrentUserPayload(req.user!));
});

const updateMeSchema = z.object({
  theme: z.enum(["LIGHT", "DARK", "SYSTEM"]).optional(),
  accentColor: z.enum(["BLUE", "GREEN", "PURPLE", "ORANGE", "RED", "TEAL"]).optional(),
  locale: z.enum(["EN", "ES", "FR_CA"]).optional(),
});

router.patch("/me", requireAuth, async (req, res) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: parsed.data,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      theme: true,
      accentColor: true,
      locale: true,
      softwareLineId: true,
      activeSoftwareLineId: true,
    },
  });
  res.json(await buildCurrentUserPayload({ ...user, grantedSoftwareLineIds: req.user!.grantedSoftwareLineIds }));
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

router.patch("/password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  const valid = user && (await comparePassword(parsed.data.currentPassword, user.passwordHash));
  if (!valid) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({ where: { id: req.user!.id }, data: { passwordHash } });
  res.status(204).send();
});

const updateActiveLineSchema = z.object({
  softwareLineId: z.string().min(1),
});

// Admins can switch into any line. Project Leads and Members can only switch into their
// home line or one they've been explicitly granted (see AdminUsersPage). Read Only accounts
// never get here from the UI, and would be rejected the same way a non-granted line is.
router.patch("/active-line", requireAuth, async (req, res) => {
  const parsed = updateActiveLineSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const line = await prisma.softwareLine.findUnique({ where: { id: parsed.data.softwareLineId } });
  if (!line) {
    return res.status(404).json({ error: "Software line not found" });
  }

  if (req.user!.role !== "ADMIN") {
    const allowed =
      line.id === req.user!.softwareLineId || req.user!.grantedSoftwareLineIds.includes(line.id);
    if (!allowed) {
      return res.status(403).json({ error: "You don't have access to that software line" });
    }
  }

  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { activeSoftwareLineId: line.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      theme: true,
      accentColor: true,
      locale: true,
      softwareLineId: true,
      activeSoftwareLineId: true,
    },
  });
  res.json(await buildCurrentUserPayload({ ...user, grantedSoftwareLineIds: req.user!.grantedSoftwareLineIds }));
});

export default router;
