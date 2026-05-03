-- ════════════════════════════════════════════════════════════════════════
-- 0009_openclaw_stage3.sql
-- W7 pipeline v3: OpenClaw becomes Stage 3 (replacing B2BHint).
--
-- Changes:
--   1. New lead_status values for OpenClaw-as-Stage-3
--   2. New enrichment_event_type values for dispatch + callback tracking
--
-- B2BHint stage is removed from the pipeline entirely.
-- The old b2bhint enum values (searching_b2bhint, unresolved_after_b2bhint)
-- are kept in the DB for historical rows — they are just never written again.
-- ════════════════════════════════════════════════════════════════════════

-- ─── New lead_status values ───────────────────────────────────────────────────

-- OpenClaw is now Stage 3 (automated browser research in progress)
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'openclaw_researching';

-- Terminal state when OpenClaw also returns nothing
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'unresolved_after_openclaw';

-- ─── New enrichment_event_type values ─────────────────────────────────────────

-- Fired the moment we POST to the OpenClaw webhook and get 200 back
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'openclaw_dispatched';

-- Fired when OpenClaw POSTs back to /api/enrichment/openclaw-callback
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'openclaw_callback_received';
