import { Request, Response, NextFunction } from "express";
import { COOKIE_NAME, hashTicketFinderToken, verifyToken } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { effectiveDashboardLayout, type DashboardWidgetEntry } from "../lib/dashboardWidgets";

export interface AuthedUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "PROJECT_LEAD" | "MEMBER" | "READ_ONLY" | "TICKET_SEARCH";
  theme: "LIGHT" | "DARK" | "SYSTEM" | "MIDNIGHT" | "AURORA" | "SUNSET" | "OCEAN" | "FOREST" | "PASTEL" | "SLATE" | "CONTRAST" | "GOTHAM" | "METROPOLIS" | "EMPIRE" | "TATOOINE" | "HOTH" | "GALAXY";
  accentColor: "BLUE" | "GREEN" | "PURPLE" | "ORANGE" | "RED" | "TEAL" | "INDIGO" | "PINK" | "CYAN" | "GOLD" | "LIME" | "GRAPHITE";
  locale: "EN" | "ES" | "FR_CA";
  softwareLineId: string;
  activeSoftwareLineId: string | null;
  grantedSoftwareLineIds: string[];
  teamSupportUserId: string | null;
  canEditPlaybooks: boolean;
  // Already resolved to "what actually renders" (default-filled and role-filtered) — see
  // lib/dashboardWidgets.ts — so nothing downstream needs to re-derive it from the raw column.
  dashboardLayout: DashboardWidgetEntry[];
}

// The software line whose data this request should operate on. Admins can switch to any
// line via activeSoftwareLineId. Project Leads and Members can switch too, but only into
// their home line or one they've been explicitly granted — activeSoftwareLineId is never
// trusted blindly for them, so a stale/tampered value (e.g. a grant later revoked) falls
// back to their home line instead of leaking another line's data. Read Only stays
// permanently on its home line (no UI ever sets activeSoftwareLineId for that role).
export function effectiveSoftwareLineId(user: AuthedUser): string {
  if (!user.activeSoftwareLineId) return user.softwareLineId;
  if (user.role === "ADMIN") return user.activeSoftwareLineId;
  const allowed =
    user.activeSoftwareLineId === user.softwareLineId || user.grantedSoftwareLineIds.includes(user.activeSoftwareLineId);
  return allowed ? user.activeSoftwareLineId : user.softwareLineId;
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
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { softwareLineGrants: { select: { softwareLineId: true } } },
    });
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
      grantedSoftwareLineIds: user.softwareLineGrants.map((g) => g.softwareLineId),
      teamSupportUserId: user.teamSupportUserId,
      canEditPlaybooks: user.canEditPlaybooks,
      dashboardLayout: effectiveDashboardLayout(user.dashboardLayout, user.role),
    };
  } catch {
    return null;
  }
}

// The Support line's people (and any Ticket Search account) use the Ticket Finder program, not
// APM. Admins are never limited.
export const SUPPORT_LINE_ID = "support";

export function isSupportOnly(user: { role: AuthedUser["role"]; softwareLineId: string }): boolean {
  return user.role !== "ADMIN" && (user.role === "TICKET_SEARCH" || user.softwareLineId === SUPPORT_LINE_ID);
}

// What a support-only account may use with a sign-in cookie: with playbook access, its own
// account (Settings) and the Fix Playbooks page; without it, nothing at all (sign-out has no
// requireAuth, so it still works). Checked by baseUrl in requireAuth, which every router uses,
// so a route added later is blocked for them by default rather than needing to opt out.
// /login refuses them without playbook access too; this covers someone who already had a
// cookie when they were moved to Support or lost playbook access.
const SUPPORT_ONLY_ALLOWED_BASES = ["/api/auth", "/api/fix-playbooks"];

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (isSupportOnly(user) && !(user.canEditPlaybooks && SUPPORT_ONLY_ALLOWED_BASES.includes(req.baseUrl))) {
    return res.status(403).json({ error: "This account can only use the Ticket Finder program" });
  }
  req.user = user;
  next();
}

export interface TicketFinderCaller {
  userId: string;
  name: string;
  email: string;
  deviceId: string;
}

declare global {
  namespace Express {
    interface Request {
      ticketFinder?: TicketFinderCaller;
    }
  }
}

// For /api/ticket-search only: the Ticket Finder program sends the key it got at sign-in as
// "Authorization: Bearer <key>". Deliberately separate from requireAuth — the key is never
// accepted anywhere else, so a copied key can search tickets and nothing more. Any active
// APM user may use the program, not just Ticket Search accounts.
export async function requireTicketFinderDevice(req: Request, res: Response, next: NextFunction) {
  const header = req.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    return res.status(401).json({ error: "Not signed in" });
  }
  const device = await prisma.ticketFinderDevice.findUnique({
    where: { tokenHash: hashTicketFinderToken(match[1]) },
    include: { user: { select: { id: true, name: true, email: true, active: true } } },
  });
  if (!device || device.revokedAt || !device.user.active) {
    return res.status(401).json({ error: "Not signed in" });
  }
  // At most one write an hour per device, not one per search.
  if (Date.now() - device.lastUsedAt.getTime() > 60 * 60 * 1000) {
    await prisma.ticketFinderDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } });
  }
  req.ticketFinder = { userId: device.user.id, name: device.user.name, email: device.user.email, deviceId: device.id };
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

// Fix playbooks (Ticket Finder): admins, plus anyone an admin has given playbook access.
export function requirePlaybookEditor(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN" && !req.user?.canEditPlaybooks) {
    return res.status(403).json({ error: "Playbook access required" });
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
