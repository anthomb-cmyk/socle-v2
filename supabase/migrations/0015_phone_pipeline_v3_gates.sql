-- Migration 0015 — Phone enrichment v3: gate engine, source classification,
-- and quarantine state.
--
-- This migration is purely additive. Existing candidates keep their statuses;
-- the v3 pipeline writes the new statuses (weak_review, quarantined,
-- pipeline_rejected) and populates gate_results / source_class.

-- ── Extend candidate_status enum ───────────────────────────────────────────
ALTER TYPE candidate_status ADD VALUE IF NOT EXISTS 'weak_review';
ALTER TYPE candidate_status ADD VALUE IF NOT EXISTS 'quarantined';
ALTER TYPE candidate_status ADD VALUE IF NOT EXISTS 'pipeline_rejected';

-- ── Extend enrichment_event_type enum ──────────────────────────────────────
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'preflight_failed';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'preflight_passed';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'query_built';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'source_classified';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'candidate_quarantined';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'candidate_pipeline_rejected';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'phone_extraction_rejected';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'haiku_validation_started';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'haiku_validation_complete';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'candidates_reclassified';

-- ── New phone_candidates columns ───────────────────────────────────────────
ALTER TABLE phone_candidates
  ADD COLUMN IF NOT EXISTS gate_results jsonb,
  ADD COLUMN IF NOT EXISTS source_class text;

CREATE INDEX IF NOT EXISTS phone_candidates_source_class_idx ON phone_candidates(source_class);

-- Index for the review queue (reviewable dispositions only).
CREATE INDEX IF NOT EXISTS phone_candidates_reviewable_idx
  ON phone_candidates(candidate_status)
  WHERE candidate_status IN ('needs_anthony_review', 'weak_review');

-- Index for quarantined audit views (quick "show me what we hid").
CREATE INDEX IF NOT EXISTS phone_candidates_quarantined_idx
  ON phone_candidates(lead_id, created_at)
  WHERE candidate_status IN ('quarantined', 'pipeline_rejected');

-- ── Allow new lead status ──────────────────────────────────────────────────
-- The leads.status column is text in the current schema, so no enum change
-- is required for unsuitable_for_phone_enrichment. (Verified in migration 0007.)
