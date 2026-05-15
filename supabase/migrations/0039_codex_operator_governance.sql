-- 0039_codex_operator_governance.sql
-- Governance-first Codex operator mode:
--   - distinguish Codex-authored automation events
--   - expose one import-scoped phone enrichment summary view

alter table public.automation_events
  add column if not exists actor_kind text not null default 'human';

create index if not exists automation_events_actor_import_idx
  on public.automation_events (actor_kind, related_import_id, occurred_at desc)
  where related_import_id is not null;

create unique index if not exists automation_events_codex_idempotency_idx
  on public.automation_events (
    related_import_id,
    ((payload -> 'codex' ->> 'idempotency_key'))
  )
  where actor_kind = 'codex'
    and event_type = 'codex_action'
    and related_import_id is not null
    and (payload -> 'codex' ->> 'idempotency_key') is not null;

comment on column public.automation_events.actor_kind is
  'Actor category for audit filtering: human by default; codex for Codex operator actions. Detailed reversible metadata lives in payload.codex.';

alter type public.enrichment_event_type add value if not exists 'query_built';
alter type public.enrichment_event_type add value if not exists 'phone_approved_by_codex';
alter type public.enrichment_event_type add value if not exists 'phone_rejected_by_codex';
alter type public.candidate_status add value if not exists 'approved_by_codex';
alter type public.candidate_status add value if not exists 'rejected_by_codex';

create table if not exists public.codex_sessions (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.import_jobs(id) on delete cascade,
  started_by uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'codex',
  token_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'ended', 'expired', 'revoked')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  ended_at timestamptz,
  last_action_at timestamptz
);

create index if not exists codex_sessions_import_idx
  on public.codex_sessions(import_job_id, status, expires_at desc);

alter table public.codex_sessions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'codex_sessions'
      and policyname = 'admin_all'
  ) then
    create policy admin_all on public.codex_sessions
      for all to authenticated
      using (is_admin())
      with check (is_admin());
  end if;
end $$;

create table if not exists public.codex_trust_thresholds (
  id uuid primary key default gen_random_uuid(),
  action_type text not null check (action_type in ('approve_phone_candidate', 'reject_phone_candidate')),
  source_label text,
  source_class text,
  matched_on text,
  sample_size int not null default 0,
  agreement_rate numeric(5, 4) not null default 0,
  enabled boolean not null default false,
  cold_start boolean not null default true,
  computed_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  unique (action_type, source_label, source_class, matched_on)
);

alter table public.codex_trust_thresholds enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'codex_trust_thresholds'
      and policyname = 'admin_all'
  ) then
    create policy admin_all on public.codex_trust_thresholds
      for all to authenticated
      using (is_admin())
      with check (is_admin());
  end if;
end $$;

create table if not exists public.source_trust_observations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  phone_id uuid references public.phones(id) on delete set null,
  phone_candidate_id uuid references public.phone_candidates(id) on delete set null,
  source_label text,
  source_class text,
  matched_on text,
  observation text not null check (observation in ('connected', 'wrong_number', 'bad_number', 'manual_approved', 'manual_rejected', 'auto_approved', 'auto_rejected')),
  confidence numeric(5, 4),
  payload jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  observed_by uuid references auth.users(id) on delete set null
);

create index if not exists source_trust_observations_source_idx
  on public.source_trust_observations(source_label, source_class, matched_on, observed_at desc);

create index if not exists source_trust_observations_lead_idx
  on public.source_trust_observations(lead_id, observed_at desc);

alter table public.source_trust_observations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'source_trust_observations'
      and policyname = 'admin_all'
  ) then
    create policy admin_all on public.source_trust_observations
      for all to authenticated
      using (is_admin())
      with check (is_admin());
  end if;
end $$;

grant select, insert, update, delete on public.codex_sessions to authenticated;
grant select, insert, update, delete on public.codex_trust_thresholds to authenticated;
grant select, insert, update, delete on public.source_trust_observations to authenticated;

drop view if exists public.phone_enrichment_import_summary;

create view public.phone_enrichment_import_summary
with (security_invoker = true)
as
select
  ij.id as import_job_id,
  ij.file_name,
  ij.status as import_status,
  ij.format_detected,
  ij.campaign_id,
  ij.total_rows,
  ij.properties_created,
  ij.properties_updated,
  ij.contacts_created,
  ij.contacts_updated,
  ij.phones_created,
  ij.leads_created,
  ij.leads_updated,
  ij.errors_count,
  ij.created_at,
  ij.started_at,
  ij.completed_at,
  ij.updated_at,

  coalesce(lead_stats.total_leads, 0) as total_leads,
  coalesce(lead_stats.ready_to_call, 0) as ready_to_call,
  coalesce(lead_stats.needs_phone_review, 0) as needs_phone_review,
  coalesce(lead_stats.unresolved_after_all_sources, 0) as unresolved_after_all_sources,
  coalesce(lead_stats.unresolved_after_openclaw, 0) as unresolved_after_openclaw,
  coalesce(lead_stats.unsuitable_for_phone_enrichment, 0) as unsuitable_for_phone_enrichment,
  coalesce(lead_stats.new_leads, 0) as new_leads,
  coalesce(phone_stats.leads_with_phone, 0) as leads_with_phone,
  greatest(coalesce(lead_stats.total_leads, 0) - coalesce(phone_stats.leads_with_phone, 0), 0) as leads_without_phone,

  coalesce(queue_stats.queue_pending, 0) as queue_pending,
  coalesce(queue_stats.queue_running, 0) as queue_running,
  coalesce(queue_stats.queue_done, 0) as queue_done,
  coalesce(queue_stats.queue_failed, 0) as queue_failed,

  coalesce(job_stats.jobs_pending, 0) as jobs_pending,
  coalesce(job_stats.jobs_processing, 0) as jobs_processing,
  coalesce(job_stats.jobs_completed, 0) as jobs_completed,
  coalesce(job_stats.jobs_failed, 0) as jobs_failed,
  coalesce(job_stats.stale_jobs, 0) as stale_jobs,

  coalesce(candidate_stats.review_candidates, 0) as review_candidates,
  coalesce(candidate_stats.weak_candidates, 0) as weak_candidates,
  coalesce(candidate_stats.auto_attached_candidates, 0) as auto_attached_candidates,
  coalesce(candidate_stats.rejected_candidates, 0) as rejected_candidates,

  coalesce(ai_stats.ai_cost_usd, 0)::numeric(12, 6) as ai_cost_usd,
  coalesce(codex_stats.codex_action_count, 0) as codex_action_count
from public.import_jobs ij
left join lateral (
  select
    count(*)::int as total_leads,
    count(*) filter (where l.status = 'ready_to_call')::int as ready_to_call,
    count(*) filter (where l.status = 'needs_phone_review')::int as needs_phone_review,
    count(*) filter (where l.status = 'unresolved_after_all_sources')::int as unresolved_after_all_sources,
    count(*) filter (where l.status = 'unresolved_after_openclaw')::int as unresolved_after_openclaw,
    count(*) filter (where l.status = 'unsuitable_for_phone_enrichment')::int as unsuitable_for_phone_enrichment,
    count(*) filter (where l.status = 'new')::int as new_leads
  from public.leads l
  where l.source_import_job_id = ij.id
) lead_stats on true
left join lateral (
  select count(distinct l.id)::int as leads_with_phone
  from public.leads l
  join public.phones ph on ph.contact_id = l.contact_id
  where l.source_import_job_id = ij.id
    and ph.status in ('unverified', 'valid', 'verified')
) phone_stats on true
left join lateral (
  select
    count(*) filter (where q.status = 'pending')::int as queue_pending,
    count(*) filter (where q.status = 'running')::int as queue_running,
    count(*) filter (where q.status = 'done')::int as queue_done,
    count(*) filter (where q.status = 'failed')::int as queue_failed
  from public.lead_post_processing_queue q
  join public.leads l on l.id = q.lead_id
  where l.source_import_job_id = ij.id
    and q.task_type = 'enrichment'
) queue_stats on true
left join lateral (
  select
    count(*) filter (where ej.status = 'pending')::int as jobs_pending,
    count(*) filter (where ej.status = 'processing')::int as jobs_processing,
    count(*) filter (where ej.status = 'completed')::int as jobs_completed,
    count(*) filter (where ej.status = 'failed')::int as jobs_failed,
    count(*) filter (
      where (
        (ej.status = 'pending' and ej.created_at < now() - interval '30 minutes')
        or (ej.status = 'processing' and coalesce(ej.started_at, ej.created_at) < now() - interval '60 minutes')
      )
    )::int as stale_jobs
  from public.enrichment_jobs ej
  join public.leads l on l.id = ej.lead_id
  where l.source_import_job_id = ij.id
    and ej.job_type = 'find_phone'
) job_stats on true
left join lateral (
  select
    count(*) filter (where pc.candidate_status::text = 'needs_anthony_review')::int as review_candidates,
    count(*) filter (where pc.candidate_status::text = 'weak_review')::int as weak_candidates,
    count(*) filter (where pc.candidate_status::text in ('auto_attached', 'approved_by_codex'))::int as auto_attached_candidates,
    count(*) filter (where pc.candidate_status::text in ('rejected_by_openclaw', 'rejected_by_anthony', 'rejected_by_codex', 'pipeline_rejected', 'quarantined'))::int as rejected_candidates
  from public.phone_candidates pc
  join public.leads l on l.id = pc.lead_id
  where l.source_import_job_id = ij.id
) candidate_stats on true
left join lateral (
  select coalesce(sum(log.cost_usd), 0) as ai_cost_usd
  from public.llm_usage_log log
  join public.leads l on l.id = log.lead_id
  where l.source_import_job_id = ij.id
) ai_stats on true
left join lateral (
  select count(*)::int as codex_action_count
  from public.automation_events ae
  where ae.related_import_id = ij.id
    and ae.actor_kind = 'codex'
) codex_stats on true;

grant select on public.phone_enrichment_import_summary to authenticated;

comment on view public.phone_enrichment_import_summary is
  'Import-scoped phone enrichment dashboard for Codex operator mode. Uses security_invoker so underlying RLS still applies.';
