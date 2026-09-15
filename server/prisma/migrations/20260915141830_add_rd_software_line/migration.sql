-- Add a new software line for R & D (production only ever runs `prisma migrate deploy`,
-- never the seed script, so new lines must be inserted here — see 20260722190000_add_software_lines)
INSERT INTO "SoftwareLine" ("id", "name") VALUES
  ('rd', 'R & D');
