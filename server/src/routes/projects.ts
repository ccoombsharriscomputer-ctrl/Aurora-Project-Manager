import { Router, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { blockReadOnly, effectiveSoftwareLineId, requireAuth } from "../middleware/auth";
import { logActivity } from "../lib/activity";
import { emitUpdate } from "../lib/realtime";
import { upload } from "../lib/upload";
import { storage } from "../lib/storage";
import { loadProjectInScope, userHasLineAccess } from "../lib/scope";
import { contractLineSchema } from "./contractLines";
import { defaultLineHours } from "../lib/contractCategories";
import { countPdfPages, extractProjectDetailsFromContract, MAX_CONTRACT_PAGES } from "../lib/contractExtraction";
import {
  createTicket,
  fetchTeamSupportGroups,
  fetchTeamSupportTicketTypes,
  ticketRoutingForLine,
  TicketRoutingChoiceError,
  fetchTicketByNumber,
  TeamSupportNotConfiguredError,
  TeamSupportTicketNotFoundError,
  TeamSupportUpstreamError,
  TICKET_NATURES,
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
      assignee: { select: { id: true, name: true } },
      projectType: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });

  const withProgress = await Promise.all(
    projects.map(async (p) => {
      // N/A tasks are left out of the total so the remaining tasks share 100% between them.
      const [totalCount, doneCount] = await Promise.all([
        prisma.task.count({ where: { projectId: p.id, status: { not: "NA" } } }),
        prisma.task.count({ where: { projectId: p.id, status: "DONE" } }),
      ]);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        teamSupportTicketNumber: p.teamSupportTicketNumber,
        teamSupportCustomerId: p.teamSupportCustomerId,
        teamSupportCustomerName: p.teamSupportCustomerName,
        projectType: p.projectType,
        createdBy: p.createdBy,
        assignee: p.assignee,
        createdAt: p.createdAt,
        archivedAt: p.archivedAt,
        members: p.members.map((m) => ({ ...m.user, role: m.role })),
        totalTasks: totalCount,
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
  teamSupportCustomerId: z.string().max(50).optional(),
  teamSupportCustomerName: z.string().max(200).optional(),
  projectTypeId: z.string().min(1),
  checklistItemIds: z.array(z.string().min(1)).optional(),
  memberIds: z.array(z.string().min(1)).optional(),
  assigneeId: z.string().min(1).optional(),
  // Billable services lines from the contract (filled in by "Create from a contract", reviewed by the user).
  contractLines: z.array(contractLineSchema).max(100).optional(),
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

  let assignee: (typeof memberUsers)[number] | null = null;
  if (parsed.data.assigneeId) {
    assignee =
      memberUsers.find((u) => u.id === parsed.data.assigneeId) ??
      (parsed.data.assigneeId === req.user!.id
        ? null
        : await prisma.user.findUnique({ where: { id: parsed.data.assigneeId }, include: { softwareLineGrants: true } }));
    if (parsed.data.assigneeId !== req.user!.id && (!assignee || !userHasLineAccess(assignee, lineId))) {
      return res.status(400).json({ error: "Assignee belongs to a different software line" });
    }
  }

  // The assignee is always a project member (added below if they weren't already selected as
  // one) — never downgrades the creator's OWNER role even if the creator assigns the project
  // to themselves.
  const memberRoles = new Map<string, "OWNER" | "MEMBER">();
  memberRoles.set(req.user!.id, "OWNER");
  for (const u of memberUsers) memberRoles.set(u.id, "MEMBER");
  if (parsed.data.assigneeId && !memberRoles.has(parsed.data.assigneeId)) {
    memberRoles.set(parsed.data.assigneeId, "MEMBER");
  }

  const project = await prisma.project.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      teamSupportTicketNumber: parsed.data.teamSupportTicketNumber,
      ...(parsed.data.teamSupportCustomerId && parsed.data.teamSupportCustomerName
        ? { teamSupportCustomerId: parsed.data.teamSupportCustomerId, teamSupportCustomerName: parsed.data.teamSupportCustomerName }
        : {}),
      projectTypeId: projectType.id,
      softwareLineId: lineId,
      createdById: req.user!.id,
      assigneeId: parsed.data.assigneeId,
      members: {
        create: [...memberRoles.entries()].map(([userId, role]) => ({ userId, role })),
      },
    },
    include: {
      assignee: { select: { id: true, name: true } },
      projectType: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });

  const requestedLines = parsed.data.contractLines ?? [];
  if (requestedLines.length > 0) {
    const lineProductIds = [...new Set(requestedLines.map((l) => l.checklistItemId).filter((id): id is string => !!id))];
    const validProducts = lineProductIds.length
      ? await prisma.checklistItem.findMany({ where: { id: { in: lineProductIds }, softwareLineId: lineId }, select: { id: true } })
      : [];
    const validProductIds = new Set(validProducts.map((p) => p.id));
    await prisma.contractLine.createMany({
      data: requestedLines.map((l) => ({
        projectId: project.id,
        category: l.category,
        description: l.description,
        // A product that isn't in this line's catalog is dropped rather than failing the whole create.
        checklistItemId: l.checklistItemId && validProductIds.has(l.checklistItemId) ? l.checklistItemId : null,
        hours: defaultLineHours(l.category, l.hours, l.amount),
        amount: l.amount ?? null,
      })),
    });
  }

  if (checklistItems.length > 0) {
    const taskTemplates = await prisma.taskTemplate.findMany({
      where: { checklistItemId: { in: checklistItems.map((item) => item.id) }, active: true },
      orderBy: { order: "asc" },
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
          data: templates.map((template, index) => ({
            projectId: project.id,
            subProjectId: subProject.id,
            projectTypeId: projectType.id,
            title: template.title,
            description: template.description,
            priority: template.priority,
            order: index * 10,
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

  let pageCount: number;
  try {
    pageCount = await countPdfPages(req.file.buffer);
  } catch {
    return res.status(400).json({ error: "Could not read this PDF — it may be corrupted." });
  }
  if (pageCount > MAX_CONTRACT_PAGES) {
    return res.status(400).json({ error: "This PDF has " + pageCount + " pages — the limit is " + MAX_CONTRACT_PAGES + "." });
  }

  const lineId = effectiveSoftwareLineId(req.user!);
  const [projectTypes, products] = await Promise.all([
    prisma.projectType.findMany({ where: { softwareLineId: lineId, active: true } }),
    prisma.checklistItem.findMany({ where: { softwareLineId: lineId, active: true } }),
  ]);

  try {
    const extracted = await extractProjectDetailsFromContract(req.file.buffer, projectTypes, products);
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
      assignee: { select: { id: true, name: true } },
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
    respondTeamSupportError(res, err, project.teamSupportTicketNumber);
  }
});

function respondTeamSupportError(res: Response, err: unknown, ticketNumber?: string) {
  if (err instanceof TicketRoutingChoiceError) {
    return res.status(400).json({ error: err.message });
  }
  if (err instanceof TeamSupportNotConfiguredError) {
    return res
      .status(503)
      .json({ error: "TeamSupport isn't set up yet — ask an admin to configure TEAMSUPPORT_ORG_ID and TEAMSUPPORT_API_TOKEN." });
  }
  if (err instanceof TeamSupportTicketNotFoundError) {
    return res.status(404).json({ error: `${ticketNumber ? `Ticket ${ticketNumber}` : "The ticket"} wasn't found in TeamSupport.` });
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

// Shared by both ways of creating a ticket (an existing project, or the new-project form
// before the project itself exists): builds the description, picks the TeamSupport assignee,
// and calls TeamSupport.
async function createTicketForUser(
  user: { id: string; name: string },
  ticket: {
    lineId: string;
    name: string;
    description?: string | null;
    assigneeId?: string | null;
    customerId?: string | null;
    productId?: string | null;
    nature?: string | null;
    groupId?: string | null;
    ticketTypeId?: string | null;
  }
) {
  const [softwareLine, assignee, creator] = await Promise.all([
    prisma.softwareLine.findUnique({ where: { id: ticket.lineId }, select: { name: true } }),
    ticket.assigneeId ? prisma.user.findUnique({ where: { id: ticket.assigneeId }, select: { teamSupportUserId: true } }) : null,
    prisma.user.findUnique({ where: { id: user.id }, select: { teamSupportUserId: true } }),
  ]);

  const description = [ticket.description, `Created from the ${softwareLine?.name ?? "Aurora"} Project Manager by ${user.name}.`]
    .filter(Boolean)
    .join("\n\n");

  // TRIO, Spectrum and MSI tickets always go to their own PS group as PS Projects; every other line
  // has to say which Group and Ticket type (checked against TeamSupport's own lists).
  const routing = ticketRoutingForLine(softwareLine?.name ?? "");
  let groupId = routing?.group.id;
  let ticketTypeId = routing?.type.id;
  if (!routing) {
    const [groups, types] = await Promise.all([fetchTeamSupportGroups(), fetchTeamSupportTicketTypes()]);
    if (!ticket.groupId || !groups.some((g) => g.id === ticket.groupId) || !ticket.ticketTypeId || !types.some((t) => t.id === ticket.ticketTypeId)) {
      throw new TicketRoutingChoiceError("Choose a group and a ticket type for this ticket.");
    }
    groupId = ticket.groupId;
    ticketTypeId = ticket.ticketTypeId;
  }

  return createTicket(ticket.name, description, {
    assigneeUserId: assignee?.teamSupportUserId ?? creator?.teamSupportUserId,
    customerId: ticket.customerId,
    groupId,
    ticketTypeId,
    productId: ticket.productId,
    nature: ticket.nature,
  });
}

const createTicketSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  assigneeId: z.string().min(1).optional(),
  customerId: z.string().min(1).max(50).optional(),
  productId: z.string().min(1).max(50).optional(),
  nature: z.enum(TICKET_NATURES).optional(),
  groupId: z.string().min(1).max(50).optional(),
  ticketTypeId: z.string().min(1).max(50).optional(),
});

// Chosen in the create-ticket panel on the project page (the new-project form sends them in the
// body above instead, since it has no project yet).
const createTicketChoicesSchema = z.object({
  productId: z.string().min(1).max(50).optional(),
  nature: z.enum(TICKET_NATURES).optional(),
  groupId: z.string().min(1).max(50).optional(),
  ticketTypeId: z.string().min(1).max(50).optional(),
});

// For the new-project form: creates the ticket before the project exists, so the form can
// fill in its ticket # field. Nothing is saved on our side until the project is created.
router.post("/teamsupport-ticket", blockReadOnly, async (req, res) => {
  const parsed = createTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  try {
    // Not logged to the activity feed: it has no project to attach to yet, and the project's
    // own creation entry follows once the form is submitted.
    const result = await createTicketForUser(req.user!, { lineId: effectiveSoftwareLineId(req.user!), ...parsed.data });
    res.status(201).json(result);
  } catch (err) {
    respondTeamSupportError(res, err);
  }
});

// Creates a TeamSupport ticket for a project that doesn't have one yet and links it. The
// assignee on the ticket is the project's assignee if they've been mapped to a TeamSupport
// user (Admin > Users), else whoever clicked the button.
router.post("/:id/teamsupport-ticket", blockReadOnly, async (req, res) => {
  const project = await loadProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  if (project.teamSupportTicketNumber) {
    return res.status(409).json({ error: `This project is already linked to ticket ${project.teamSupportTicketNumber}.` });
  }

  const choices = createTicketChoicesSchema.safeParse(req.body ?? {});
  if (!choices.success) {
    return res.status(400).json({ error: choices.error.issues[0].message });
  }

  try {
    const { ticketNumber, descriptionSet, customerSet } = await createTicketForUser(req.user!, {
      lineId: project.softwareLineId,
      name: project.name,
      description: project.description,
      assigneeId: project.assigneeId,
      customerId: project.teamSupportCustomerId,
      ...choices.data,
    });
    await prisma.project.update({ where: { id: project.id }, data: { teamSupportTicketNumber: ticketNumber } });
    await logActivity({
      type: "PROJECT_UPDATED",
      message: `${req.user!.name} created TeamSupport ticket ${ticketNumber} for project "${project.name}"`,
      userId: req.user!.id,
      softwareLineId: project.softwareLineId,
      projectId: project.id,
    });
    res.status(201).json({ ticketNumber, descriptionSet, customerSet });
  } catch (err) {
    respondTeamSupportError(res, err);
  }
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  teamSupportTicketNumber: z.string().max(50).nullable().optional(),
  teamSupportCustomerId: z.string().max(50).nullable().optional(),
  teamSupportCustomerName: z.string().max(200).nullable().optional(),
  archived: z.boolean().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
});

// Any Project Lead or Member can edit or archive a project, not just its creator or an
// admin — blockReadOnly above is the only gate. Since that opens this up to anyone on the
// line, every edit and archive/unarchive is logged to the audit trail below so there's a
// record of who changed what, even though they were allowed to.
router.patch("/:id", blockReadOnly, async (req, res) => {
  const project = await loadProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  let newAssignee: { id: string; name: string } | null = null;
  if (parsed.data.assigneeId) {
    const user = await prisma.user.findUnique({
      where: { id: parsed.data.assigneeId },
      include: { softwareLineGrants: true },
    });
    if (!user || !userHasLineAccess(user, project.softwareLineId)) {
      return res.status(400).json({ error: "Assignee belongs to a different software line" });
    }
    newAssignee = user;
    // Assigning the project adds them as a Member if they aren't one already — never
    // downgrades an existing membership (e.g. leaves an OWNER as OWNER).
    const existingMembership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: parsed.data.assigneeId } },
    });
    if (!existingMembership) {
      await prisma.projectMember.create({ data: { projectId: project.id, userId: parsed.data.assigneeId, role: "MEMBER" } });
    }
  }

  const { archived, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if (archived !== undefined) {
    data.archivedAt = archived ? new Date() : null;
  }

  const updated = await prisma.project.update({
    where: { id: req.params.id },
    data,
    include: { assignee: { select: { id: true, name: true } } },
  });

  const changedFields: string[] = [];
  if (rest.name !== undefined && rest.name !== project.name) changedFields.push("name");
  if (rest.description !== undefined && rest.description !== project.description) changedFields.push("description");
  if (rest.teamSupportTicketNumber !== undefined && rest.teamSupportTicketNumber !== project.teamSupportTicketNumber) {
    changedFields.push("TeamSupport ticket #");
  }
  if (rest.teamSupportCustomerId !== undefined && rest.teamSupportCustomerId !== project.teamSupportCustomerId) {
    changedFields.push("customer");
  }
  if (changedFields.length > 0) {
    await logActivity({
      type: "PROJECT_UPDATED",
      message: `${req.user!.name} updated ${changedFields.join(", ")} on project "${updated.name}"`,
      userId: req.user!.id,
      softwareLineId: project.softwareLineId,
      projectId: project.id,
    });
  }
  // A distinct activity type from PROJECT_UPDATED, matching how TASK_ASSIGNED is its own
  // type rather than folded into a generic task-edited entry.
  if (rest.assigneeId !== undefined && rest.assigneeId !== project.assigneeId) {
    await logActivity({
      type: "PROJECT_ASSIGNED",
      message: newAssignee
        ? `${req.user!.name} assigned project "${updated.name}" to ${newAssignee.name}`
        : `${req.user!.name} removed the assignee from project "${updated.name}"`,
      userId: req.user!.id,
      softwareLineId: project.softwareLineId,
      projectId: project.id,
    });
  }
  if (archived !== undefined) {
    await logActivity({
      type: archived ? "PROJECT_ARCHIVED" : "PROJECT_UNARCHIVED",
      message: `${req.user!.name} ${archived ? "archived" : "unarchived"} project "${updated.name}"`,
      userId: req.user!.id,
      softwareLineId: project.softwareLineId,
      projectId: project.id,
    });
  }

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
  // Deletion is permanent and admin-only — Project Leads and Members (even the project's
  // own creator) can only archive a project via PATCH, never delete it outright.
  if (req.user!.role !== "ADMIN") {
    return res.status(403).json({ error: "Only an admin can delete this project" });
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

// Full-snapshot copy: same project type, description, members, sub-projects, and every
// task's title/assignee/priority/due date. Task status is deliberately NOT carried over —
// every copied task starts fresh at TODO (with completedAt/naReason cleared to match), since
// a copy represents a new engagement that hasn't done any of that work yet. Comments,
// attachments, and time entries are deliberately left behind — those belong to the original
// engagement's history, not a fresh copy of it. The TeamSupport ticket # is deliberately NOT
// copied either — it identifies one specific support ticket, and the copy is a distinct
// engagement that hasn't been tied to a ticket yet (or needs its own). The TeamSupport customer
// IS copied: a repeat engagement is usually for the same customer. Same reasoning for the
// project assignee: the copy starts unassigned rather than inheriting who was on the hook for
// the original engagement.
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

  // Every member carries over as a MEMBER regardless of their role on the source project —
  // the person doing the copy is always the new project's sole OWNER, since they're the one
  // who just created it. (Carrying the source's OWNER role over verbatim would leave two
  // owners on the copy whenever the copier isn't the original owner.)
  const memberRoles = new Map<string, "OWNER" | "MEMBER">();
  for (const m of source.members) memberRoles.set(m.userId, "MEMBER");
  memberRoles.set(req.user!.id, "OWNER");

  const project = await prisma.project.create({
    data: {
      name: parsed.data.name,
      description: source.description,
      teamSupportCustomerId: source.teamSupportCustomerId,
      teamSupportCustomerName: source.teamSupportCustomerName,
      projectTypeId: source.projectTypeId,
      softwareLineId: source.softwareLineId,
      createdById: req.user!.id,
      members: {
        create: [...memberRoles.entries()].map(([userId, role]) => ({ userId, role })),
      },
    },
    include: {
      assignee: { select: { id: true, name: true } },
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
        status: "TODO" as const,
        priority: task.priority,
        assigneeId: task.assigneeId,
        dueDate: task.dueDate,
        completedAt: null,
        naReason: null,
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
    },
  });

  const withProgress = await Promise.all(
    subProjects.map(async (sp) => {
      const [totalCount, doneCount] = await Promise.all([
        prisma.task.count({ where: { subProjectId: sp.id, status: { not: "NA" } } }),
        prisma.task.count({ where: { subProjectId: sp.id, status: "DONE" } }),
      ]);
      return {
        id: sp.id,
        projectId: sp.projectId,
        name: sp.name,
        checklistItem: sp.checklistItem,
        createdBy: sp.createdBy,
        createdAt: sp.createdAt,
        totalTasks: totalCount,
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
    orderBy: { order: "asc" },
  });
  if (templates.length > 0) {
    await prisma.task.createMany({
      data: templates.map((template, index) => ({
        projectId: project.id,
        subProjectId: subProject.id,
        projectTypeId: project.projectTypeId,
        title: template.title,
        description: template.description,
        priority: template.priority,
        order: index * 10,
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

  const storedFilename = await storage.save(req.file.buffer, req.file.originalname, req.file.mimetype);

  const attachment = await prisma.attachment.create({
    data: {
      projectId: project.id,
      uploaderId: req.user!.id,
      storedFilename,
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

// --- Follow-ups ---
// A project-level follow-up (not tied to any specific task) — the other way to schedule one
// is from a task's own comment form (routes/tasks.ts). Both land in the same FollowUp table
// and show up together on the Dashboard calendar.

router.get("/:id/follow-ups", async (req, res) => {
  const project = await loadProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  const followUps = await prisma.followUp.findMany({
    where: { projectId: project.id },
    orderBy: { dueDate: "asc" },
    include: { user: { select: { id: true, name: true } } },
  });
  res.json(followUps);
});

const createFollowUpSchema = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be in YYYY-MM-DD format"),
});

router.post("/:id/follow-ups", blockReadOnly, async (req, res) => {
  const project = await loadProjectInScope(req.params.id, effectiveSoftwareLineId(req.user!));
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
  const parsed = createFollowUpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const followUp = await prisma.followUp.create({
    data: {
      projectId: project.id,
      userId: req.user!.id,
      dueDate: new Date(parsed.data.dueDate),
    },
    include: { user: { select: { id: true, name: true } } },
  });

  await logActivity({
    type: "FOLLOW_UP_SCHEDULED",
    message: `${req.user!.name} scheduled a follow-up on project "${project.name}" for ${parsed.data.dueDate}`,
    userId: req.user!.id,
    softwareLineId: project.softwareLineId,
    projectId: project.id,
  });
  emitUpdate({ scope: "project", projectId: project.id });
  emitUpdate({ scope: "dashboard" });

  res.status(201).json(followUp);
});

export default router;
