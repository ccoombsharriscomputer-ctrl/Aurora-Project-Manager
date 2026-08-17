-- AlterTable
ALTER TABLE "FollowUp" ADD COLUMN     "remindedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailNotifications" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "JobRun" (
    "name" TEXT NOT NULL,
    "lastRunOn" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("name")
);

-- Back-fill: mark every already-past-due follow-up as already reminded, so the first
-- production run of the daily digest doesn't suddenly email every historical follow-up
-- ever created. Follow-ups still due in the future are left alone (remindedAt stays NULL)
-- so they get a real reminder on their actual due date.
UPDATE "FollowUp" SET "remindedAt" = now() WHERE "dueDate" < now();
