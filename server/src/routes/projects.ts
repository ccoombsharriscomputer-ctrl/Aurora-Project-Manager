import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { logActivity } from "../lib/activity";
import { emitUpdate } from "../lib/realtime";
import { upload } from "../lib/upload";

const router = Router();

router.use(requireAuth);

// All authenticated users can see all projects (shared team visibility).
router.get("/", async (_req, res) => {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, name: true } },
      projectType: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
      _count: { select: { tasks: true } },
    },
  });

  const withProgress = await Promise.all(
    projects.map(async (p) => {
      const doneCount = await prisma.task.count({ where: { projectId: p.id, status: "DONE" } });
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        teamSupportTicketNumber: p.teamSupportTicketNumber,
        projectType: p.projectType,
        createdBy: p.createdBy,
        createdAt: p.createdAt,
        members: p.members.map((m) => ({ ...m.user, role: m.role })),
        totalTasks: p._count.tasks,
        doneTasks: doneCount,
      };
    })
  );

  res.json(withProgress);
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  teamSupportTicketNumber: z.string().max(50).optional(),
  projectTypeId: z.string().min(1),
});

router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const projectType = await prisma.projectType.findUnique({ where: { id: parsed.data.projectTypeId } });
  if (!projectType) {
    return res.status(404).json({ error: "Project type not found" });
  }

  const project = await prisma.project.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      teamSupportTicketNumber: parsed.data.teamSupportTicketNumber,
      projectTypeId: projectType.id,
      createdById: req.user!.id,
      members: {
        create: { userId: req.user!.id, role: "OWNER" },
      },
    },
    include: {
      projectType: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });

  const checklistItems = await prisma.checklistItem.findMany({
    where: { projectTypeId: projectType.id, active: true },
  });

  if (checklistItems.length > 0) {
    const taskTemplates = await prisma.taskTemplate.findMany({
      where: { checklistItemId: { in: checklistItems.map((item) => item.id) }, active: true },
    });
    const templatesByChecklistItem = new Map<string, typeof taskTemplates>();
    for (const template of taskTemplates) {
      const list = templatesByChecklistItem.get(template.checklistItemId) ?? [];
      list.push(template);
      templatesByChecklistItem.set(template.checklistItemId, list);
    }

    for (const item of checklistItems) {
      const subProject = await prisma.subProject.create({
        data: { projectId: project.id, checklistItemId: item.id, createdById: req.user!.id },
      });

      const templates = templatesByChecklistItem.get(item.id) ?? [];
      if (templates.length > 0) {
        await prisma.task.createMany({
          data: templates.map((template) => ({
            projectId: project.id,
            subProjectId: subProject.id,
            projectTypeId: projectType.id,
            title: template.title,
            description: template.description,
            priority: template.priority,
            createdById: req.user!.id,
          })),
        });
      }
    }
  }

  await logActivity({
    type: "PROJECT_CREATED",
    message: `${req.user!.name} created project "${project.name}"`,
    userId: req.user!.id,
    projectId: project.id,
  });
  emitUpdate({ scope: "dashboard" });
  emitUpdate({ scope: "projects" });

  res.status(201).json(project);
});

router.get("/:id", async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      createdBy: { select: { id: true, name: true } },
      projectType: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  res.json({
    ...project,
    members: project.members.map((m) => ({ ...m.user, role: m.role })),
  });
});

function canManageProject(projectCreatedById: string, req: import("express").Request) {
  return req.user!.role === "ADMIN" || req.user!.id === projectCreatedById;
}

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  teamSupportTicketNumber: z.string().max(50).nullable().optional(),
});

router.patch("/:id", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  if (!canManageProject(project.createdById, req)) {
    return res.status(403).json({ error: "Only the project creator or an admin can edit this project" });
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const updated = await prisma.project.update({ where: { id: req.params.id }, data: parsed.data });
  emitUpdate({ scope: "project", projectId: updated.id });
  emitUpdate({ scope: "projects" });
  res.json(updated);
});

router.delete("/:id", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  if (!canManageProject(project.createdById, req)) {
    return res.status(403).json({ error: "Only the project creator or an admin can delete this project" });
  }
  await prisma.project.delete({ where: { id: req.params.id } });
  emitUpdate({ scope: "dashboard" });
  emitUpdate({ scope: "projects" });
  emitUpdate({ scope: "project", projectId: req.params.id });
  res.status(204).send();
});

const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["OWNER", "MEMBER"]).optional(),
});

router.post("/:id/members", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const member = await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: req.params.id, userId: parsed.data.userId } },
    update: { role: parsed.data.role ?? "MEMBER" },
    create: { projectId: req.params.id, userId: parsed.data.userId, role: parsed.data.role ?? "MEMBER" },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  emitUpdate({ scope: "project", projectId: req.params.id });
  res.status(201).json(member);
});

router.delete("/:id/members/:userId", async (req, res) => {
  await prisma.projectMember
    .delete({ where: { projectId_userId: { projectId: req.params.id, userId: req.params.userId } } })
    .catch(() => null);
  emitUpdate({ scope: "project", projectId: req.params.id });
  res.status(204).send();
});

router.get("/:id/sub-projects", async (req, res) => {
  const subProjects = await prisma.subProject.findMany({
    where: { projectId: req.params.id },
    orderBy: { createdAt: "asc" },
    include: {
      checklistItem: true,
      createdBy: { select: { id: true, name: true } },
      _count: { select: { tasks: true } },
    },
  });

  const withProgress = await Promise.all(
    subProjects.map(async (sp) => {
      const doneCount = await prisma.task.count({ where: { subProjectId: sp.id, status: "DONE" } });
      return {
        id: sp.id,
        projectId: sp.projectId,
        name: sp.name,
        checklistItem: sp.checklistItem,
        createdBy: sp.createdBy,
        createdAt: sp.createdAt,
        totalTasks: sp._count.tasks,
        doneTasks: doneCount,
      };
    })
  );

  res.json(withProgress);
});

const createSubProjectSchema = z.object({
  checklistItemId: z.string().min(1),
  name: z.string().max(200).optional(),
});

router.post("/:id/sub-projects", async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  const parsed = createSubProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const checklistItem = await prisma.checklistItem.findUnique({ where: { id: parsed.data.checklistItemId } });
  if (!checklistItem) {
    return res.status(404).json({ error: "Checklist item not found" });
  }
  if (checklistItem.projectTypeId !== project.projectTypeId) {
    return res.status(400).json({ error: "That checklist item doesn't belong to this project's type" });
  }

  const subProject = await prisma.subProject.create({
    data: {
      projectId: project.id,
      checklistItemId: checklistItem.id,
      name: parsed.data.name,
      createdById: req.user!.id,
    },
    include: { checklistItem: true, createdBy: { select: { id: true, name: true } } },
  });

  emitUpdate({ scope: "project", projectId: project.id });
  res.status(201).json(subProject);
});

router.get("/:id/attachments", async (req, res) => {
  const attachments = await prisma.attachment.findMany({
    where: { projectId: req.params.id },
    orderBy: { createdAt: "asc" },
    include: { uploader: { select: { id: true, name: true } } },
  });
  res.json(attachments);
});

router.post("/:id/attachments", upload.single("file"), async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const attachment = await prisma.attachment.create({
    data: {
      projectId: project.id,
      uploaderId: req.user!.id,
      storedFilename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    },
    include: { uploader: { select: { id: true, name: true } } },
  });

  await logActivity({
    type: "ATTACHMENT_ADDED",
    message: `${req.user!.name} attached "${attachment.originalName}" to project "${project.name}"`,
    userId: req.user!.id,
    projectId: project.id,
  });
  emitUpdate({ scope: "project", projectId: project.id });
  emitUpdate({ scope: "dashboard" });

  res.status(201).json(attachment);
});

export default router;
