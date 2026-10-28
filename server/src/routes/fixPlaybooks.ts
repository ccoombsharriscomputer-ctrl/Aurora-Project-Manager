import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { findDraftJob, forgetActivePlaybooks, forgetDraftJob, startDraftJob } from "../lib/fixPlaybooks";
import { sendAiError } from "./ticketSearch";

// Admin page for the fix playbooks Ticket Finder shows next to matching tickets.
const router = Router();
router.use(requireAuth, requireAdmin);

router.get("/", async (_req, res) => {
  res.json(await prisma.fixPlaybook.findMany({ orderBy: { title: "asc" } }));
});

// Lists are trimmed, emptied of blanks and de-duplicated (ignoring case).
const cleanList = (max: number) =>
  z
    .array(z.string().trim().max(100))
    .max(max)
    .transform((list) => {
      const seen = new Set<string>();
      return list.filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
    });

const playbookSchema = z.object({
  title: z.string().trim().min(1, "Give the playbook a title").max(200),
  matchPhrases: cleanList(40),
  products: cleanList(20),
  steps: z.string().max(10_000),
  active: z.boolean(),
  sourceTickets: z.array(z.string().regex(/^\d{1,10}$/)).max(20).default([]),
});

router.post("/", async (req, res) => {
  const parsed = playbookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const playbook = await prisma.fixPlaybook.create({ data: { ...parsed.data, updatedByName: req.user!.name } });
  forgetActivePlaybooks();
  res.status(201).json(playbook);
});

router.patch("/:id", async (req, res) => {
  const parsed = playbookSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const existing = await prisma.fixPlaybook.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: "Playbook not found" });
  }
  const steps = parsed.data.steps ?? existing.steps;
  if ((parsed.data.active ?? existing.active) && !steps.trim()) {
    return res.status(400).json({ error: "Add the steps before switching this playbook on." });
  }
  const playbook = await prisma.fixPlaybook.update({
    where: { id: existing.id },
    data: { ...parsed.data, updatedByName: req.user!.name },
  });
  forgetActivePlaybooks();
  res.json(playbook);
});

router.delete("/:id", async (req, res) => {
  const existing = await prisma.fixPlaybook.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: "Playbook not found" });
  }
  await prisma.fixPlaybook.delete({ where: { id: existing.id } });
  forgetActivePlaybooks();
  forgetDraftJob(existing.id);
  res.status(204).send();
});

// AI draft of the steps from how matching closed tickets were fixed (read-only toward
// TeamSupport). POST starts a fresh draft; GET checks on it. Both answer 202 {pending: true}
// until it's ready. Nothing is saved: the page fills the form and the admin saves it.
router.post("/:id/ai-draft", async (req, res) => {
  const existing = await prisma.fixPlaybook.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: "Playbook not found" });
  }
  const running = findDraftJob(existing.id);
  const job = running?.status === "pending" ? running : startDraftJob(existing.id);
  res.status(202).json({ pending: true, startedAt: new Date(job.at).toISOString() });
});

router.get("/:id/ai-draft", (req, res) => {
  const job = findDraftJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "No draft is running for this playbook." });
  }
  if (job.status === "pending") {
    return res.status(202).json({ pending: true, startedAt: new Date(job.at).toISOString() });
  }
  if (job.status === "done") {
    return res.json(job.result);
  }
  sendAiError(res, job.error);
});

export default router;
