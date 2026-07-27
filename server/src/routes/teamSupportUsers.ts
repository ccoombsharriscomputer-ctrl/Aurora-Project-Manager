import { Router } from "express";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { fetchTeamSupportUsers, TeamSupportNotConfiguredError, TeamSupportUpstreamError } from "../lib/teamSupport";

const router = Router();
router.use(requireAuth, requireAdmin);

// Backs the Admin > Users picker that maps an Aurora account to its TeamSupport counterpart,
// so admins pick a name instead of hunting down a raw numeric UserID.
router.get("/", async (_req, res) => {
  try {
    const users = await fetchTeamSupportUsers();
    res.json(users);
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
