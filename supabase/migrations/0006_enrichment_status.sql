-- 0006_enrichment_status.sql
-- Extend lead_status enum with enrichment pipeline stages.
-- Supabase does not support ALTER TYPE ... ADD VALUE inside a transaction,
-- so we use a direct DDL statement here (safe on pg 14+).

ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'needs_enrichment';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'brave_queued';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'unresolved_after_brave';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'directory_411_queued';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'unresolved_after_411';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'places_queued';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'unresolved_after_places';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'openclaw_queued';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'needs_human_review';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'no_contact_found';

-- Update Patch endpoint validation to allow these new statuses.
-- (No DB change needed — the Next.js API route validates in code, see below.)
