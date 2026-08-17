import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { runDailyNotifications } from "../lib/notifications";
import { emailIsConfigured, sendTestEmail } from "../lib/email";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const runDigestSchema = z.object({
  // Defaults to a real run (matching what the scheduler does). dryRun:true skips both the
  // send and the FollowUp.remindedAt mutation, for repeatable local testing.
  dryRun: z.boolean().optional(),
});

// Force-runs today's digest on demand — this is how the feature gets tested without waiting
// for the configured send hour.
router.post("/run-digest", async (req, res) => {
  const parsed = runDigestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const summary = await runDailyNotifications({ dryRun: parsed.data.dryRun ?? false });
  res.json({ ...summary, emailConfigured: emailIsConfigured });
});

// Sends one test email to the calling admin — a pure send-path smoke test, independent of
// the digest-building logic.
router.post("/test", async (req, res) => {
  await sendTestEmail(req.user!.email);
  res.json({ ok: true, sentTo: req.user!.email, emailConfigured: emailIsConfigured });
});

export default router;
