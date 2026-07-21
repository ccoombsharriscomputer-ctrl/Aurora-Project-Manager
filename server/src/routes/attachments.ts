import { Router } from "express";
import path from "path";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { UPLOAD_DIR } from "../lib/upload";

const router = Router();
router.use(requireAuth);

router.get("/:id/download", async (req, res) => {
  const attachment = await prisma.attachment.findUnique({ where: { id: req.params.id } });
  if (!attachment) {
    return res.status(404).json({ error: "Attachment not found" });
  }
  res.download(path.join(UPLOAD_DIR, attachment.storedFilename), attachment.originalName);
});

export default router;
