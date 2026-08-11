-- AlterTable
ALTER TABLE "TaskTemplate" ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing templates with their current creation order per product, so the
-- Products page's initial manual-order rendering matches what users already see today.
WITH ranked AS (
  SELECT id, (ROW_NUMBER() OVER (PARTITION BY "checklistItemId" ORDER BY "createdAt") - 1) * 10 AS rank
  FROM "TaskTemplate"
)
UPDATE "TaskTemplate"
SET "order" = ranked.rank
FROM ranked
WHERE "TaskTemplate".id = ranked.id;
