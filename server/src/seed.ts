import { prisma } from "./lib/prisma";

async function main() {
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    console.log("No users yet — create the first admin directly in the database (e.g. via Prisma Studio or psql), then re-run the seed if you want demo data.");
    return;
  }

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) {
    console.log("No admin user found — skipping seed.");
    return;
  }

  const existing = await prisma.project.findFirst({ where: { name: "Aurora Launch" } });
  if (existing) {
    console.log("Demo project already exists — skipping seed.");
    return;
  }

  const softwareLineId = admin.activeSoftwareLineId ?? admin.softwareLineId;

  const projectType = await prisma.projectType.upsert({
    where: { softwareLineId_name: { softwareLineId, name: "Onboarding" } },
    update: {},
    create: {
      name: "Onboarding",
      description: "Getting a new project up and running",
      softwareLineId,
      createdById: admin.id,
    },
  });

  const checklistItem = await prisma.checklistItem.upsert({
    where: { id: `${projectType.id}-setup` },
    update: {},
    create: {
      id: `${projectType.id}-setup`,
      name: "Initial Setup",
      softwareLineId,
      createdById: admin.id,
    },
  });

  const project = await prisma.project.create({
    data: {
      name: "Aurora Launch",
      description: "Demo project created by the seed script.",
      projectTypeId: projectType.id,
      softwareLineId,
      createdById: admin.id,
      members: { create: { userId: admin.id, role: "OWNER" } },
    },
  });

  const subProject = await prisma.subProject.create({
    data: { projectId: project.id, checklistItemId: checklistItem.id, createdById: admin.id },
  });

  await prisma.task.createMany({
    data: [
      {
        title: "Set up project board",
        status: "DONE",
        priority: "MEDIUM",
        createdById: admin.id,
        projectId: project.id,
        subProjectId: subProject.id,
        projectTypeId: projectType.id,
      },
      {
        title: "Invite the team",
        status: "IN_PROGRESS",
        priority: "HIGH",
        createdById: admin.id,
        projectId: project.id,
        subProjectId: subProject.id,
        projectTypeId: projectType.id,
      },
      {
        title: "Plan first sprint",
        status: "TODO",
        priority: "MEDIUM",
        createdById: admin.id,
        projectId: project.id,
        subProjectId: subProject.id,
        projectTypeId: projectType.id,
      },
    ],
  });

  console.log(`Seeded demo project "${project.name}" with 1 sub-project and 3 tasks.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
