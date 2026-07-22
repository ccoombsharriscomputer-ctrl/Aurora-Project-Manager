import { Request, Response, NextFunction } from "express";
import { COOKIE_NAME, verifyToken } from "../lib/auth";
import { prisma } from "../lib/prisma";

export interface AuthedUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "PROJECT_LEAD" | "MEMBER";
  theme: "LIGHT" | "DARK" | "SYSTEM";
  accentColor: "BLUE" | "GREEN" | "PURPLE" | "ORANGE" | "RED" | "TEAL";
  locale: "EN" | "ES" | "FR_CA";
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

async function getUserFromRequest(req: Request): Promise<AuthedUser | null> {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return null;
  }
  try {
    const { userId } = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) {
      return null;
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      theme: user.theme,
      accentColor: user.accentColor,
      locale: user.locale,
    };
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  req.user = user;
  next();
}

// Populates req.user from a valid cookie if present, but never rejects — for the one
// endpoint (bootstrap admin creation) that must work both unauthenticated (empty
// database) and authenticated (normal admin-creates-user case).
export async function attachUserIfPresent(req: Request, _res: Response, next: NextFunction) {
  const user = await getUserFromRequest(req);
  if (user) {
    req.user = user;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

export function requireProjectTypeManager(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN" && req.user?.role !== "PROJECT_LEAD") {
    return res.status(403).json({ error: "Admin or Project Lead access required" });
  }
  next();
}
