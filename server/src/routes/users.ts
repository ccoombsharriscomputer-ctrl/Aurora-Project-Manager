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
  teamSupportUserId: true,
  softwareLine: { select: { id: true, name: true } },
  softwareLineGrants: { select: { softwareLine: { select: { id: true, name: true } } } },
  accessRequestNotifyAllLines: true,
  accessRequestLineSubscriptions: { select: { softwareLine: { select: { id: true, name: true } } } },
} as const;

// The raw join-table shapes (softwareLineGrants / accessRequestLineSubscriptions, each
// [{ softwareLine: {...} }]) are awkward for clients to consume directly — flatten both to
// plain arrays of {id, name}.
function serializeUser<
  T extends {
    softwareLineGrants: { softwareLine: { id: string; name: string } }[];
    accessRequestLineSubscriptions: { softwareLine: { id: string; name: string } }[];
  }
>(
  user: T
): Omit<T, "softwareLineGrants" | "accessRequestLineSubscriptions"> & {
  grantedSoftwareLines: { id: string; name: string }[];
  accessRequestLines: { id: string; name: string }[];
} {
  const { softwareLineGrants, accessRequestLineSubscriptions, ...rest } = user;
  return {
    ...rest,
    grantedSoftwareLines: softwareLineGrants.map((g) => g.softwareLine),
    accessRequestLines: accessRequestLineSubscriptions.map((s) => s.softwareLine),
  };
}

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
  res.json(users.map(serializeUser));
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8).max(200),
  role: z.enum(["ADMIN", "PROJECT_LEAD", "MEMBER", "READ_ONLY"]).optional(),
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

      const existing = await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
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
    res.status(201).json(serializeUser(user));
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().transform((v) => v.trim().toLowerCase()).optional(),
  password: z.string().min(8).max(200).optional(),
  role: z.enum(["ADMIN", "PROJECT_LEAD", "MEMBER", "READ_ONLY"]).optional(),
  active: z.boolean().optional(),
  softwareLineId: z.string().min(1).optional(),
  teamSupportUserId: z.string().min(1).nullable().optional(),
  // Extra software lines a Project Lead/Member can switch into beyond their home line —
  // replace-all semantics (the full desired set, not a delta). Only meaningful for those two
  // roles; anyone else keeps an empty set (see the auto-clear below).
  grantedSoftwareLineIds: z.array(z.string().min(1)).optional(),
  // Only meaningful for role ADMIN. When true, this admin gets every access-request email
  // regardless of line, and accessRequestLineIds is ignored by the notify path (though it
  // can still be stored — see the PATCH handler for why it isn't cleared just because this
  // is true). When false, accessRequestLineIds is the full desired set of lines to
  // subscribe to — replace-all semantics, same as grantedSoftwareLineIds.
  accessRequestNotifyAllLines: z.boolean().optional(),
  accessRequestLineIds: z.array(z.string().min(1)).optional(),
});

router.patch("/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  if (req.params.id === req.user!.id && parsed.data.active === false) {
    return res.status(400).json({ error: "You cannot deactivate your own account" });
  }

  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) {
    return res.status(404).json({ error: "User not found" });
  }

  if (parsed.data.softwareLineId) {
    const line = await prisma.softwareLine.findUnique({ where: { id: parsed.data.softwareLineId } });
    if (!line) {
      return res.status(404).json({ error: "Software line not found" });
    }
  }

  if (parsed.data.email) {
    const existing = await prisma.user.findFirst({
      where: { email: { equals: parsed.data.email, mode: "insensitive" } },
    });
    if (existing && existing.id !== req.params.id) {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
  }

  const effectiveRole = parsed.data.role ?? target.role;
  const canHaveGrants = effectiveRole === "PROJECT_LEAD" || effectiveRole === "MEMBER";
  if (parsed.data.grantedSoftwareLineIds?.length && !canHaveGrants) {
    return res.status(400).json({ error: "Only Project Leads and Members can be granted extra software lines." });
  }
  const canHaveAccessRequestLines = effectiveRole === "ADMIN";
  if (parsed.data.accessRequestLineIds?.length && !canHaveAccessRequestLines) {
    return res.status(400).json({ error: "Only admins receive access-request notifications." });
  }

  const homeLineId = parsed.data.softwareLineId ?? target.softwareLineId;
  // Explicit grants are provided as the full desired set; a role change away from
  // Project Lead/Member (with no explicit grants in this same request) clears any it had —
  // an admin or read-only account has no use for them, so don't leave stale rows behind.
  const nextGrantIds = parsed.data.grantedSoftwareLineIds !== undefined
    ? Array.from(new Set(parsed.data.grantedSoftwareLineIds)).filter((id) => id !== homeLineId)
    : !canHaveGrants
      ? []
      : undefined;

  if (nextGrantIds !== undefined && nextGrantIds.length > 0) {
    const validCount = await prisma.softwareLine.count({ where: { id: { in: nextGrantIds } } });
    if (validCount !== nextGrantIds.length) {
      return res.status(400).json({ error: "One or more software lines were not found." });
    }
  }

  // Same full-desired-set/role-clearing shape as grants above, but no home-line exclusion —
  // unlike a Project Lead/Member's home line, an admin has no "implicit" line here, so all
  // five are legitimate choices when accessRequestNotifyAllLines is off. Toggling
  // accessRequestNotifyAllLines back on deliberately does NOT clear these rows — they're
  // just ignored while it's true, so a later toggle-off remembers the previous selection.
  const nextAccessRequestLineIds = parsed.data.accessRequestLineIds !== undefined
    ? Array.from(new Set(parsed.data.accessRequestLineIds))
    : !canHaveAccessRequestLines
      ? []
      : undefined;

  if (nextAccessRequestLineIds !== undefined && nextAccessRequestLineIds.length > 0) {
    const validCount = await prisma.softwareLine.count({ where: { id: { in: nextAccessRequestLineIds } } });
    if (validCount !== nextAccessRequestLineIds.length) {
      return res.status(400).json({ error: "One or more software lines were not found." });
    }
  }

  const { password, grantedSoftwareLineIds, accessRequestLineIds, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if (password) {
    data.passwordHash = await hashPassword(password);
  }

  // Reassigning a user's line does not retroactively touch their existing project
  // memberships or task assignments in the old line — accepted data-hygiene debt, not a
  // bug: the by-user report is membership-driven, so they simply stop appearing there.
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: req.params.id }, data, select: userSelect }),
    ...(nextGrantIds !== undefined
      ? [
          prisma.userSoftwareLineGrant.deleteMany({ where: { userId: req.params.id } }),
          ...(nextGrantIds.length
            ? [
                prisma.userSoftwareLineGrant.createMany({
                  data: nextGrantIds.map((softwareLineId) => ({ userId: req.params.id, softwareLineId })),
                }),
              ]
            : []),
        ]
      : []),
    ...(nextAccessRequestLineIds !== undefined
      ? [
          prisma.accessRequestLineSubscription.deleteMany({ where: { userId: req.params.id } }),
          ...(nextAccessRequestLineIds.length
            ? [
                prisma.accessRequestLineSubscription.createMany({
                  data: nextAccessRequestLineIds.map((softwareLineId) => ({ userId: req.params.id, softwareLineId })),
                }),
              ]
            : []),
        ]
      : []),
  ]);
  // The transaction's first result reflects the user row from before the grant/subscription
  // rows changed in this same call — re-select once more so the response's
  // grantedSoftwareLines/accessRequestLines are current.
  const fresh = nextGrantIds !== undefined || nextAccessRequestLineIds !== undefined
    ? await prisma.user.findUniqueOrThrow({ where: { id: req.params.id }, select: userSelect })
    : user;
  emitUpdate({ scope: "users" });
  res.json(serializeUser(fresh));
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
