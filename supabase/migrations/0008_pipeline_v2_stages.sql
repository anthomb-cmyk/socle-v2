-- ════════════════════════════════════════════════════════════════════════
-- 0008_pipeline_v2_stages.sql
-- Address-first enrichment pipeline v2.
--
-- Changes:
--   1. New pipeline_stage enum values: address_search, company_search, b2bhint
--   2. New lead_status values tracking each stage + auto-attach result
--   3. New columns on phone_candidates:
--        matched_on        — what field the match was based on
--        search_query      — the exact query that returned this candidate
--        candidate_name    — business/person name from the source
--        candidate_address — address from the source
--        related_entity_name   — when found via B2BHint expansion
--        related_entity_type   — e.g. 'related_company' | 'director' | 'same_address'
-- ════════════════════════════════════════════════════════════════════════

-- ─── New pipeline_stage enum values ──────────────────────────────────────
ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'address_search';
ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'company_search';
ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'b2bhint';

-- ─── New lead_status values ───────────────────────────────────────────────
-- Existing phone gate
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'phone_ready';

-- Address search stage
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'searching_address';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'unresolved_after_address';

-- Company/person search stage
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'searching_company';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'unresolved_after_company';

-- B2BHint expansion stage
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'searching_b2bhint';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'unresolved_after_b2bhint';

-- OpenClaw fallback stage
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'openclaw_reviewing';

-- Terminal states
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'needs_phone_review';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'enrichment_failed';

-- ─── New columns on phone_candidates ─────────────────────────────────────
ALTER TABLE phone_candidates
  ADD COLUMN IF NOT EXISTS matched_on          text,      -- 'mailing_address' | 'mailing_postal' | 'address_company' | 'company_name' | 'director_name' | 'b2bhint_related_company' | 'b2bhint_director' | 'b2bhint_same_address' | 'openclaw'
  ADD COLUMN IF NOT EXISTS search_query        text,      -- exact query string used
  ADD COLUMN IF NOT EXISTS candidate_name      text,      -- business/person name from source
  ADD COLUMN IF NOT EXISTS candidate_address   text,      -- address from source
  ADD COLUMN IF NOT EXISTS related_entity_name text,      -- filled when found via B2BHint
  ADD COLUMN IF NOT EXISTS related_entity_type text;      -- 'related_company' | 'director' | 'same_address'

-- ─── New event types ──────────────────────────────────────────────────────
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'address_search_started';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'address_search_complete';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'company_search_started';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'company_search_complete';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'b2bhint_search_started';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'b2bhint_search_complete';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'phone_auto_attached';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'existing_phone_found';

-- ─── Index on matched_on for reporting ───────────────────────────────────
CREATE INDEX IF NOT EXISTS phone_candidates_matched_on_idx ON phone_candidates (matched_on)
  WHERE matched_on IS NOT NULL;

COMMENT ON COLUMN phone_candidates.matched_on IS 'Which lead field the phone was matched against (mailing_address, company_name, director_name, b2bhint_*, openclaw).';
COMMENT ON COLUMN phone_candidates.search_query IS 'Exact search query string that returned this candidate.';
COMMENT ON COLUMN phone_candidates.candidate_name IS 'Business or person name as returned by the source.';
COMMENT ON COLUMN phone_candidates.candidate_address IS 'Address as returned by the source.';
COMMENT ON COLUMN phone_candidates.related_entity_name IS 'When found via B2BHint expansion, the related entity that led to this phone.';
COMMENT ON COLUMN phone_candidates.related_entity_type IS 'Type of the related entity: related_company, director, same_address.';
