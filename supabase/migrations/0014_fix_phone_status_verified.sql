-- 0014_fix_phone_status_verified.sql
--
-- BUG FIX: 'verified' was missing from phone_status enum.
-- The phone-review approval route writes status = 'verified' when an admin
-- approves a candidate, but this value was never in the enum → every approval
-- silently failed with a DB error, leaving phones table unchanged.
--
-- Also fixes leads_view: best_phone subquery only matched 'unverified'/'valid',
-- so even after fixing the enum, approved phones would never surface in the queue.
--
-- Fix 1: add 'verified' to phone_status enum
-- Fix 2: recreate leads_view with 'verified' included in best_phone filter

-- ── 1. Extend enum ────────────────────────────────────────────────────────────
alter type phone_status add value if not exists 'verified';

-- ── 2. Recreate leads_view with verified phones included in best_phone ────────
-- Drop dependent objects first (view is non-materialized, so just drop/recreate)
drop view if exists leads_view;

create view leads_view as
  select
    l.id as lead_id,
    l.status,
    l.priority,
    l.assigned_to,
    l.last_contacted_at,
    l.next_action_at,
    l.campaign_id,
    c.id as campaign_id_,
    c.name as campaign_name,
    p.id as property_id,
    p.address,
    p.city,
    p.num_units,
    p.evaluation_total,
    ct.id as contact_id,
    ct.kind as contact_kind,
    ct.full_name,
    ct.company_name,
    -- Include 'verified' so admin-approved phones surface in the queue.
    -- Ordering: verified > valid > unverified (by confidence desc, then oldest first).
    (select ph.display from phones ph
       where ph.contact_id = ct.id
         and ph.status in ('unverified', 'valid', 'verified')
       order by
         case ph.status when 'verified' then 0 when 'valid' then 1 else 2 end asc,
         ph.confidence desc nulls last,
         ph.created_at asc
       limit 1) as best_phone,
    l.created_at,
    l.updated_at
  from leads l
  left join campaigns c on c.id = l.campaign_id
  join properties p on p.id = l.property_id
  join contacts ct on ct.id = l.contact_id;
