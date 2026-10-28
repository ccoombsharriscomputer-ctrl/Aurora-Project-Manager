-- A task can optionally also appear on the Aurora Calendar.
-- AlterTable
ALTER TABLE "Task" ADD COLUMN "onCalendar" BOOLEAN NOT NULL DEFAULT false;
