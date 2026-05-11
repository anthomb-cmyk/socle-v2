-- Performance indexes for leads, deals, and call_logs.
-- Resolves slow queue loads and lead table scans on mobile.

-- Composite index: queue and leads page filter (assigned_to + status)
CREATE INDEX IF NOT EXISTS idx_leads_assigned_status
  ON public.leads (assigned_to, status);

-- Composite index: status-ordered list (admin leads table, filters by status + time)
CREATE INDEX IF NOT EXISTS idx_leads_status_created_at
  ON public.leads (status, created_at DESC);

-- Composite index: deals kanban (stage + updated_at for ordered fetch)
CREATE INDEX IF NOT EXISTS idx_deals_stage_updated
  ON public.deals (stage, updated_at DESC);

-- Composite index: call history lookups per lead ordered by time
CREATE INDEX IF NOT EXISTS idx_call_logs_lead_recorded
  ON public.call_logs (lead_id, recorded_at DESC);

-- Rollback:
-- DROP INDEX IF EXISTS public.idx_leads_assigned_status;
-- DROP INDEX IF EXISTS public.idx_leads_status_created_at;
-- DROP INDEX IF EXISTS public.idx_deals_stage_updated;
-- DROP INDEX IF EXISTS public.idx_call_logs_lead_recorded;
