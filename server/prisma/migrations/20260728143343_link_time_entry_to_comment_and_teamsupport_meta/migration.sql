-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "teamSupportActionType" TEXT,
ADD COLUMN     "teamSupportIsPublic" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "commentId" TEXT;

-- Backfill: link each existing hours-carrying comment to the TimeEntry it originally created
-- alongside it (same task/user, identical note/body text, created within the same request —
-- i.e. within seconds of each other). Comments and TimeEntries have always been created
-- together in one request when hours are logged, so this recovers that link for historical
-- rows that predate the commentId column.
WITH pairs AS (
  SELECT te.id AS time_entry_id, c.id AS comment_id,
         ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY ABS(EXTRACT(EPOCH FROM (te."createdAt" - c."createdAt")))) AS rn
  FROM "TimeEntry" te
  JOIN "Comment" c
    ON te."taskId" = c."taskId"
   AND te."userId" = c."authorId"
   AND te."note" = c."body"
   AND ABS(EXTRACT(EPOCH FROM (te."createdAt" - c."createdAt"))) < 60
  WHERE te."commentId" IS NULL
)
UPDATE "TimeEntry"
SET "commentId" = pairs.comment_id
FROM pairs
WHERE "TimeEntry".id = pairs.time_entry_id AND pairs.rn = 1;

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_commentId_key" ON "TimeEntry"("commentId");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
