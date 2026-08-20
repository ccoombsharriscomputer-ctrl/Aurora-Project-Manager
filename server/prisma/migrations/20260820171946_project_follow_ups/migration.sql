-- AlterTable
ALTER TABLE "FollowUp" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "projectId" TEXT,
ALTER COLUMN "taskId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
