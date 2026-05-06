-- Migration 0020: lead post-processing queue + status consolidation
-- Apply via Supabase MCP or dashboard SQL editor.

-- ── A. Enrichment queue table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lead_post_processing_queue (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references leads(id) on delete cascade,
  task_type       text not null check (task_type in ('briefing', 'fit_score', 'enrichment')),
  priority        smallint not null default 5,  -- lower = higher priority
  status          text not null default 'pending' check (status in ('pending','running','done','failed')),
  attempts        smallint not null default 0,
  last_error      text,
  scheduled_for   timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS lead_post_processing_queue_pending_idx
  ON lead_post_processing_queue(scheduled_for, priority)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS lead_post_processing_queue_lead_idx
  ON lead_post_processing_queue(lead_id, task_type);

ALTER TABLE lead_post_processing_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'lead_post_processing_queue'
      AND policyname = 'admin_all'
  ) THEN
    CREATE POLICY admin_all ON lead_post_processing_queue
      FOR ALL TO authenticated
      USING (is_admin())
      WITH CHECK (is_admin());
  END IF;
END $$;

-- ── G. Status consolidation ─────────────────────────────────────────────────
-- Migrate any leads still using the old 'needs_human_review' status value.
-- We don't drop the enum value to avoid ALTER TYPE complexity.

UPDATE leads SET status = 'needs_phone_review' WHERE status = 'needs_human_review';
