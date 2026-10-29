-- Knowledge Base import: TRIO TeamSupport Knowledge Base articles sorted by AI for playbooks.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "canImportKb" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "canGrantKbImport" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "KbArticle" (
    "ticketNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "product" TEXT,
    "url" TEXT NOT NULL,
    "articleModified" TEXT NOT NULL,
    "verdict" TEXT,
    "reason" TEXT,
    "sortedAt" TIMESTAMP(3),
    "decision" TEXT NOT NULL DEFAULT 'undecided',
    "decidedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KbArticle_pkey" PRIMARY KEY ("ticketNumber")
);

-- The import's owner starts as the only one with it, and the only one who can give it out.
-- They need the Fix Playbooks page too, to reach it.
UPDATE "User" SET "canImportKb" = true, "canGrantKbImport" = true, "canEditPlaybooks" = true
WHERE lower("email") = 'ccoombs@harriscomputer.com';
