import { prisma } from "./prisma";
import type { AuthedUser } from "../middleware/auth";

// The lines a user can switch into: admins get every line (already unrestricted); everyone
// else gets their home line plus whatever they've been explicitly granted. Shared by every
// endpoint that returns a CurrentUser payload (login, /me, PATCH /me, PATCH /active-line) so
// the client's line switcher always has an accurate, un-duplicated option list to render.
async function accessibleSoftwareLinesFor(user: {
  role: AuthedUser["role"];
  softwareLineId: string;
  grantedSoftwareLineIds: string[];
}) {
  if (user.role === "ADMIN") {
    return prisma.softwareLine.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  }
  const ids = Array.from(new Set([user.softwareLineId, ...user.grantedSoftwareLineIds]));
  return prisma.softwareLine.findMany({
    where: { id: { in: ids } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export async function buildCurrentUserPayload(user: {
  id: string;
  name: string;
  email: string;
  role: AuthedUser["role"];
  theme: AuthedUser["theme"];
  accentColor: AuthedUser["accentColor"];
  locale: AuthedUser["locale"];
  softwareLineId: string;
  activeSoftwareLineId: string | null;
  grantedSoftwareLineIds: string[];
}) {
  const accessibleSoftwareLines = await accessibleSoftwareLinesFor(user);
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
    accessibleSoftwareLines,
  };
}
