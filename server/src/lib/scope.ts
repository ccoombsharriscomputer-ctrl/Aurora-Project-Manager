import { prisma } from "./prisma";

// Resolve a Project by id, returning null (→ 404) if it doesn't exist OR belongs to a
// different software line — never distinguishing the two, so another line's projects
// don't even confirm existence.
export async function loadProjectInScope(projectId: string, lineId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.softwareLineId !== lineId) return null;
  return project;
}

export async function loadSubProjectInScope(subProjectId: string, lineId: string) {
  const subProject = await prisma.subProject.findUnique({
    where: { id: subProjectId },
    include: { project: true },
  });
  if (!subProject || subProject.project.softwareLineId !== lineId) return null;
  return subProject;
}

export async function loadTaskInScope(taskId: string, lineId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { include: { softwareLine: true } },
      subProject: { include: { checklistItem: true } },
    },
  });
  if (!task || task.project.softwareLineId !== lineId) return null;
  return task;
}

// Whether a user can be assigned a task, added as a project member, etc. in the given
// software line: admins always can; everyone else needs it to be their home line or one
// they've been explicitly granted. Used everywhere a target user's line was previously
// checked against just their home softwareLineId, so a granted Project Lead/Member isn't
// wrongly treated as belonging to "a different software line" once they have access to it.
export function userHasLineAccess(
  user: { role: string; softwareLineId: string; softwareLineGrants: { softwareLineId: string }[] },
  lineId: string
): boolean {
  return user.role === "ADMIN" || user.softwareLineId === lineId || user.softwareLineGrants.some((g) => g.softwareLineId === lineId);
}

export async function loadAttachmentInScope(attachmentId: string, lineId: string) {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: { project: true, task: { include: { project: true } } },
  });
  if (!attachment) return null;
  const attachmentLineId = attachment.project?.softwareLineId ?? attachment.task?.project.softwareLineId;
  if (attachmentLineId !== lineId) return null;
  return attachment;
}
