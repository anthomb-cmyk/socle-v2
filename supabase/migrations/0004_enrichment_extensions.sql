-- ════════════════════════════════════════════════════════════════════════
-- Enrichment tables — create + extend.
-- ════════════════════════════════════════════════════════════════════════
-- 0001_init was supposed to include these tables but the chunk got dropped.
-- This migration creates them with the full v0.4 shape (including job_type
-- on jobs and lead_id/source_url/raw_payload/reviewed_* on results).
-- Idempotent — uses IF NOT EXISTS / DO blocks.

-- ─── enums ────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'enrichment_kind') then
    create type enrichment_kind as enum ('phone','email','website','owner_identity','property_fact','note');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'enrichment_result_status') then
    create type enrichment_result_status as enum ('unverified','verified','invalid');
  end if;
end $$;

-- Make sure enrichment_kind has all the v0.4 values (idempotent — adds missing ones).
alter type enrichment_kind add value if not exists 'owner_identity';
alter type enrichment_kind add value if not exists 'property_fact';
alter type enrichment_kind add value if not exists 'note';

-- ─── enrichment_jobs ──────────────────────────────────────────────────
create table if not exists enrichment_jobs (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid references leads(id)    on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  workflow_id     text,
  workflow_run_id text,
  job_type        text not null default 'find_phone'
    check (job_type in ('find_phone','verify_phone','find_email','find_website','owner_identity','property_context','general_research')),
  status          job_status not null default 'pending',
  attempts        smallint not null default 0,
  max_attempts    smallint not null default 3,
  started_at      timestamptz,
  completed_at    timestamptz,
  error_message   text,
  raw_input       jsonb,
  raw_output      jsonb,
  cost_usd        numeric default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists enrichment_jobs_lead_idx     on enrichment_jobs (lead_id);
create index if not exists enrichment_jobs_status_idx   on enrichment_jobs (status);
create index if not exists enrichment_jobs_job_type_idx on enrichment_jobs (job_type);
create index if not exists enrichment_jobs_created_idx  on enrichment_jobs (created_at desc);

-- ─── enrichment_results ────────────────────────────────────────────────
create table if not exists enrichment_results (
  id                 uuid primary key default gen_random_uuid(),
  contact_id         uuid references contacts(id) on delete cascade,
  lead_id            uuid references leads(id)    on delete set null,
  kind               enrichment_kind not null,
  value              text not null,
  source             text not null,
  source_url         text,
  source_column      text,
  confidence         smallint not null default 50 check (confidence between 0 and 100),
  evidence           text,
  status             enrichment_result_status not null default 'unverified',
  raw_payload        jsonb,
  found_in_job_id    uuid references enrichment_jobs(id) on delete set null,
  reviewed_by        uuid references auth.users(id) on delete set null,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- partial unique to dedupe by (contact_id, kind, value) when contact_id is set
create unique index if not exists enrichment_results_dedupe_idx
  on enrichment_results (contact_id, kind, value)
  where contact_id is not null;

create index if not exists enrichment_results_lead_idx     on enrichment_results (lead_id);
create index if not exists enrichment_results_status_idx   on enrichment_results (status);
create index if not exists enrichment_results_pending_idx  on enrichment_results (status) where status = 'unverified';

-- ─── updated_at triggers (reuse the helper from 0001) ─────────────────
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'enrichment_jobs_set_updated_at') then
    create trigger enrichment_jobs_set_updated_at before update on enrichment_jobs
      for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'enrichment_results_set_updated_at') then
    create trigger enrichment_results_set_updated_at before update on enrichment_results
      for each row execute function set_updated_at();
  end if;
end $$;

-- ─── RLS — admin full, others read-only via lead-side check ───────────
alter table enrichment_jobs    enable row level security;
alter table enrichment_results enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='enrichment_jobs' and policyname='admin_all') then
    create policy admin_all on enrichment_jobs for all to authenticated using (is_admin()) with check (is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='enrichment_results' and policyname='admin_all') then
    create policy admin_all on enrichment_results for all to authenticated using (is_admin()) with check (is_admin());
  end if;
end $$;

comment on column enrichment_jobs.job_type        is 'What the worker should look up. Drives which n8n workflow handles the job.';
comment on column enrichment_results.lead_id     is 'Optional lead pin — set when results are reported via /api/n8n/enrichment-result so the lead detail panel can render them.';
comment on column enrichment_results.source_url  is 'URL the value was found at, when applicable (e.g. company website, PJ listing).';
comment on column enrichment_results.raw_payload is 'Whatever the worker captured — usually a slice of HTML / API response, for forensics.';
