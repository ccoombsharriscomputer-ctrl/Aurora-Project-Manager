import { prisma } from "./lib/prisma";

async function main() {
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    console.log("No users yet — register through the app first, then re-run the seed if you want demo data.");
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

  const projectType = await prisma.projectType.upsert({
    where: { name: "Onboarding" },
    update: {},
    create: { name: "Onboarding", description: "Getting a new project up and running", createdById: admin.id },
  });

  const project = await prisma.project.create({
    data: {
      name: "Aurora Launch",
      description: "Demo project created by the seed script.",
      createdById: admin.id,
      members: { create: { userId: admin.id, role: "OWNER" } },
    },
  });

  const subProject = await prisma.subProject.create({
    data: { projectId: project.id, projectTypeId: projectType.id, createdById: admin.id },
  });

  await prisma.task.createMany({
    data: [
      { title: "Set up project board", status: "DONE", priority: "MEDIUM", createdById: admin.id, projectId: project.id, subProjectId: subProject.id },
      { title: "Invite the team", status: "IN_PROGRESS", priority: "HIGH", createdById: admin.id, projectId: project.id, subProjectId: subProject.id },
      { title: "Plan first sprint", status: "TODO", priority: "MEDIUM", createdById: admin.id, projectId: project.id, subProjectId: subProject.id },
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
