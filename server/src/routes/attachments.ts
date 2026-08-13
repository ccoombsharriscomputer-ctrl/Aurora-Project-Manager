import { Router } from "express";
import { prisma } from "../lib/prisma";
import { blockReadOnly, effectiveSoftwareLineId, requireAuth } from "../middleware/auth";
import { logActivity } from "../lib/activity";
import { emitUpdate } from "../lib/realtime";
import { storage } from "../lib/storage";
import { loadAttachmentInScope } from "../lib/scope";

const router = Router();
router.use(requireAuth);

router.get("/:id", async (req, res) => {
  const attachment = await loadAttachmentInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!attachment) {
    return res.status(404).json({ error: "Attachment not found" });
  }
  let stream;
  try {
    stream = await storage.getStream(attachment.storedFilename);
  } catch {
    return res.status(404).json({ error: "File not found" });
  }
  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${attachment.originalName.replace(/"/g, "")}"`);
  stream.pipe(res);
});

router.get("/:id/download", async (req, res) => {
  const attachment = await loadAttachmentInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!attachment) {
    return res.status(404).json({ error: "Attachment not found" });
  }
  let stream;
  try {
    stream = await storage.getStream(attachment.storedFilename);
  } catch {
    return res.status(404).json({ error: "File not found" });
  }
  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${attachment.originalName.replace(/"/g, "")}"`);
  stream.pipe(res);
});

router.delete("/:id", blockReadOnly, async (req, res) => {
  const attachment = await loadAttachmentInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!attachment) {
    return res.status(404).json({ error: "Attachment not found" });
  }

  await prisma.attachment.delete({ where: { id: attachment.id } });
  await storage.delete(attachment.storedFilename);

  const softwareLineId = attachment.project?.softwareLineId ?? attachment.task!.project.softwareLineId;
  const attachedTo = attachment.project ? `project "${attachment.project.name}"` : `"${attachment.task!.title}"`;
  await logActivity({
    type: "ATTACHMENT_DELETED",
    message: `${req.user!.name} removed attachment "${attachment.originalName}" from ${attachedTo}`,
    userId: req.user!.id,
    softwareLineId,
    projectId: attachment.projectId ?? attachment.task!.projectId,
    taskId: attachment.taskId ?? undefined,
  });

  if (attachment.projectId) emitUpdate({ scope: "project", projectId: attachment.projectId });
  if (attachment.taskId) emitUpdate({ scope: "task", taskId: attachment.taskId });
  emitUpdate({ scope: "dashboard" });

  res.status(204).send();
});

export default router;
