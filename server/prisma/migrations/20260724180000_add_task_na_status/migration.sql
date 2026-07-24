-- Add an N/A status for tasks that don't apply, plus a required-reason note
ALTER TYPE "TaskStatus" ADD VALUE 'NA';
ALTER TABLE "Task" ADD COLUMN "naReason" TEXT;
