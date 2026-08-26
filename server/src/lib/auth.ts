import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";

const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return secret;
})();

export const COOKIE_NAME = "aurora_token";

export function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): { userId: string } {
  return jwt.verify(token, JWT_SECRET) as { userId: string };
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// A password-reset token, unlike a user-chosen password, is already high-entropy random —
// bcrypt's slow hashing (built to resist brute-forcing a guessable password) buys nothing
// here and can't be looked up by equality anyway. SHA-256 is the standard choice for this:
// fast, and exactly what's needed to find the matching row by passwordResetTokenHash.
export function generatePasswordResetToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
