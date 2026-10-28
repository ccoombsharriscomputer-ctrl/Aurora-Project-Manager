-- CreateTable
CREATE TABLE "FixPlaybook" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "matchPhrases" TEXT[],
    "products" TEXT[],
    "steps" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sourceTickets" TEXT[],
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixPlaybook_pkey" PRIMARY KEY ("id")
);

-- Starter list: support's most common closed-ticket problems over the 60 days to 2026-10-28.
-- No steps yet and switched off; a lead drafts the steps (AI button on the admin page),
-- checks them and switches each one on.
INSERT INTO "FixPlaybook" ("id", "title", "matchPhrases", "products", "sourceTickets", "updatedAt") VALUES
  ('starter_playbook_01', 'Harris Cloud password reset', ARRAY['cloud password', 'harris cloud locked', 'harris cloud login'], ARRAY[]::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  ('starter_playbook_02', 'Hosted password reset / locked out (A+, Spectrum)', ARRAY['password reset', 'reset password', 'locked out', 'password expired'], ARRAY['Hosted'], ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  ('starter_playbook_03', 'Whitelist an IP address', ARRAY['whitelist', 'white list'], ARRAY[]::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  ('starter_playbook_04', 'TRIO expired / expiration update', ARRAY['trio expired', 'trio expiration', 'expiration update', 'sql expiration', 'web expiration'], ARRAY[]::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  ('starter_playbook_05', 'Customer Hub access request', ARRAY['customer hub'], ARRAY[]::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  ('starter_playbook_06', 'Receipt / MVR printer setup', ARRAY['printer', 'printers', 'printer setup', 'print setup'], ARRAY['TRIO'], ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  ('starter_playbook_07', 'Check printing and voiding checks', ARRAY['check printing', 'printing checks', 'print checks', 'void check', 'voided check', 'voiding'], ARRAY[]::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  ('starter_playbook_08', 'Motor vehicle / BMV / Rapid Renewal', ARRAY['bmv', 'rapid renewal', 'registration', 'registrations', 'mvr'], ARRAY['Motor Vehicle'], ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  ('starter_playbook_09', 'Cash Receipting: invalid receipt or no access', ARRAY['invalid receipt', 'cash receipting', 'cash receipt'], ARRAY[]::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  ('starter_playbook_10', 'Menu or module grayed out / missing (permissions)', ARRAY['grayed out', 'greyed out', 'permission', 'permissions', 'security rights', 'printer setup missing'], ARRAY[]::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  ('starter_playbook_11', 'Direct deposit / ACH', ARRAY['direct deposit', 'ach', 'nacha'], ARRAY[]::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  ('starter_playbook_12', 'Deleting or fixing a posted journal', ARRAY['journal', 'journals', 'journal entry'], ARRAY['Budgetary', 'FLEXIBILL', 'MICROFUND'], ARRAY[]::TEXT[], CURRENT_TIMESTAMP);
