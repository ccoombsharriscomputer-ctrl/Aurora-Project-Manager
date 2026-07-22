import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

// Public — line names aren't sensitive, and both the public Request Access form and the
// authenticated admin line-switcher need this list.
router.get("/", async (_req, res) => {
  const lines = await prisma.softwareLine.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  res.json(lines);
});

export default router;
