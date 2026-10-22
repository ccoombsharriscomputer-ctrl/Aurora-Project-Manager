import { Router } from "express";
import { prisma } from "../lib/prisma";
import { effectiveSoftwareLineId, requireAuth } from "../middleware/auth";
import {
  defaultTicketGroup,
  fetchTeamSupportProducts,
  TeamSupportNotConfiguredError,
  TeamSupportUpstreamError,
  TICKET_NATURES,
} from "../lib/teamSupport";

const router = Router();
router.use(requireAuth);

// Backs the Product and Nature choices when creating a TeamSupport ticket. Products are
// TeamSupport's whole product list (every software line's), with the ones belonging to the
// user's current software line marked `preferred` so the picker can list those first — a
// product belongs to a line when its name starts with the line's name ("TRIO General Entry").
router.get("/", async (req, res) => {
  try {
    const [products, line] = await Promise.all([
      fetchTeamSupportProducts(),
      prisma.softwareLine.findUnique({ where: { id: effectiveSoftwareLineId(req.user!) }, select: { name: true } }),
    ]);
    const prefix = line?.name.trim().toLowerCase();
    res.json({
      // Shown read-only in the panel so people can see where the ticket will go.
      defaultGroupName: defaultTicketGroup(line?.name ?? "")?.name ?? null,
      natures: TICKET_NATURES,
      products: products.map((p) => ({ ...p, preferred: !!prefix && p.name.toLowerCase().startsWith(prefix) })),
    });
  } catch (err) {
    if (err instanceof TeamSupportNotConfiguredError) {
      return res.status(503).json({ error: "TeamSupport isn't set up yet — ask an admin to configure TEAMSUPPORT_ORG_ID and TEAMSUPPORT_API_TOKEN." });
    }
    if (err instanceof TeamSupportUpstreamError) {
      return res.status(502).json({ error: `Couldn't reach TeamSupport (${err.message}).` });
    }
    res.status(502).json({ error: "Couldn't reach TeamSupport. Try again shortly." });
  }
});

export default router;
