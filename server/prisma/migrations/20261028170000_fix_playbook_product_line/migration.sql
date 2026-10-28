-- AlterTable
ALTER TABLE "FixPlaybook" ADD COLUMN "productLine" TEXT;

-- Starter playbooks that belong to one product line (from where their tickets came from).
-- Only the line is set, so steps a lead has already written are kept.
UPDATE "FixPlaybook" SET "productLine" = 'smartfusion' WHERE "id" = 'starter_playbook_01';
UPDATE "FixPlaybook" SET "productLine" = 'trio' WHERE "id" IN ('starter_playbook_04', 'starter_playbook_06', 'starter_playbook_08');
-- The printer playbook's "TRIO" product filter is now the line itself.
UPDATE "FixPlaybook" SET "products" = ARRAY[]::TEXT[] WHERE "id" = 'starter_playbook_06' AND "products" = ARRAY['TRIO']::TEXT[];
