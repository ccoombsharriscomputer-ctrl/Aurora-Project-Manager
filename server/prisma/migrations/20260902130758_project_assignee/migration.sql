-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'PROJECT_ASSIGNED';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "assigneeId" TEXT;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
