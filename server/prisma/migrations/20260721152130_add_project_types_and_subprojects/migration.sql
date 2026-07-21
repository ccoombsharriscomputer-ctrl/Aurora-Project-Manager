/*
  Warnings:

  - Added the required column `subProjectId` to the `Task` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'PROJECT_LEAD';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "subProjectId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "ProjectType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubProject" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectTypeId" TEXT NOT NULL,
    "name" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectType_name_key" ON "ProjectType"("name");

-- AddForeignKey
ALTER TABLE "ProjectType" ADD CONSTRAINT "ProjectType_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubProject" ADD CONSTRAINT "SubProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubProject" ADD CONSTRAINT "SubProject_projectTypeId_fkey" FOREIGN KEY ("projectTypeId") REFERENCES "ProjectType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubProject" ADD CONSTRAINT "SubProject_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_subProjectId_fkey" FOREIGN KEY ("subProjectId") REFERENCES "SubProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
