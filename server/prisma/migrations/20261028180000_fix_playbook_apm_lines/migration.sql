-- Playbook product lines are now APM's own software lines only (TRIO, MSI, Spectrum,
-- OpenWindow, ResourceMate). Any playbook set to another line goes back to all lines.
UPDATE "FixPlaybook" SET "productLine" = NULL
WHERE "productLine" IS NOT NULL AND "productLine" NOT IN ('trio', 'msi', 'spectrum', 'openwindow', 'resourcemate');
