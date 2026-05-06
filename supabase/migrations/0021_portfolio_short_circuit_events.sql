-- Migration 0021: portfolio short-circuit event types.
-- Adds the two new enrichment_event_type enum values used by the cross-lead
-- portfolio short-circuit gate (Stage 0.5 in runEnrichmentPipeline).
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so each
-- statement must be applied separately. Apply via Supabase MCP one-by-one or
-- via the dashboard SQL editor.

ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'portfolio_short_circuit_hit';
ALTER TYPE enrichment_event_type ADD VALUE IF NOT EXISTS 'portfolio_match_ambiguous';
