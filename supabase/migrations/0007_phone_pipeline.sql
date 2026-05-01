-- ════════════════════════════════════════════════════════════════════════
-- 0007_phone_pipeline.sql
-- Multi-stage phone enrichment pipeline.
--   • phone_candidates  — one row per phone candidate found by any stage
--   • enrichment_events — event log per lead (replaces ad-hoc automation_events)
--   • new lead_status values for pipeline stages
--   • new enrichment_result_status value 'needs_review' (already in enum? guard below)
-- ════════════════════════════════════════════════════════════════════════

-- ─── New lead_status enum values ─────────────────────────────────────────
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'enrichment_pending';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'enrichment_running';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'phone_verified';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'unresolved_after_all_sources';

-- (already in 0006, but guard anyway)
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'unresolved_after_brave';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'unresolved_after_411';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'unresolved_after_places';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'needs_human_review';

-- ─── phone_candidates ─────────────────────────────────────────────────────
-- One row per candidate found by a pipeline stage (brave / 411 / place_api / openclaw).
-- Separate from enrichment_results (which is the final approved store).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'candidate_status') then
    create type candidate_status as enum (
      'candidate_found',
      'validating_with_openclaw',
      'likely_match',
      'unlikely_match',
      'uncertain',
      'rejected_by_openclaw',
      'needs_anthony_review',
      'approved_by_anthony',
      'rejected_by_anthony'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pipeline_stage') then
    create type pipeline_stage as enum (
      'brave',
      'directory_411',
      'place_api',
      'openclaw'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'openclaw_verdict') then
    create type openclaw_verdict as enum (
      'likely_match',
      'unlikely_match',
      'uncertain'
    );
  end if;
end $$;

create table if not exists phone_candidates (
  id                       uuid primary key default gen_random_uuid(),

  -- Links
  lead_id                  uuid not null references leads(id) on delete cascade,
  contact_id               uuid references contacts(id) on delete set null,
  enrichment_job_id        uuid references enrichment_jobs(id) on delete set null,

  -- The candidate phone
  phone_raw                text not null,               -- exactly as found
  phone_e164               text,                        -- normalized E.164, may be null if parse failed

  -- Where it came from
  stage                    pipeline_stage not null,
  source_label             text,                        -- e.g. "pages_jaunes", "google_places", "brave_search"
  source_url               text,
  snippet                  text,                        -- raw HTML snippet or evidence text
  initial_confidence       smallint not null default 50 check (initial_confidence between 0 and 100),

  -- OpenClaw validation (optional — filled when a low-confidence candidate is validated)
  openclaw_verdict         openclaw_verdict,
  openclaw_confidence      smallint check (openclaw_confidence between 0 and 100),
  openclaw_evidence        text,
  openclaw_reasoning       text,

  -- Lifecycle
  candidate_status         candidate_status not null default 'candidate_found',
  review_reason            text,                        -- why it needs human review

  -- Anthony review
  reviewed_by              uuid references auth.users(id) on delete set null,
  reviewed_at              timestamptz,
  review_note              text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists phone_candidates_lead_idx    on phone_candidates (lead_id);
create index if not exists phone_candidates_status_idx  on phone_candidates (candidate_status);
create index if not exists phone_candidates_review_idx  on phone_candidates (candidate_status)
  where candidate_status = 'needs_anthony_review';
create index if not exists phone_candidates_e164_idx    on phone_candidates (phone_e164)
  where phone_e164 is not null;

-- ─── enrichment_events ────────────────────────────────────────────────────
-- Append-only event log for each pipeline run per lead.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'enrichment_event_type') then
    create type enrichment_event_type as enum (
      'enrichment_started',
      'brave_search_started',
      'brave_search_complete',
      'directory_search_started',
      'directory_search_complete',
      'place_api_search_started',
      'place_api_search_complete',
      'openclaw_search_started',
      'openclaw_search_complete',
      'phone_candidate_found',
      'openclaw_validation_started',
      'openclaw_validation_complete',
      'phone_candidate_needs_review',
      'phone_approved_by_anthony',
      'phone_rejected_by_anthony',
      'unresolved_after_all_sources',
      'lead_status_updated'
    );
  end if;
end $$;

create table if not exists enrichment_events (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads(id) on delete cascade,
  event_type   enrichment_event_type not null,
  stage        pipeline_stage,
  candidate_id uuid references phone_candidates(id) on delete set null,
  payload      jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists enrichment_events_lead_idx  on enrichment_events (lead_id, created_at desc);
create index if not exists enrichment_events_type_idx  on enrichment_events (event_type);

-- ─── updated_at trigger for phone_candidates ──────────────────────────────
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'phone_candidates_set_updated_at') then
    create trigger phone_candidates_set_updated_at
      before update on phone_candidates
      for each row execute function set_updated_at();
  end if;
end $$;

-- ─── RLS ──────────────────────────────────────────────────────────────────
alter table phone_candidates  enable row level security;
alter table enrichment_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='phone_candidates' and policyname='admin_all') then
    create policy admin_all on phone_candidates for all to authenticated using (is_admin()) with check (is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='enrichment_events' and policyname='admin_all') then
    create policy admin_all on enrichment_events for all to authenticated using (is_admin()) with check (is_admin());
  end if;
end $$;

comment on table phone_candidates  is 'One row per candidate phone found by any enrichment stage. Not callable until approved_by_anthony and synced to phones table.';
comment on table enrichment_events is 'Append-only event log for the multi-stage phone enrichment pipeline per lead.';
comment on column phone_candidates.phone_e164 is 'E.164-normalised phone. Null if raw value could not be parsed as a valid NANP number.';
comment on column phone_candidates.openclaw_verdict is 'First-round validation verdict from OpenClaw. Null if not yet validated or not needed.';
comment on column phone_candidates.candidate_status is 'Lifecycle state — only approved_by_anthony leads get promoted to the phones table.';
