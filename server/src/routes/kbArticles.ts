import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireKbImporter } from "../middleware/auth";
import { currentSortJob, startSortJob, type SortJob } from "../lib/kbArticles";
import { sendAiError } from "./ticketSearch";

// Knowledge Base import on the Fix Playbooks page: TRIO Knowledge Base articles sorted by AI,
// and the lead's pick for each. Only users given the import (Users page) — not every admin.
const router = Router();
router.use(requireAuth, requireKbImporter);

function jobState(job: SortJob | null) {
  if (!job) return null;
  return { status: job.status, startedAt: new Date(job.at).toISOString(), result: job.result ?? null };
}

router.get("/", async (_req, res) => {
  const articles = await prisma.kbArticle.findMany({ orderBy: { title: "asc" } });
  const job = currentSortJob();
  res.json({ articles, sort: job?.status === "failed" ? null : jobState(job) });
});

// Reads the Knowledge Base and sorts up to 40 new or edited articles in the background.
// Answers 202 at once; GET /sort checks on it.
router.post("/sort", (_req, res) => {
  res.status(202).json(jobState(startSortJob()));
});

router.get("/sort", (_req, res) => {
  const job = currentSortJob();
  if (job?.status === "failed") {
    return sendAiError(res, job.error);
  }
  res.json(jobState(job));
});

const decisionSchema = z.object({ decision: z.enum(["undecided", "wanted", "skipped"]) });

router.patch("/:ticketNumber", async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Choose wanted, skipped or undecided" });
  }
  const existing = await prisma.kbArticle.findUnique({ where: { ticketNumber: req.params.ticketNumber } });
  if (!existing) {
    return res.status(404).json({ error: "Article not found" });
  }
  const article = await prisma.kbArticle.update({
    where: { ticketNumber: existing.ticketNumber },
    data: { decision: parsed.data.decision, decidedByName: req.user!.name },
  });
  res.json(article);
});

export default router;
