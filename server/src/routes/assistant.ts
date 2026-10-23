import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { runAssistant } from "../lib/assistant";

const router = Router();
router.use(requireAuth);

// A per-person daily cap so a runaway loop (or just enthusiasm) can't run up the Anthropic bill.
// Held in memory, so it resets when the server restarts — good enough for a cost guard.
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT) || 50;
const usage = new Map<string, { day: string; count: number }>();

function takeQuota(userId: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const entry = usage.get(userId);
  if (!entry || entry.day !== today) {
    usage.set(userId, { day: today, count: 1 });
    return true;
  }
  if (entry.count >= DAILY_LIMIT) return false;
  entry.count += 1;
  return true;
}

const chatSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(20),
});

// Lets the client hide the helper when no API key is configured (admins still see it, with a
// setup message, so they know it exists).
router.get("/status", (_req, res) => {
  res.json({ enabled: Boolean(process.env.ANTHROPIC_API_KEY) });
});

router.post("/chat", async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.messages[parsed.data.messages.length - 1].role !== "user") {
    return res.status(400).json({ error: "Send a list of messages that ends with your question." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "The helper isn't set up yet — ask an admin to configure ANTHROPIC_API_KEY." });
  }
  if (!takeQuota(req.user!.id)) {
    return res.status(429).json({ error: "You've reached today's limit for the helper. It resets tomorrow." });
  }

  try {
    const reply = await runAssistant(req.user!, parsed.data.messages);
    res.json({ reply });
  } catch (err) {
    console.error("[assistant] chat failed:", err);
    res.status(502).json({ error: "The helper had trouble answering. Try again in a moment." });
  }
});

export default router;
