-- CreateTable
CREATE TABLE "ContractLine" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "checklistItemId" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hours" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractLine_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN "contractLineId" TEXT;

-- AddForeignKey
ALTER TABLE "ContractLine" ADD CONSTRAINT "ContractLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractLine" ADD CONSTRAINT "ContractLine_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "ChecklistItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_contractLineId_fkey" FOREIGN KEY ("contractLineId") REFERENCES "ContractLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every existing product gets a "Project Management" task template (placed after its other
-- templates), unless it already has one. New products get theirs from the app when created.
INSERT INTO "TaskTemplate" ("id", "checklistItemId", "title", "description", "priority", "active", "order", "createdById", "createdAt")
SELECT
    'pm' || md5(ci."id" || 'project-management'),
    ci."id",
    'Project Management',
    NULL,
    'MEDIUM',
    true,
    COALESCE((SELECT MAX(tt."order") FROM "TaskTemplate" tt WHERE tt."checklistItemId" = ci."id"), 0) + 10,
    ci."createdById",
    CURRENT_TIMESTAMP
FROM "ChecklistItem" ci
WHERE NOT EXISTS (
    SELECT 1 FROM "TaskTemplate" tt
    WHERE tt."checklistItemId" = ci."id" AND lower(tt."title") = 'project management'
);
