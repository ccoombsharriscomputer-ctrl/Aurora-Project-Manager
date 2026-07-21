import { Request, Response, NextFunction } from "express";
import { COOKIE_NAME, verifyToken } from "../lib/auth";
import { prisma } from "../lib/prisma";

export interface AuthedUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER";
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const { userId } = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
  } catch {
    return res.status(401).json({ error: "Not authenticated" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
