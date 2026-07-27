-- New activity types for deletion events.
ALTER TYPE "ActivityType" ADD VALUE 'PROJECT_DELETED';
ALTER TYPE "ActivityType" ADD VALUE 'SUBPROJECT_DELETED';
ALTER TYPE "ActivityType" ADD VALUE 'TASK_DELETED';

-- Preserve activity history when the project/task it references is later deleted,
-- instead of cascading it away. The activity's message text already carries the
-- name/title as plain text, so the row stays meaningful even once projectId/taskId
-- go null — this is what lets deleted projects, sub-projects, and tasks keep showing
-- up in the audit trail via their own new PROJECT_DELETED/SUBPROJECT_DELETED/TASK_DELETED
-- entries and everything logged against them beforehand.
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_projectId_fkey";
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Activity" DROP CONSTRAINT "Activity_taskId_fkey";
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
