import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireKbImporter } from "../middleware/auth";
import { draftJob, sortJob, startDraftJob, startSortJob, type BackgroundJob } from "../lib/kbArticles";
import { sendAiError } from "./ticketSearch";

// Knowledge Base import on the Fix Playbooks page: TRIO Knowledge Base articles sorted by AI,
// the lead's pick for each, and AI-drafted playbooks from the picks. Only users given the import
// (Users page) — not every admin.
const router = Router();
router.use(requireAuth, requireKbImporter);

function jobState<T>(job: BackgroundJob<T> | null) {
  if (!job || job.status === "failed") return null;
  return { status: job.status, startedAt: new Date(job.at).toISOString(), result: job.result ?? null };
}

router.get("/", async (_req, res) => {
  const articles = await prisma.kbArticle.findMany({ orderBy: { title: "asc" } });
  // A draft playbook deleted since doesn't count as made.
  const ids = articles.map((a) => a.playbookId).filter((id): id is string => !!id);
  const existing = new Set(
    (await prisma.fixPlaybook.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((p) => p.id)
  );
  res.json({
    articles: articles.map((a) => ({ ...a, playbookId: a.playbookId && existing.has(a.playbookId) ? a.playbookId : null })),
    sort: jobState(sortJob.peek()),
    drafts: jobState(draftJob.peek()),
  });
});

// Reads the Knowledge Base and sorts up to 40 new or edited articles in the background.
// Answers 202 at once; GET /sort checks on it.
router.post("/sort", (_req, res) => {
  res.status(202).json(jobState(startSortJob()));
});

router.get("/sort", (_req, res) => {
  const job = sortJob.current();
  if (job?.status === "failed") {
    return sendAiError(res, job.error);
  }
  res.json(jobState(job));
});

// Drafts a switched-off playbook from up to 9 picked articles in the background.
router.post("/drafts", (req, res) => {
  res.status(202).json(jobState(startDraftJob(req.user!.name)));
});

router.get("/drafts", (_req, res) => {
  const job = draftJob.current();
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
