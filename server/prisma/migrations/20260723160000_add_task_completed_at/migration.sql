-- Add completedAt tracking to Task
ALTER TABLE "Task" ADD COLUMN "completedAt" TIMESTAMP(3);

-- Backfill: for tasks already DONE, approximate completedAt with updatedAt
-- (the best available signal, since prior to this migration completion time wasn't tracked separately)
UPDATE "Task" SET "completedAt" = "updatedAt" WHERE "status" = 'DONE';
