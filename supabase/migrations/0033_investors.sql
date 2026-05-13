-- 0033: Investors module
-- Capital partners / LPs / co-investors — a separate entity from acquisition
-- target contacts. Tracks the investor record, calls with them (with optional
-- Twilio recording + Whisper transcript), ongoing deals (optionally linked to
-- a Socle property), and free-form notes / journal entries.
--
-- Sidebar entry lives under "Calendrier" in the primary nav (see
-- web/components/app-sidebar.tsx).

-- ── Main investor table ─────────────────────────────────────────────────────
create table if not exists investors (
  id                    uuid primary key default gen_random_uuid(),
  full_name             text not null,
  firm_name             text,
  email                 text,
  phone_e164            text,
  city                  text,
  province              text default 'QC',
  -- Soft segmentation
  status                text not null default 'active',   -- active | inactive | lost | prospect
  source                text,                              -- "intro", "cold call", "linkedin", etc.
  -- Capital profile
  capital_available_cad bigint,                            -- total dry powder
  ticket_size_min_cad   bigint,                            -- per-deal minimum
  ticket_size_max_cad   bigint,                            -- per-deal maximum
  preferred_geography   text,                              -- "Montréal", "Estrie", etc.
  asset_class_focus     text,                              -- "multifamily 10-50", etc.
  -- Free-form
  notes                 text,
  -- Audit
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table investors is
  'Capital partners / LPs / co-investors. Separate from acquisition-target contacts.';
comment on column investors.status is
  'active | inactive | lost | prospect';

create index if not exists investors_status_idx     on investors(status);
create index if not exists investors_full_name_idx  on investors(lower(full_name));
create index if not exists investors_firm_name_idx  on investors(lower(firm_name));
create index if not exists investors_updated_at_idx on investors(updated_at desc);


-- ── Calls with this investor ────────────────────────────────────────────────
-- Inbound or outbound. Twilio fields are nullable so manual call logs work
-- without any recording. When twilio_call_sid is set, transcript_status can be
-- "pending" → "processing" → "completed" / "failed" exactly like call_logs.
create table if not exists investor_calls (
  id                uuid primary key default gen_random_uuid(),
  investor_id       uuid not null references investors(id) on delete cascade,
  -- Twilio link (nullable for manual log entries)
  twilio_call_sid   text unique,
  parent_call_sid   text,
  direction         text,                                  -- inbound | outbound | manual
  -- Recording
  recording_url     text,
  recording_sid     text,
  duration_sec      integer,
  -- Whisper
  transcript        text,
  transcript_status text default 'pending',                -- pending | processing | completed | failed | skipped
  -- Caller annotations
  summary           text,
  outcome           text,                                  -- "interested", "passed", "follow_up", etc.
  -- Timestamps
  started_at        timestamptz,
  recorded_at       timestamptz,
  -- Audit
  logged_by         uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  raw               jsonb not null default '{}'::jsonb
);

comment on table investor_calls is
  'Call log per investor. Can be backed by a Twilio recording (with Whisper transcript) or a manual entry.';

create index if not exists investor_calls_investor_idx   on investor_calls(investor_id);
create index if not exists investor_calls_created_at_idx on investor_calls(created_at desc);
create index if not exists investor_calls_sid_idx        on investor_calls(twilio_call_sid);


-- ── Deals with this investor ────────────────────────────────────────────────
-- property_id is OPTIONAL so a deal can reference a real Socle property OR
-- just be a free-form deal_name when the underlying property isn't in Socle.
create table if not exists investor_deals (
  id                  uuid primary key default gen_random_uuid(),
  investor_id         uuid not null references investors(id) on delete cascade,
  property_id         uuid references properties(id) on delete set null,
  deal_name           text not null,
  stage               text not null default 'prospect',
  -- prospect | discussing | loi | due_diligence | financing | closed_won | closed_lost
  ticket_size_cad     bigint,
  expected_close_at   date,
  probability_pct     smallint,                            -- 0-100
  notes               text,
  -- Audit
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table investor_deals is
  'Ongoing deals/opportunities tracked against an investor. property_id is optional.';
comment on column investor_deals.stage is
  'prospect | discussing | loi | due_diligence | financing | closed_won | closed_lost';

create index if not exists investor_deals_investor_idx on investor_deals(investor_id);
create index if not exists investor_deals_stage_idx    on investor_deals(stage);
create index if not exists investor_deals_property_idx on investor_deals(property_id);


-- ── Notes / journal ─────────────────────────────────────────────────────────
-- Free-form markdown entries. Used for meeting notes, preferences, relationship
-- history, anything that doesn't fit the structured tables above.
create table if not exists investor_notes (
  id           uuid primary key default gen_random_uuid(),
  investor_id  uuid not null references investors(id) on delete cascade,
  body         text not null,
  author_id    uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table investor_notes is
  'Free-form markdown notes attached to an investor.';

create index if not exists investor_notes_investor_idx   on investor_notes(investor_id);
create index if not exists investor_notes_created_at_idx on investor_notes(created_at desc);


-- ── updated_at triggers (mirror pattern used elsewhere) ─────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists investors_set_updated_at        on investors;
drop trigger if exists investor_calls_set_updated_at   on investor_calls;
drop trigger if exists investor_deals_set_updated_at   on investor_deals;
drop trigger if exists investor_notes_set_updated_at   on investor_notes;

create trigger investors_set_updated_at        before update on investors        for each row execute function public.set_updated_at();
create trigger investor_calls_set_updated_at   before update on investor_calls   for each row execute function public.set_updated_at();
create trigger investor_deals_set_updated_at   before update on investor_deals   for each row execute function public.set_updated_at();
create trigger investor_notes_set_updated_at   before update on investor_notes   for each row execute function public.set_updated_at();


-- ── Row-level security ─────────────────────────────────────────────────────
-- Admin-only for the MVP. Service-role bypasses RLS as usual; API routes use
-- the admin client so this gate is enforced at the API layer via requireAdmin().
alter table investors        enable row level security;
alter table investor_calls   enable row level security;
alter table investor_deals   enable row level security;
alter table investor_notes   enable row level security;

drop policy if exists investors_admin_all      on investors;
drop policy if exists investor_calls_admin_all on investor_calls;
drop policy if exists investor_deals_admin_all on investor_deals;
drop policy if exists investor_notes_admin_all on investor_notes;

create policy investors_admin_all on investors
  for all using (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin'
  ) with check (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin'
  );

create policy investor_calls_admin_all on investor_calls
  for all using (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin'
  ) with check (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin'
  );

create policy investor_deals_admin_all on investor_deals
  for all using (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin'
  ) with check (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin'
  );

create policy investor_notes_admin_all on investor_notes
  for all using (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin'
  ) with check (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin'
  );


-- Rollback:
--   drop table if exists investor_notes;
--   drop table if exists investor_deals;
--   drop table if exists investor_calls;
--   drop table if exists investors;
