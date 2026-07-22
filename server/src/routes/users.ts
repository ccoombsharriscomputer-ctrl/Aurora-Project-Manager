import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { attachUserIfPresent, effectiveSoftwareLineId, requireAdmin, requireAuth } from "../middleware/auth";
import { emitUpdate } from "../lib/realtime";
import { hashPassword } from "../lib/auth";

const router = Router();

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
  softwareLine: { select: { id: true, name: true } },
} as const;

// Default: only users in the caller's effective line (safe for every assignee/member
// picker, every role). `?all=true` is admin-only and returns every user across every
// line, for the Admin > Users page — silently ignored for non-admins.
router.get("/", requireAuth, async (req, res) => {
  const wantsAll = req.query.all === "true" && req.user!.role === "ADMIN";
  const users = await prisma.user.findMany({
    where: wantsAll ? {} : { softwareLineId: effectiveSoftwareLineId(req.user!) },
    select: userSelect,
    orderBy: { name: "asc" },
  });
  res.json(users);
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  role: z.enum(["ADMIN", "PROJECT_LEAD", "MEMBER"]).optional(),
  softwareLineId: z.string().min(1),
  accessRequestId: z.string().min(1).optional(),
});

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Normally admin-only, but if the database has zero users at all there's no admin who
// could possibly authorize this — so this one route allows an unauthenticated caller
// through ONLY in that bootstrap case (checked again inside the transaction, below, to
// close the race between an outer check and the actual insert). The moment any user
// exists, this door closes and every request must be an authenticated admin.
router.post("/", attachUserIfPresent, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { name, email, password, role, softwareLineId, accessRequestId } = parsed.data;

  try {
    const user = await prisma.$transaction(async (tx) => {
      const isBootstrap = (await tx.user.count()) === 0;
      if (!isBootstrap) {
        if (!req.user) {
          throw new HttpError(401, "Not authenticated");
        }
        if (req.user.role !== "ADMIN") {
          throw new HttpError(403, "Admin access required");
        }
      }

      const line = await tx.softwareLine.findUnique({ where: { id: softwareLineId } });
      if (!line) {
        throw new HttpError(404, "Software line not found");
      }

      if (accessRequestId && req.user) {
        const resolved = await tx.accessRequest.updateMany({
          where: { id: accessRequestId, status: "PENDING" },
          data: { status: "APPROVED", decidedById: req.user.id, decidedAt: new Date() },
        });
        if (resolved.count === 0) {
          throw new HttpError(400, "This access request has already been resolved");
        }
      }

      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) {
        throw new HttpError(409, "An account with that email already exists");
      }

      const passwordHash = await hashPassword(password);
      return tx.user.create({
        data: {
          name,
          email,
          passwordHash,
          role: isBootstrap ? "ADMIN" : role ?? "MEMBER",
          softwareLineId: line.id,
        },
        select: userSelect,
      });
    });

    emitUpdate({ scope: "users" });
    if (accessRequestId) emitUpdate({ scope: "access-requests" });
    res.status(201).json(user);
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).max(200).optional(),
  role: z.enum(["ADMIN", "PROJECT_LEAD", "MEMBER"]).optional(),
  active: z.boolean().optional(),
  softwareLineId: z.string().min(1).optional(),
});

router.patch("/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  if (req.params.id === req.user!.id && parsed.data.active === false) {
    return res.status(400).json({ error: "You cannot deactivate your own account" });
  }

  if (parsed.data.softwareLineId) {
    const line = await prisma.softwareLine.findUnique({ where: { id: parsed.data.softwareLineId } });
    if (!line) {
      return res.status(404).json({ error: "Software line not found" });
    }
  }

  if (parsed.data.email) {
    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing && existing.id !== req.params.id) {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
  }

  const { password, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if (password) {
    data.passwordHash = await hashPassword(password);
  }

  // Reassigning a user's line does not retroactively touch their existing project
  // memberships or task assignments in the old line — accepted data-hygiene debt, not a
  // bug: the by-user report is membership-driven, so they simply stop appearing there.
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data,
    select: userSelect,
  });
  emitUpdate({ scope: "users" });
  res.json(user);
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  if (req.params.id === req.user!.id) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: {
      _count: {
        select: {
          createdProjects: true,
          createdTasks: true,
          createdProjectTypes: true,
          createdSubProjects: true,
          createdChecklistItems: true,
          createdTaskTemplates: true,
          comments: true,
          attachments: true,
          timeEntries: true,
          activities: true,
        },
      },
    },
  });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const totalActivity = Object.values(user._count).reduce((sum, count) => sum + count, 0);
  if (totalActivity > 0) {
    return res.status(400).json({
      error: `Can't delete ${user.name} — they have activity in the app (projects, tasks, comments, time entries, etc.). Deactivate them instead.`,
    });
  }

  await prisma.user.delete({ where: { id: user.id } });
  emitUpdate({ scope: "users" });
  res.status(204).send();
});

export default router;
