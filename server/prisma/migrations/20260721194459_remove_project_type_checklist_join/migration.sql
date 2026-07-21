/*
  Warnings:

  - You are about to drop the `ProjectTypeChecklistItem` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ProjectTypeChecklistItem" DROP CONSTRAINT "ProjectTypeChecklistItem_checklistItemId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectTypeChecklistItem" DROP CONSTRAINT "ProjectTypeChecklistItem_projectTypeId_fkey";

-- DropTable
DROP TABLE "ProjectTypeChecklistItem";
