-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing tasks with their current creation order per sub-project, so the
-- kanban board's initial manual-order rendering matches what users already see today.
WITH ranked AS (
  SELECT id, (ROW_NUMBER() OVER (PARTITION BY "subProjectId" ORDER BY "createdAt") - 1) * 10 AS rank
  FROM "Task"
)
UPDATE "Task"
SET "order" = ranked.rank
FROM ranked
WHERE "Task".id = ranked.id;
