import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { PS_ACTION_TYPES } from "../lib/teamSupport";

const router = Router();
router.use(requireAuth);

// A static, hand-maintained list (see teamSupport.ts) rather than a live TeamSupport call —
// there's no configuration that would make this fail, so no error handling needed here.
router.get("/", (_req, res) => {
  res.json(PS_ACTION_TYPES);
});

export default router;
