-- CreateTable
CREATE TABLE "SoftwareLine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoftwareLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SoftwareLine_name_key" ON "SoftwareLine"("name");

-- Seed the fixed set of software lines (production only ever runs `prisma migrate deploy`,
-- never the seed script, so these rows must be inserted here)
INSERT INTO "SoftwareLine" ("id", "name") VALUES
  ('trio', 'TRIO'),
  ('msi', 'MSI'),
  ('spectrum', 'Spectrum'),
  ('openwindow', 'OpenWindow'),
  ('resourcemate', 'ResourceMate');

-- AlterTable: add scoping columns nullable first (existing rows need backfilling below)
ALTER TABLE "AccessRequest" ADD COLUMN     "softwareLineId" TEXT;
ALTER TABLE "ChecklistItem" ADD COLUMN     "softwareLineId" TEXT;
ALTER TABLE "Project" ADD COLUMN     "softwareLineId" TEXT;
ALTER TABLE "ProjectType" ADD COLUMN     "softwareLineId" TEXT;
ALTER TABLE "User" ADD COLUMN     "activeSoftwareLineId" TEXT,
ADD COLUMN     "softwareLineId" TEXT;

-- Backfill all pre-existing rows onto the TRIO line
UPDATE "AccessRequest" SET "softwareLineId" = 'trio' WHERE "softwareLineId" IS NULL;
UPDATE "ChecklistItem" SET "softwareLineId" = 'trio' WHERE "softwareLineId" IS NULL;
UPDATE "Project" SET "softwareLineId" = 'trio' WHERE "softwareLineId" IS NULL;
UPDATE "ProjectType" SET "softwareLineId" = 'trio' WHERE "softwareLineId" IS NULL;
UPDATE "User" SET "softwareLineId" = 'trio' WHERE "softwareLineId" IS NULL;

-- Now safe to enforce NOT NULL
ALTER TABLE "AccessRequest" ALTER COLUMN "softwareLineId" SET NOT NULL;
ALTER TABLE "ChecklistItem" ALTER COLUMN "softwareLineId" SET NOT NULL;
ALTER TABLE "Project" ALTER COLUMN "softwareLineId" SET NOT NULL;
ALTER TABLE "ProjectType" ALTER COLUMN "softwareLineId" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "softwareLineId" SET NOT NULL;

-- DropIndex (global project-type name uniqueness is replaced by per-line uniqueness below)
DROP INDEX "ProjectType_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "ProjectType_softwareLineId_name_key" ON "ProjectType"("softwareLineId", "name");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_softwareLineId_fkey" FOREIGN KEY ("softwareLineId") REFERENCES "SoftwareLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeSoftwareLineId_fkey" FOREIGN KEY ("activeSoftwareLineId") REFERENCES "SoftwareLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_softwareLineId_fkey" FOREIGN KEY ("softwareLineId") REFERENCES "SoftwareLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectType" ADD CONSTRAINT "ProjectType_softwareLineId_fkey" FOREIGN KEY ("softwareLineId") REFERENCES "SoftwareLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_softwareLineId_fkey" FOREIGN KEY ("softwareLineId") REFERENCES "SoftwareLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_softwareLineId_fkey" FOREIGN KEY ("softwareLineId") REFERENCES "SoftwareLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
