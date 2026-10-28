import { Router, type Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { comparePassword, generateTicketFinderToken, hashTicketFinderToken } from "../lib/auth";
import { requireTicketFinderDevice } from "../middleware/auth";
import { findAiJob, startAiJob, TicketAiFailedError, TicketAiNotConfiguredError } from "../lib/ticketResearchAi";
import {
  customerSnapshot,
  fetchTeamSupportCustomers,
  fetchTicketHistory,
  findSimilarTickets,
  searchTickets,
  TeamSupportNotConfiguredError,
  TeamSupportTicketNotFoundError,
  TeamSupportUpstreamError,
} from "../lib/teamSupport";

// Backs the Ticket Finder desktop program: search-only access to TeamSupport tickets for
// support staff, using APM's own TeamSupport key so it never leaves this server. The program
// signs in once with an APM email and password (device-login) and from then on sends the key
// it got back; see requireTicketFinderDevice.
const router = Router();

function sendTeamSupportError(res: Response, err: unknown) {
  if (err instanceof TeamSupportNotConfiguredError) {
    return res.status(503).json({ error: "TeamSupport isn't set up on the server yet." });
  }
  if (err instanceof TeamSupportTicketNotFoundError) {
    return res.status(404).json({ error: err.message });
  }
  if (err instanceof TeamSupportUpstreamError) {
    // TeamSupport reports "over the daily request limit" as a 403 (see the rate-limit note in
    // the project history), so say that plainly instead of "permission denied".
    if (err.status === 403) {
      return res.status(502).json({ error: "TeamSupport refused the request — the daily API limit may be used up. Try again later." });
    }
    if (err.status === null && /abort|timeout/i.test(err.message)) {
      return res.status(504).json({ error: "TeamSupport took too long. Try a shorter date range or more specific words." });
    }
    return res.status(502).json({ error: `Couldn't reach TeamSupport (${err.message}).` });
  }
  return res.status(502).json({ error: "Couldn't reach TeamSupport. Try again shortly." });
}

// Simple in-memory brakes: wrong-password guessing on sign-in, and runaway searching against
// the shared 25,000-calls-a-day TeamSupport quota. Per server process, reset on restart.
function slidingLimit(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}

const signInAttempt = slidingLimit(10, 15 * 60 * 1000);
const searchAttempt = slidingLimit(30, 60 * 1000);
// Cached repeats of the same ticket don't cost anything, but still count here.
const aiAttempt = slidingLimit(20, 60 * 60 * 1000);

const deviceLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceName: z.string().trim().min(1).max(100).default("Unknown PC"),
});

router.post("/device-login", async (req, res) => {
  const parsed = deviceLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid email or password" });
  }
  const { email, password, deviceName } = parsed.data;
  if (!signInAttempt(`${req.ip}|${email.toLowerCase()}`)) {
    return res.status(429).json({ error: "Too many sign-in attempts. Wait 15 minutes and try again." });
  }

  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (!user || !user.active || !(await comparePassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = generateTicketFinderToken();
  await prisma.ticketFinderDevice.create({
    data: { userId: user.id, tokenHash: hashTicketFinderToken(token), deviceName },
  });
  res.json({ token, user: { name: user.name, email: user.email } });
});

router.use(requireTicketFinderDevice);

router.get("/me", (req, res) => {
  res.json({ name: req.ticketFinder!.name, email: req.ticketFinder!.email });
});

router.post("/device-logout", async (req, res) => {
  await prisma.ticketFinderDevice.update({ where: { id: req.ticketFinder!.deviceId }, data: { revokedAt: new Date() } });
  res.status(204).send();
});

router.get("/customers", async (_req, res) => {
  try {
    res.json(await fetchTeamSupportCustomers());
  } catch (err) {
    sendTeamSupportError(res, err);
  }
});

const searchSchema = z
  .object({
    text: z.string().trim().max(200).optional(),
    ticketNumber: z.string().trim().regex(/^\d{1,10}$/, "Ticket number must be digits only").optional().or(z.literal("")),
    customerId: z.string().trim().regex(/^\d{1,12}$/).optional().or(z.literal("")),
    assignee: z.string().trim().max(100).optional(),
    status: z.enum(["open", "closed", "all"]).default("all"),
    // Days back to search; "all" (or missing) = no date limit.
    since: z.union([z.literal("all"), z.coerce.number().int().min(1).max(36500)]).default(365),
  })
  .refine((q) => q.ticketNumber || q.customerId || (q.text && q.text.length >= 2) || (q.assignee && q.assignee.length >= 2), {
    message: "Enter a ticket number, a customer, or at least 2 letters to search for.",
  });

router.get("/tickets", async (req, res) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  if (!searchAttempt(req.ticketFinder!.deviceId)) {
    return res.status(429).json({ error: "That's a lot of searches in a minute. Wait a moment and try again." });
  }
  const q = parsed.data;
  try {
    res.json(
      await searchTickets({
        text: q.text || undefined,
        ticketNumber: q.ticketNumber || undefined,
        customerId: q.customerId || undefined,
        assignee: q.assignee || undefined,
        status: q.status,
        sinceDays: q.since === "all" ? null : q.since,
      })
    );
  } catch (err) {
    sendTeamSupportError(res, err);
  }
});

router.get("/tickets/:ticketNumber/history", async (req, res) => {
  if (!/^\d{1,10}$/.test(req.params.ticketNumber)) {
    return res.status(400).json({ error: "Ticket number must be digits only" });
  }
  if (!searchAttempt(req.ticketFinder!.deviceId)) {
    return res.status(429).json({ error: "That's a lot of lookups in a minute. Wait a moment and try again." });
  }
  try {
    res.json(await fetchTicketHistory(req.params.ticketNumber));
  } catch (err) {
    sendTeamSupportError(res, err);
  }
});

// Research helpers for working out what's wrong and how it was fixed before. Both only read
// from TeamSupport, and both are cached 30 minutes per ticket.
router.get("/tickets/:ticketNumber/similar", async (req, res) => {
  if (!/^\d{1,10}$/.test(req.params.ticketNumber)) {
    return res.status(400).json({ error: "Ticket number must be digits only" });
  }
  if (!searchAttempt(req.ticketFinder!.deviceId)) {
    return res.status(429).json({ error: "That's a lot of lookups in a minute. Wait a moment and try again." });
  }
  try {
    res.json(await findSimilarTickets(req.params.ticketNumber));
  } catch (err) {
    sendTeamSupportError(res, err);
  }
});

// AI research (summary, likely cause, steps, reply draft). A run outlasts Cloudflare's 100 s
// request limit, so the first call starts it and answers 202 {pending: true}; the program asks
// again every few seconds until it gets the result. Costs real money per run, so finished
// results are kept 30 minutes per ticket and new runs are limited per device. Still
// read-only toward TeamSupport.
router.get("/tickets/:ticketNumber/ai-research", (req, res) => {
  const ticketNumber = req.params.ticketNumber;
  if (!/^\d{1,10}$/.test(ticketNumber)) {
    return res.status(400).json({ error: "Ticket number must be digits only" });
  }
  let job = findAiJob(ticketNumber);
  if (!job) {
    if (!aiAttempt(req.ticketFinder!.deviceId)) {
      return res.status(429).json({ error: "You've used the AI research a lot this hour. Try again later." });
    }
    job = startAiJob(ticketNumber);
  }
  if (job.status === "pending") {
    return res.status(202).json({ pending: true, startedAt: new Date(job.at).toISOString() });
  }
  if (job.status === "done") {
    return res.json(job.result);
  }
  const err = job.error;
  if (err instanceof TicketAiNotConfiguredError) {
    return res.status(503).json({ error: "AI research isn't set up on the server." });
  }
  if (err instanceof TicketAiFailedError) {
    return res.status(502).json({ error: err.message });
  }
  if (err instanceof Anthropic.APIError) {
    console.error(`[ticketAi] Claude API error ${err.status}: ${err.message}`);
    return res.status(502).json({
      error:
        err.status === 401
          ? "The server's AI key isn't valid. Ask an APM admin to check ANTHROPIC_API_KEY."
          : err.status === 429 || (err.status ?? 0) >= 500
            ? "The AI service is busy. Try again in a minute."
            : // Claude's own reason (never includes the key), so the next report says what's wrong.
              `The AI request failed (${err.status}): ${err.message.slice(0, 300)}`,
    });
  }
  console.error(`[ticketAi] research failed: ${err instanceof Error ? err.message : err}`);
  sendTeamSupportError(res, err);
});

router.get("/tickets/:ticketNumber/customer", async (req, res) => {
  if (!/^\d{1,10}$/.test(req.params.ticketNumber)) {
    return res.status(400).json({ error: "Ticket number must be digits only" });
  }
  if (!searchAttempt(req.ticketFinder!.deviceId)) {
    return res.status(429).json({ error: "That's a lot of lookups in a minute. Wait a moment and try again." });
  }
  try {
    res.json(await customerSnapshot(req.params.ticketNumber));
  } catch (err) {
    sendTeamSupportError(res, err);
  }
});

export default router;
