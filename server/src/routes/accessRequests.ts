import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { emitUpdate } from "../lib/realtime";
import { notifyAdminsOfAccessRequest } from "../lib/email";

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  message: z.string().max(2000).optional(),
});

// Public — the only unauthenticated write endpoint in the app. Never creates an
// account or a session; just records the request for an admin to act on.
router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const request = await prisma.accessRequest.create({ data: parsed.data });

  await notifyAdminsOfAccessRequest({
    name: request.name,
    email: request.email,
    message: request.message,
  }).catch((err) => console.error("Failed to notify admins of access request:", err));

  emitUpdate({ scope: "access-requests" });
  res.status(201).json({ ok: true });
});

router.get("/", requireAuth, requireAdmin, async (_req, res) => {
  const requests = await prisma.accessRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(requests);
});

router.post("/:id/deny", requireAuth, requireAdmin, async (req, res) => {
  const result = await prisma.accessRequest.updateMany({
    where: { id: req.params.id, status: "PENDING" },
    data: { status: "DENIED", decidedById: req.user!.id, decidedAt: new Date() },
  });
  if (result.count === 0) {
    return res.status(400).json({ error: "This request has already been resolved" });
  }

  emitUpdate({ scope: "access-requests" });
  res.status(204).send();
});

export default router;
