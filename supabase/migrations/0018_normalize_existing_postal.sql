-- Migration 0018: Normalize existing postal codes in contacts table.
--
-- CEO: apply this migration via Supabase MCP (apply_migration tool on project mkgkrfcfhtrlecfuzroz).
-- DO NOT run this migration automatically — it must be reviewed and applied manually.
--
-- What this does:
--   1. For every contact where mailing_postal matches the compact 6-char pattern
--      (e.g. "H3S1N3"), insert a space in the middle to produce canonical "XXX YXY" form.
--      This fixes Bug 1 for the 25 contacts imported before the format-b.ts fix was deployed.
--
--   2. For every contact where mailing_postal_fsa IS NULL but mailing_postal is set,
--      derive and populate mailing_postal_fsa from the first 3 characters of the
--      (now normalized) mailing_postal. This fixes Bug 2 for existing rows.

-- Step 1: Normalize compact postal codes (no space → "XXX YXY")
-- Pattern: exactly 6 chars matching Canadian postal code format (no space).
UPDATE contacts
SET mailing_postal = UPPER(SUBSTRING(mailing_postal, 1, 3)) || ' ' || UPPER(SUBSTRING(mailing_postal, 4, 3))
WHERE mailing_postal IS NOT NULL
  AND mailing_postal ~ '^[A-CEGHJ-NPR-TVXY][0-9][A-CEGHJ-NPR-TV-Z][0-9][A-CEGHJ-NPR-TV-Z][0-9]$';

-- Step 2: Backfill mailing_postal_fsa from the first 3 chars of normalized mailing_postal.
-- Applies to any row where FSA is null but postal is set (and is at least 3 chars long).
UPDATE contacts
SET mailing_postal_fsa = UPPER(SUBSTRING(mailing_postal, 1, 3))
WHERE mailing_postal_fsa IS NULL
  AND mailing_postal IS NOT NULL
  AND LENGTH(mailing_postal) >= 3;
