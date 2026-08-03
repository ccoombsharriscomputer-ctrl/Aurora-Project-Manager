import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { blockReadOnly, effectiveSoftwareLineId, requireAuth } from "../middleware/auth";
import { logActivity } from "../lib/activity";
import { emitUpdate } from "../lib/realtime";
import { upload } from "../lib/upload";
import { loadProjectInScope, userHasLineAccess } from "../lib/scope";
import { extractProjectDetailsFromContract, extractTextFromPdf } from "../lib/contractExtraction";
import {
  fetchTicketByNumber,
  TeamSupportNotConfiguredError,
  TeamSupportTicketNotFoundError,
  TeamSupportUpstreamError,
} from "../lib/teamSupport";

const router = Router();

router.use(requireAuth);

// All authenticated users can see every project in their (effective) software line.
// Archived projects are hidden by default; ?includeArchived=true adds them back in.
router.get("/", async (req, res) => {
  const includeArchived = req.query.includeArchived === "true";
  const projects = await prisma.project.findMany({
    where: {
      softwareLineId: effectiveSoftwareLineId(req.user!),
      ...(includeArchived ? {} : { archivedAt: null }),
    },
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
        archivedAt: p.archivedAt,
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
  checklistItemIds: z.array(z.string().min(1)).optional(),
  memberIds: z.array(z.string().min(1)).optional(),
});

router.post("/", blockReadOnly, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const lineId = effectiveSoftwareLineId(req.user!);

  const projectType = await prisma.projectType.findUnique({ where: { id: parsed.data.projectTypeId } });
  if (!projectType || projectType.softwareLineId !== lineId) {
    return res.status(404).json({ error: "Project type not found" });
  }

  const requestedIds = parsed.data.checklistItemIds ?? [];
  const checklistItems =
    requestedIds.length > 0
      ? await prisma.checklistItem.findMany({ where: { id: { in: requestedIds }, softwareLineId: lineId } })
      : [];
  if (checklistItems.length !== requestedIds.length) {
    return res.status(404).json({ error: "One or more selected products were not found" });
  }

  const requestedMemberIds = [...new Set(parsed.data.memberIds ?? [])].filter((id) => id !== req.user!.id);
  const memberUsers =
    requestedMemberIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: requestedMemberIds } }, include: { softwareLineGrants: true } })
      : [];
  if (memberUsers.length !== requestedMemberIds.length) {
    return res.status(404).json({ error: "One or more selected users were not found" });
  }
  // Same rule as adding a member after creation: someone with no access to this line at all
  // (not their home line, not a granted one, and not an admin) would be orphaned by
  // membership on a project they can never switch into.
  const wrongLineUser = memberUsers.find((u) => !userHasLineAccess(u, lineId));
  if (wrongLineUser) {
    return res
      .status(400)
      .json({ error: `${wrongLineUser.name} belongs to a different software line and can't be added to this project` });
  }

  const project = await prisma.project.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      teamSupportTicketNumber: parsed.data.teamSupportTicketNumber,
      projectTypeId: projectType.id,
      softwareLineId: lineId,
      createdById: req.user!.id,
      members: {
        create: [
          { userId: req.user!.id, role: "OWNER" },
          ...memberUsers.map((u) => ({ userId: u.id, role: "MEMBER" as const })),
        ],
      },
    },
    include: {
      projectType: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
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
    softwareLineId: lineId,
    projectId: project.id,
  });
  emitUpdate({ scope: "dashboard" });
  emitUpdate({ scope: "projects" });

  res.status(201).json(project);
});

// PDFs are parsed in memory only — never written to disk and never attached to any
// project. This just prefills the new-project form; nothing is created until the user
// reviews the suggestions and submits normally.
const parseContractUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.post("/parse-contract", blockReadOnly, parseContractUpload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  if (req.file.mimetype !== "application/pdf") {
    return res.status(400).json({ error: "Please upload a PDF file" });
  }

  let contractText: string;
  try {
    contractText = await extractTextFromPdf(req.file.buffer);
  } catch {
    return res.status(400).json({ error: "Could not read this PDF — it may be corrupted." });
  }
  if (contractText.length < 50) {
    return res
      .status(400)
      .json({ error: "This PDF doesn't seem to contain readable text — it may be a scanned image without text." });
  }

  const lineId = effectiveSoftwareLineId(req.user!);
  const [projectTypes, products] = await Promise.all([
    prisma.projectType.findMany({ where: { softwareLineId: lineId, active: true } }),
    prisma.checklistItem.findMany({ where: { softwareLineId: lineId, active: true } }),
  ]);

  try {
    const extracted = await extractProjectDetailsFromContract(contractText, projectTypes, products);
    res.json(extracted);
  } catch (err) {
    if (err instanceof Error && err.message === "ANTHROPIC_API_KEY is not configured") {
      return res
        .status(503)
        .json({ error: "Contract extraction isn't set up yet — ask an admin to configure ANTHROPIC_API_KEY." });
    }
    res.status(502).json({ error: "Couldn't extract details from this contract. Try again, or fill in the form manually." });
  }
});

router.get("/:id", async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      createdBy: { select: { id: true, name: true } },
      projectType: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
  if (!project || project.softwareLineId !== lineId) {
    return res.status(404).json({ error: "Project not found" });
  }
  res.json({
    ...project,
    members: project.members.map((m) => ({ ...m.user, role: m.role })),
  });
});

router.get("/:id/teamsupport-ticket", async (req, res) => {
  const project = await loadProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  if (!project.teamSupportTicketNumber) {
    return res.json({ linked: false });
  }

  try {
    const ticket = await fetchTicketByNumber(project.teamSupportTicketNumber);
    res.json({ linked: true, ticket });
  } catch (err) {
    if (err instanceof TeamSupportNotConfiguredError) {
      return res
        .status(503)
        .json({ error: "TeamSupport isn't set up yet — ask an admin to configure TEAMSUPPORT_ORG_ID and TEAMSUPPORT_API_TOKEN." });
    }
    if (err instanceof TeamSupportTicketNotFoundError) {
      return res.status(404).json({ error: `Ticket ${project.teamSupportTicketNumber} wasn't found in TeamSupport.` });
    }
    if (err instanceof TeamSupportUpstreamError) {
      const hint =
        err.status === 401 || err.status === 403
          ? " Double-check TEAMSUPPORT_ORG_ID and TEAMSUPPORT_API_TOKEN are correct, and that TEAMSUPPORT_API_BASE_URL matches your account's server (NA1/NA2/NA3/NA4 — check the URL when logged into TeamSupport)."
          : "";
      return res.status(502).json({ error: `Couldn't reach TeamSupport (${err.message}).${hint}` });
    }
    res.status(502).json({ error: "Couldn't reach TeamSupport. Try again shortly." });
  }
});

function canManageProject(projectCreatedById: string, req: import("express").Request) {
  return req.user!.role === "ADMIN" || req.user!.id === projectCreatedById;
}

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  teamSupportTicketNumber: z.string().max(50).nullable().optional(),
  archived: z.boolean().optional(),
});

router.patch("/:id", blockReadOnly, async (req, res) => {
  const project = await loadProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
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

  const { archived, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if (archived !== undefined) {
    data.archivedAt = archived ? new Date() : null;
  }

  const updated = await prisma.project.update({ where: { id: req.params.id }, data });
  emitUpdate({ scope: "project", projectId: updated.id });
  emitUpdate({ scope: "projects" });
  emitUpdate({ scope: "dashboard" });
  res.json(updated);
});

router.delete("/:id", blockReadOnly, async (req, res) => {
  const project = await loadProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  if (!canManageProject(project.createdById, req)) {
    return res.status(403).json({ error: "Only the project creator or an admin can delete this project" });
  }
  await prisma.project.delete({ where: { id: req.params.id } });
  // Logged after the delete (rather than before) so a failed delete can never leave behind
  // a "deleted" entry for a project that's still there — projectId is omitted since the
  // project is already gone by this point; softwareLineId keeps the entry scoped to the line.
  await logActivity({
    type: "PROJECT_DELETED",
    message: `${req.user!.name} deleted project "${project.name}"`,
    userId: req.user!.id,
    softwareLineId: project.softwareLineId,
  });
  emitUpdate({ scope: "dashboard" });
  emitUpdate({ scope: "projects" });
  emitUpdate({ scope: "project", projectId: req.params.id });
  res.status(204).send();
});

const duplicateSchema = z.object({
  name: z.string().min(1).max(200),
});

// Full-snapshot copy: same project type, description, TeamSupport ticket #, members,
// sub-projects, and every task exactly as it stands right now (status, assignee, priority,
// due date). Comments, attachments, and time entries are deliberately left behind — those
// belong to the original engagement's history, not a fresh copy of it.
router.post("/:id/duplicate", blockReadOnly, async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const parsed = duplicateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const source = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: { members: true, subProjects: true, tasks: true },
  });
  if (!source || source.softwareLineId !== lineId) {
    return res.status(404).json({ error: "Project not found" });
  }

  // Carry over every member's role from the source, but the person doing the copy always
  // becomes (or stays) OWNER of the new project, since they're the one who just created it.
  const memberRoles = new Map<string, "OWNER" | "MEMBER">();
  for (const m of source.members) memberRoles.set(m.userId, m.role);
  memberRoles.set(req.user!.id, "OWNER");

  const project = await prisma.project.create({
    data: {
      name: parsed.data.name,
      description: source.description,
      teamSupportTicketNumber: source.teamSupportTicketNumber,
      projectTypeId: source.projectTypeId,
      softwareLineId: source.softwareLineId,
      createdById: req.user!.id,
      members: {
        create: [...memberRoles.entries()].map(([userId, role]) => ({ userId, role })),
      },
    },
    include: {
      projectType: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });

  const subProjectIdMap = new Map<string, string>();
  for (const sp of source.subProjects) {
    const newSubProject = await prisma.subProject.create({
      data: { projectId: project.id, checklistItemId: sp.checklistItemId, name: sp.name, createdById: req.user!.id },
    });
    subProjectIdMap.set(sp.id, newSubProject.id);
  }

  if (source.tasks.length > 0) {
    await prisma.task.createMany({
      data: source.tasks.map((task) => ({
        projectId: project.id,
        subProjectId: subProjectIdMap.get(task.subProjectId)!,
        projectTypeId: project.projectTypeId,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assigneeId: task.assigneeId,
        dueDate: task.dueDate,
        completedAt: task.completedAt,
        naReason: task.naReason,
        createdById: req.user!.id,
      })),
    });
  }

  await logActivity({
    type: "PROJECT_CREATED",
    message: `${req.user!.name} copied project "${source.name}" to create "${project.name}"`,
    userId: req.user!.id,
    softwareLineId: lineId,
    projectId: project.id,
  });
  emitUpdate({ scope: "dashboard" });
  emitUpdate({ scope: "projects" });

  res.status(201).json(project);
});

const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["OWNER", "MEMBER"]).optional(),
});

router.post("/:id/members", blockReadOnly, async (req, res) => {
  const project = await loadProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const user = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    include: { softwareLineGrants: true },
  });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  // Adding someone with no access to this line at all would orphan their own membership
  // (they could never load a project they can't switch into). Admins are always exempt;
  // Project Leads/Members are fine too as long as it's their home line or a granted one.
  if (!userHasLineAccess(user, project.softwareLineId)) {
    return res.status(400).json({ error: `${user.name} belongs to a different software line and can't be added to this project` });
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

router.delete("/:id/members/:userId", blockReadOnly, async (req, res) => {
  const project = await loadProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  await prisma.projectMember
    .delete({ where: { projectId_userId: { projectId: req.params.id, userId: req.params.userId } } })
    .catch(() => null);
  emitUpdate({ scope: "project", projectId: req.params.id });
  res.status(204).send();
});

router.get("/:id/sub-projects", async (req, res) => {
  const project = await loadProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

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

router.post("/:id/sub-projects", blockReadOnly, async (req, res) => {
  const lineId = effectiveSoftwareLineId(req.user!);
  const project = await loadProjectInScope(req.params.id, lineId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  const parsed = createSubProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const checklistItem = await prisma.checklistItem.findUnique({ where: { id: parsed.data.checklistItemId } });
  if (!checklistItem || checklistItem.softwareLineId !== lineId) {
    return res.status(404).json({ error: "Product not found" });
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

  const templates = await prisma.taskTemplate.findMany({
    where: { checklistItemId: checklistItem.id, active: true },
  });
  if (templates.length > 0) {
    await prisma.task.createMany({
      data: templates.map((template) => ({
        projectId: project.id,
        subProjectId: subProject.id,
        projectTypeId: project.projectTypeId,
        title: template.title,
        description: template.description,
        priority: template.priority,
        createdById: req.user!.id,
      })),
    });
  }

  emitUpdate({ scope: "project", projectId: project.id });
  res.status(201).json(subProject);
});

router.get("/:id/attachments", async (req, res) => {
  const project = await loadProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const attachments = await prisma.attachment.findMany({
    where: { projectId: req.params.id },
    orderBy: { createdAt: "asc" },
    include: { uploader: { select: { id: true, name: true } } },
  });
  res.json(attachments);
});

router.post("/:id/attachments", blockReadOnly, upload.single("file"), async (req, res) => {
  const project = await loadProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
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
    softwareLineId: project.softwareLineId,
    projectId: project.id,
  });
  emitUpdate({ scope: "project", projectId: project.id });
  emitUpdate({ scope: "dashboard" });

  res.status(201).json(attachment);
});

export default router;
