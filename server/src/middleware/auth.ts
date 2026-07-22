import { Request, Response, NextFunction } from "express";
import { COOKIE_NAME, verifyToken } from "../lib/auth";
import { prisma } from "../lib/prisma";

export interface AuthedUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "PROJECT_LEAD" | "MEMBER" | "READ_ONLY";
  theme: "LIGHT" | "DARK" | "SYSTEM";
  accentColor: "BLUE" | "GREEN" | "PURPLE" | "ORANGE" | "RED" | "TEAL";
  locale: "EN" | "ES" | "FR_CA";
  softwareLineId: string;
  activeSoftwareLineId: string | null;
}

// The software line whose data this request should operate on. Only admins can ever
// differ from their home line (via activeSoftwareLineId) — everyone else is permanently
// scoped to softwareLineId. Always derived server-side from the authenticated user, never
// from client input, so a non-admin can never see another line's data.
export function effectiveSoftwareLineId(user: AuthedUser): string {
  return user.role === "ADMIN" ? user.activeSoftwareLineId ?? user.softwareLineId : user.softwareLineId;
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
      softwareLineId: user.softwareLineId,
      activeSoftwareLineId: user.activeSoftwareLineId,
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

// Blocks every mutating route for READ_ONLY accounts — they can view everything an
// authenticated user can see, but never create/edit/delete data. Not applied to a user's
// own account settings (theme/locale/password), since those aren't app data.
export function blockReadOnly(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === "READ_ONLY") {
    return res.status(403).json({ error: "Read-only accounts can't make changes" });
  }
  next();
}
