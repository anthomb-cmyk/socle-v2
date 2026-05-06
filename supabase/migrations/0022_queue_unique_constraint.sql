-- Migration 0022: add unique constraint required by enqueue() upsert.
--
-- enqueue() in web/lib/queue/enqueue.ts uses
--   .upsert(..., { onConflict: "lead_id,task_type", ignoreDuplicates: true })
-- but migration 0020 only created a non-unique index, so every upsert has been
-- failing with "no unique or exclusion constraint matching the ON CONFLICT
-- specification". The error is swallowed by enqueue(), making it a silent no-op.
--
-- This migration replaces the non-unique index with a UNIQUE index, which both
-- backs the ON CONFLICT clause and continues to serve the (lead_id, task_type)
-- read pattern in queue queries.
--
-- IMPORTANT: must be run when no duplicate (lead_id, task_type) rows exist.
-- Verify upfront with:
--   SELECT lead_id, task_type, COUNT(*) FROM lead_post_processing_queue
--   GROUP BY lead_id, task_type HAVING COUNT(*) > 1;

DROP INDEX IF EXISTS lead_post_processing_queue_lead_idx;

CREATE UNIQUE INDEX IF NOT EXISTS lead_post_processing_queue_lead_task_uniq
  ON lead_post_processing_queue(lead_id, task_type);
