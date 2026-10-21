import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { fetchTeamSupportCustomers, TeamSupportNotConfiguredError, TeamSupportUpstreamError } from "../lib/teamSupport";

const router = Router();
router.use(requireAuth);

// Backs the searchable Customer picker on projects, so anyone who can edit a project can pick
// a TeamSupport customer by name instead of hunting down a raw numeric ID.
router.get("/", async (_req, res) => {
  try {
    const customers = await fetchTeamSupportCustomers();
    res.json(customers);
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
