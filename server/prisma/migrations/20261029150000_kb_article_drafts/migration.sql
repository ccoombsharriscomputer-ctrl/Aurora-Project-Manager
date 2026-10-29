-- Knowledge Base import: link each picked article to the draft playbook AI made from it.
-- AlterTable
ALTER TABLE "KbArticle" ADD COLUMN "playbookId" TEXT,
ADD COLUMN "draftNote" TEXT;
