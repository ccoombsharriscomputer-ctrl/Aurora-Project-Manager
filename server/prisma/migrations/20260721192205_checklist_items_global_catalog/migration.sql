-- Make ChecklistItem a global catalog shared across project types (previously one type owned each item).

-- CreateTable
CREATE TABLE "ProjectTypeChecklistItem" (
    "projectTypeId" TEXT NOT NULL,
    "checklistItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTypeChecklistItem_pkey" PRIMARY KEY ("projectTypeId","checklistItemId")
);

-- AddForeignKey
ALTER TABLE "ProjectTypeChecklistItem" ADD CONSTRAINT "ProjectTypeChecklistItem_projectTypeId_fkey" FOREIGN KEY ("projectTypeId") REFERENCES "ProjectType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTypeChecklistItem" ADD CONSTRAINT "ProjectTypeChecklistItem_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "ChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: preserve every existing checklist item's association with its current project type
-- before the direct FK column is dropped. Reuses the item's own createdAt for the join row,
-- since for pre-existing rows "attached to its type" and "created" are the same historical moment.
INSERT INTO "ProjectTypeChecklistItem" ("projectTypeId", "checklistItemId", "createdAt")
SELECT "projectTypeId", "id", "createdAt" FROM "ChecklistItem";

-- DropForeignKey
ALTER TABLE "ChecklistItem" DROP CONSTRAINT "ChecklistItem_projectTypeId_fkey";

-- AlterTable
ALTER TABLE "ChecklistItem" DROP COLUMN "projectTypeId";
