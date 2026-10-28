-- Every fix playbook now belongs to exactly one product line (the lines work too differently
-- to share a fix). The starter playbooks are split per line from a year of closed Support
-- tickets per line (researched 2026-10-28): a line gets its own copy where it had roughly 10+
-- tickets on that problem. Copies start switched off with no steps, ready for an AI draft from
-- that line's tickets; steps already written stay on the original. Product filters are cleared
-- where the line now does that job.

-- Harris Cloud is only used by OpenWindow (the rest of those tickets are SmartFusion).
UPDATE "FixPlaybook" SET "productLine" = 'openwindow' WHERE "id" = 'starter_playbook_01';

-- Password resets: TRIO, MSI and Spectrum (OpenWindow's are the Harris Cloud ones above).
UPDATE "FixPlaybook"
SET "title" = 'Password reset / locked out', "products" = ARRAY[]::TEXT[], "productLine" = 'trio'
WHERE "id" = 'starter_playbook_02' AND "title" = 'Hosted password reset / locked out (A+, Spectrum)';

-- Whitelisting is almost all SmartFusion; dropped unless someone already wrote steps for it.
DELETE FROM "FixPlaybook" WHERE "id" = 'starter_playbook_03' AND "steps" = '';

-- Posted journals: the TRIO copy no longer needs the Budgetary/FLEXIBILL/MICROFUND filter.
UPDATE "FixPlaybook" SET "products" = ARRAY[]::TEXT[]
WHERE "id" = 'starter_playbook_12' AND "products" = ARRAY['Budgetary', 'FLEXIBILL', 'MICROFUND']::TEXT[];

-- Everything still without a line (the remaining starters, and anything added since) keeps its
-- steps as the TRIO playbook.
UPDATE "FixPlaybook" SET "productLine" = 'trio' WHERE "productLine" IS NULL;

-- One copy per extra line that has the problem.
INSERT INTO "FixPlaybook" ("id", "title", "productLine", "matchPhrases", "products", "steps", "active", "sourceTickets", "updatedAt")
SELECT p."id" || '_' || c.line, COALESCE(c.title, p."title"), c.line, p."matchPhrases", ARRAY[]::TEXT[], '', false, ARRAY[]::TEXT[], CURRENT_TIMESTAMP
FROM (VALUES
  ('starter_playbook_02', 'msi', NULL::TEXT),
  ('starter_playbook_02', 'spectrum', NULL),
  ('starter_playbook_05', 'msi', NULL),
  ('starter_playbook_05', 'spectrum', NULL),
  ('starter_playbook_05', 'openwindow', NULL),
  ('starter_playbook_06', 'msi', 'Printer setup'),
  ('starter_playbook_06', 'spectrum', 'Printer setup'),
  ('starter_playbook_06', 'openwindow', 'Printer setup'),
  ('starter_playbook_07', 'msi', NULL),
  ('starter_playbook_07', 'spectrum', NULL),
  ('starter_playbook_07', 'openwindow', NULL),
  ('starter_playbook_09', 'spectrum', NULL),
  ('starter_playbook_11', 'msi', NULL),
  ('starter_playbook_11', 'spectrum', NULL),
  ('starter_playbook_11', 'openwindow', NULL),
  ('starter_playbook_12', 'msi', NULL),
  ('starter_playbook_12', 'spectrum', NULL)
) AS c(src, line, title)
JOIN "FixPlaybook" p ON p."id" = c.src
ON CONFLICT ("id") DO NOTHING;

-- AlterTable
ALTER TABLE "FixPlaybook" ALTER COLUMN "productLine" SET NOT NULL;
