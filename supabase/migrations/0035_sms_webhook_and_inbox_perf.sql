-- Speed up SMS inbox/event lookups and inbound webhook contact matching.

create index if not exists idx_automation_events_event_type_occurred
  on public.automation_events (event_type, occurred_at desc);

create index if not exists idx_leads_contact_updated
  on public.leads (contact_id, updated_at desc);

create index if not exists idx_deals_contact_phone
  on public.deals (contact_phone)
  where contact_phone is not null;

-- Rollback:
-- drop index if exists public.idx_automation_events_event_type_occurred;
-- drop index if exists public.idx_leads_contact_updated;
-- drop index if exists public.idx_deals_contact_phone;
