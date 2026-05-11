-- Aggregate RPC for queue page: returns per-lead call counts without
-- fetching every call_log row to the application layer.
CREATE OR REPLACE FUNCTION public.get_call_counts_for_leads(lead_ids uuid[])
RETURNS TABLE(lead_id uuid, call_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT cl.lead_id, COUNT(*) AS call_count
  FROM public.call_logs cl
  WHERE cl.lead_id = ANY(lead_ids)
  GROUP BY cl.lead_id;
$$;

-- Rollback:
-- DROP FUNCTION IF EXISTS public.get_call_counts_for_leads(uuid[]);
