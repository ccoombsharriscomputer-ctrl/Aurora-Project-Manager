import { Router } from "express";
import path from "path";
import { effectiveSoftwareLineId, requireAuth } from "../middleware/auth";
import { UPLOAD_DIR } from "../lib/upload";
import { loadAttachmentInScope } from "../lib/scope";

const router = Router();
router.use(requireAuth);

router.get("/:id/download", async (req, res) => {
  const attachment = await loadAttachmentInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!attachment) {
    return res.status(404).json({ error: "Attachment not found" });
  }
  res.download(path.join(UPLOAD_DIR, attachment.storedFilename), attachment.originalName);
});

export default router;
