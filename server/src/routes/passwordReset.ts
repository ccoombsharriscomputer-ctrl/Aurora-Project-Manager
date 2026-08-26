import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { generatePasswordResetToken, hashPasswordResetToken, hashPassword } from "../lib/auth";
import { sendPasswordResetEmail } from "../lib/email";

const router = Router();

// How long a requested reset link stays valid — the single source of truth both the email
// copy (via sendPasswordResetEmail's expiresInHours) and the confirm route's own expiry check
// below are built from.
const TOKEN_EXPIRY_HOURS = 1;

const requestSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
});

// Public, unauthenticated — like POST /access-requests, this never reveals account state.
// Whether the email belongs to a real, active account or not, the response is identical and
// takes about the same shape of work either way, so this can't be used to enumerate who has
// an account here.
router.post("/request", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const user = await prisma.user.findFirst({ where: { email: { equals: parsed.data.email, mode: "insensitive" } } });
  if (user && user.active) {
    const token = generatePasswordResetToken();
    const tokenHash = hashPasswordResetToken(token);
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
    // Overwrites whatever reset was previously pending for this user — requesting a new one
    // implicitly invalidates any earlier link still sitting in an old email.
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt },
    });
    await sendPasswordResetEmail({
      to: user.email,
      locale: user.locale,
      userName: user.name,
      token,
      expiresInHours: TOKEN_EXPIRY_HOURS,
    }).catch((err) => console.error("Failed to send password reset email:", err));
  }

  res.status(200).json({ ok: true });
});

const confirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

router.post("/confirm", async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const tokenHash = hashPasswordResetToken(parsed.data.token);
  const user = await prisma.user.findFirst({ where: { passwordResetTokenHash: tokenHash } });
  if (!user || !user.active || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
    return res.status(400).json({ error: "This reset link is invalid or has expired. Request a new one." });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  // Single-use: the token is cleared the moment it's consumed, whether or not anyone ever
  // requests another one.
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, passwordResetTokenHash: null, passwordResetExpiresAt: null },
  });

  res.status(200).json({ ok: true });
});

export default router;
