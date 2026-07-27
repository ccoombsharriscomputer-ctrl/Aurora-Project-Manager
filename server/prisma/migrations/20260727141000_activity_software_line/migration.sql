-- Give Activity its own persistent software line, independent of projectId/taskId,
-- so its history stays scoped and queryable by line even after those FKs go null
-- (e.g. once the project/task they pointed at has been deleted).
ALTER TABLE "Activity" ADD COLUMN "softwareLineId" TEXT;

UPDATE "Activity" a
SET "softwareLineId" = p."softwareLineId"
FROM "Project" p
WHERE a."projectId" = p.id;

ALTER TABLE "Activity" ALTER COLUMN "softwareLineId" SET NOT NULL;

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_softwareLineId_fkey" FOREIGN KEY ("softwareLineId") REFERENCES "SoftwareLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
