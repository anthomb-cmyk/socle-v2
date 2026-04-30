-- ════════════════════════════════════════════════════════════════════════
-- Socle CRM V2 — Initial schema
-- ════════════════════════════════════════════════════════════════════════
-- Single-tenant. Two roles via auth.app_metadata.role: 'admin' | 'caller'.
-- All entity tables: uuid pk, timestamptz timestamps, updated_at trigger.
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ─── helpers ────────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function current_role_name() returns text language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'caller')
$$;

create or replace function is_admin() returns boolean language sql stable as $$
  select current_role_name() = 'admin'
$$;

-- City normalization. Mirror in /web/lib/cities.ts.
create or replace function normalize_city(input text) returns text language sql immutable as $$
  select case
    when input is null then null
    else
      -- Title-case the result, with QC-specific corrections
      regexp_replace(
        initcap(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(trim(input),
                  '\s+', ' ', 'g'),
                '^st[\.\-\s]', 'saint-', 'i'),
              '^ste[\.\-\s]', 'sainte-', 'i'),
            '\-', ' ', 'g')),
        ' ', '-', 'g')
  end
$$;
comment on function normalize_city is 'VICTORIAVILLE→Victoriaville · ST-HYACINTHE→Saint-Hyacinthe · STE FOY→Sainte-Foy';

-- ─── enums ──────────────────────────────────────────────────────────────
create type contact_kind as enum ('person', 'company', 'numbered_co', 'trust', 'unknown');

create type relationship_kind as enum (
  'owner', 'co_owner', 'usufructuary',
  'building_only', 'land_only',
  'broker', 'manager', 'rep_of_company',
  'spouse', 'family', 'tenant', 'unknown'
);

create type phone_status as enum (
  'unverified', 'valid', 'invalid', 'bad_number',
  'wrong_person', 'do_not_contact', 'duplicate'
);

create type phone_source as enum (
  'role', 'file', 'manual', 'caller_verified',
  'brave', 'google_places', 'pages_jaunes', '411ca', 'enrichment_other'
);

create type lead_status as enum (
  'new', 'enriching', 'ready_to_call', 'in_outreach',
  'meeting_set', 'qualified', 'no_answer',
  'rejected', 'do_not_contact'
);

create type call_outcome as enum (
  'no_answer', 'voicemail_left', 'wrong_number', 'bad_number',
  'not_interested', 'maybe_later', 'already_sold',
  'wants_more_info', 'open_to_selling', 'wants_offer',
  'hot_seller', 'follow_up_booked', 'do_not_contact'
);

create type submission_status as enum ('pending', 'reviewed', 'accepted', 'rejected', 'archived');
create type review_status     as enum ('open', 'accepted', 'archived', 'rejected');
create type review_urgency    as enum ('urgent', 'high', 'normal', 'low');
create type job_status        as enum ('pending', 'preview', 'confirmed', 'processing', 'completed', 'failed', 'cancelled');
create type follow_up_status  as enum ('pending', 'done', 'cancelled');
create type proposed_status   as enum ('pending', 'accepted', 'rejected');

-- ════════════════════════════════════════════════════════════════════════
-- users_meta — extends auth.users with app role + display name + telegram
-- ════════════════════════════════════════════════════════════════════════
create table users_meta (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  display_name     text,
  role             text not null default 'caller' check (role in ('admin','caller')),
  telegram_user_id text,
  twilio_forward_to text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger users_meta_set_updated_at before update on users_meta for each row execute function set_updated_at();
comment on table users_meta is 'Per-user app metadata. role is mirrored from app_metadata for joins.';

-- ════════════════════════════════════════════════════════════════════════
-- campaigns
-- ════════════════════════════════════════════════════════════════════════
create table campaigns (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  city         text,
  source       text,
  notes        text,
  archived_at  timestamptz,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index campaigns_city_idx on campaigns (city);
create trigger campaigns_set_updated_at before update on campaigns for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- import_jobs — every upload is a job, with preview → confirm flow
-- ════════════════════════════════════════════════════════════════════════
create table import_jobs (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid references campaigns(id) on delete set null,
  uploaded_by        uuid references auth.users(id) on delete set null,
  file_name          text not null,
  file_storage_path  text,
  format_detected    text,                                  -- 'role_a' | 'role_b' | 'role_c' | 'role_d' | 'phone_list' | 'unknown'
  status             job_status not null default 'pending',

  total_rows         integer default 0,
  properties_created integer default 0,
  properties_updated integer default 0,
  contacts_created   integer default 0,
  contacts_updated   integer default 0,
  phones_created     integer default 0,
  leads_created      integer default 0,
  leads_updated      integer default 0,
  duplicates_seen    integer default 0,
  errors_count       integer default 0,

  preview_data       jsonb,                                 -- what would happen if confirmed (computed on parse)
  errors             jsonb default '[]'::jsonb,             -- [{ row, code, message }]
  raw_meta           jsonb default '{}'::jsonb,

  started_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index import_jobs_status_idx     on import_jobs (status);
create index import_jobs_campaign_idx   on import_jobs (campaign_id);
create index import_jobs_created_idx    on import_jobs (created_at desc);
create trigger import_jobs_set_updated_at before update on import_jobs for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- properties
-- ════════════════════════════════════════════════════════════════════════
create table properties (
  id                uuid primary key default gen_random_uuid(),
  address           text not null,
  city              text,                                   -- normalized via normalize_city()
  province          text default 'QC',
  postal_code       text,
  country           text default 'Canada',

  matricule         text,
  cadastre          text,
  arrondissement    text,
  year_built        integer,
  num_units         integer,
  lot_area_m2       numeric,
  building_area_m2  numeric,
  property_type     text,
  evaluation_total  numeric,
  evaluation_land   numeric,
  evaluation_bldg   numeric,
  evaluation_year   integer,
  lat               numeric,
  lng               numeric,

  source_import_job_id uuid references import_jobs(id) on delete set null,
  source_row_number    integer,
  raw_role_row         jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index properties_city_idx       on properties (city);
create index properties_matricule_idx  on properties (matricule) where matricule is not null;
create index properties_address_trgm   on properties using gin (address gin_trgm_ops);
create trigger properties_set_updated_at before update on properties for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- contacts (people, companies, trusts)
-- ════════════════════════════════════════════════════════════════════════
create table contacts (
  id                 uuid primary key default gen_random_uuid(),
  kind               contact_kind not null default 'unknown',

  first_name         text,
  last_name          text,
  full_name          text,                                   -- denormalized for search

  company_name       text,
  numbered_co_id     text,

  primary_email      text,
  primary_website    text,

  mailing_address    text,
  mailing_city       text,
  mailing_province   text default 'QC',
  mailing_postal     text,
  mailing_country    text default 'Canada',

  notes              text,
  source             text,
  source_meta        jsonb default '{}'::jsonb,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index contacts_full_name_trgm   on contacts using gin (full_name gin_trgm_ops);
create index contacts_company_trgm     on contacts using gin (company_name gin_trgm_ops);
create index contacts_email_idx        on contacts (primary_email) where primary_email is not null;
create trigger contacts_set_updated_at before update on contacts for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- property_contacts — owners, co-owners, brokers, managers, reps, family
-- ════════════════════════════════════════════════════════════════════════
create table property_contacts (
  property_id      uuid not null references properties(id) on delete cascade,
  contact_id       uuid not null references contacts(id) on delete cascade,
  relationship     relationship_kind not null,
  share_pct        numeric check (share_pct > 0 and share_pct <= 100),
  ownership_start  date,
  raw_role_data    jsonb,
  source_import_job_id uuid references import_jobs(id) on delete set null,
  created_at       timestamptz not null default now(),

  primary key (property_id, contact_id, relationship)
);
create index property_contacts_contact_idx on property_contacts (contact_id);
create index property_contacts_relationship_idx on property_contacts (relationship);

-- ════════════════════════════════════════════════════════════════════════
-- phones — first-class with status, source, confidence
-- ════════════════════════════════════════════════════════════════════════
create table phones (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid references contacts(id) on delete cascade,    -- nullable: orphan phone is allowed during enrichment
  e164            text not null,                                      -- '+15145551234' canonical
  display         text,                                               -- '(514) 555-1234' for UI
  status          phone_status not null default 'unverified',
  source          phone_source not null,
  confidence      smallint not null default 50 check (confidence between 0 and 100),
  evidence        text,
  source_column   text,
  source_import_job_id uuid references import_jobs(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- A phone is unique per contact; multiple contacts CAN share a phone (rare but legal — e.g. shared landline).
  unique (contact_id, e164)
);
create index phones_e164_idx       on phones (e164);
create index phones_contact_idx    on phones (contact_id);
create index phones_status_idx     on phones (status);
create trigger phones_set_updated_at before update on phones for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- leads
-- ════════════════════════════════════════════════════════════════════════
create table leads (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid references campaigns(id) on delete set null,
  property_id        uuid not null references properties(id) on delete cascade,
  contact_id         uuid not null references contacts(id) on delete cascade,

  status             lead_status not null default 'new',
  priority           smallint not null default 50 check (priority between 0 and 100),
  assigned_to        uuid references auth.users(id) on delete set null,

  source             text not null default 'role_import',
  source_import_job_id uuid references import_jobs(id) on delete set null,

  notes              text,
  last_contacted_at  timestamptz,
  next_action_at     timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (campaign_id, property_id, contact_id)
);
create index leads_status_idx     on leads (status);
create index leads_assigned_idx   on leads (assigned_to);
create index leads_campaign_idx   on leads (campaign_id);
create index leads_priority_idx   on leads (priority desc);
create trigger leads_set_updated_at before update on leads for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- lead_assignments — history (who had this lead when)
-- ════════════════════════════════════════════════════════════════════════
create table lead_assignments (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  assigned_to   uuid not null references auth.users(id) on delete cascade,
  assigned_by   uuid references auth.users(id) on delete set null,
  assigned_at   timestamptz not null default now(),
  unassigned_at timestamptz
);
create index lead_assignments_lead_idx on lead_assignments (lead_id);
create index lead_assignments_user_idx on lead_assignments (assigned_to);

-- ════════════════════════════════════════════════════════════════════════
-- call_logs
-- ════════════════════════════════════════════════════════════════════════
create table call_logs (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid references leads(id) on delete set null,
  contact_id        uuid references contacts(id) on delete set null,
  phone_id          uuid references phones(id) on delete set null,
  user_id           uuid references auth.users(id) on delete set null,

  twilio_call_sid   text unique,
  direction         text default 'outbound',
  duration_sec      integer,
  recording_url     text,
  transcript        text,
  summary           text,
  outcome           call_outcome,
  notes             text,

  recorded_at       timestamptz,
  raw               jsonb,
  created_at        timestamptz not null default now()
);
create index call_logs_lead_idx     on call_logs (lead_id);
create index call_logs_user_idx     on call_logs (user_id);
create index call_logs_outcome_idx  on call_logs (outcome);
create index call_logs_recorded_idx on call_logs (recorded_at desc);

-- ════════════════════════════════════════════════════════════════════════
-- lead_submissions — caller → Anthony "this seller is interesting"
-- ════════════════════════════════════════════════════════════════════════
create table lead_submissions (
  id                     uuid primary key default gen_random_uuid(),
  lead_id                uuid not null references leads(id) on delete cascade,
  call_log_id            uuid references call_logs(id) on delete set null,
  submitted_by           uuid not null references auth.users(id) on delete restrict,

  outcome                call_outcome not null,
  seller_interest_level  text check (seller_interest_level in ('cold','warm','hot','wants_offer')),
  timeline               text check (timeline in ('immediate','3_months','6_months','no_rush','unknown')),
  motivation             text,
  asking_price           numeric,
  property_info          text,
  condition_notes        text,
  objections             text,
  best_callback_time     text,
  caller_summary         text not null,
  recommended_action     text,

  status                 submission_status not null default 'pending',
  reviewed_by            uuid references auth.users(id) on delete set null,
  reviewed_at            timestamptz,
  review_notes           text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index lead_submissions_status_idx  on lead_submissions (status);
create index lead_submissions_lead_idx    on lead_submissions (lead_id);
create trigger lead_submissions_set_updated_at before update on lead_submissions for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- review_items — Anthony's inbox (denormalized + cross-source)
-- ════════════════════════════════════════════════════════════════════════
create table review_items (
  id              uuid primary key default gen_random_uuid(),
  source_kind     text not null check (source_kind in ('lead_submission','email_lead','command_clarification','research_complete','automation_failure','manual')),
  source_id       uuid,                                         -- fk varies by source_kind; loose for flexibility
  lead_id         uuid references leads(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  property_id     uuid references properties(id) on delete set null,

  title           text not null,
  summary         text,
  urgency         review_urgency not null default 'normal',
  status          review_status not null default 'open',

  resolved_by     uuid references auth.users(id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index review_items_status_idx on review_items (status);
create index review_items_urgency_idx on review_items (urgency);
create index review_items_created_idx on review_items (created_at desc);
create trigger review_items_set_updated_at before update on review_items for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- follow_ups
-- ════════════════════════════════════════════════════════════════════════
create table follow_ups (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid references leads(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete cascade,
  due_at          timestamptz not null,
  note            text,
  priority        smallint not null default 50 check (priority between 0 and 100),
  status          follow_up_status not null default 'pending',

  assigned_to     uuid references auth.users(id) on delete set null,
  created_by      uuid references auth.users(id) on delete set null,
  source          text,                                          -- 'manual'|'telegram'|'caller_submission'|'email'|'auto'

  gcal_event_id   text,
  gtask_id        text,
  last_synced_at  timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index follow_ups_due_idx       on follow_ups (due_at) where status = 'pending';
create index follow_ups_lead_idx      on follow_ups (lead_id);
create index follow_ups_assigned_idx  on follow_ups (assigned_to);
create trigger follow_ups_set_updated_at before update on follow_ups for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- automation_events — every n8n / telegram / system action logs here
-- ════════════════════════════════════════════════════════════════════════
create table automation_events (
  id                  uuid primary key default gen_random_uuid(),
  source              text not null check (source in ('n8n','telegram','email_triage','system','web_app','worker')),
  event_type          text not null,                            -- 'gmail_classified' | 'lead_created' | 'telegram_command' | ...
  status              text not null default 'success' check (status in ('started','success','failed','partial')),

  related_lead_id     uuid references leads(id) on delete set null,
  related_contact_id  uuid references contacts(id) on delete set null,
  related_property_id uuid references properties(id) on delete set null,
  related_import_id   uuid references import_jobs(id) on delete set null,

  payload             jsonb,
  result              jsonb,
  error_message       text,

  n8n_execution_id    text,
  telegram_message_id text,
  triggered_by        uuid references auth.users(id) on delete set null,

  occurred_at         timestamptz not null default now()
);
create index automation_events_occurred_idx on automation_events (occurred_at desc);
create index automation_events_source_idx   on automation_events (source);
create index automation_events_status_idx   on automation_events (status);
create index automation_events_lead_idx     on automation_events (related_lead_id);

-- ════════════════════════════════════════════════════════════════════════
-- proposed_actions — AI suggests; Anthony approves
-- ════════════════════════════════════════════════════════════════════════
create table proposed_actions (
  id                    uuid primary key default gen_random_uuid(),
  action_type           text not null,                          -- 'send_email'|'change_lead_stage'|'create_proposal'|'mark_dead'|'overwrite_field'
  target_table          text not null,
  target_id             uuid,
  proposed_change       jsonb not null,
  rationale             text,
  confidence            smallint check (confidence between 0 and 100),

  status                proposed_status not null default 'pending',
  source                text not null,                          -- 'n8n'|'telegram'|'system'
  reviewed_by           uuid references auth.users(id) on delete set null,
  reviewed_at           timestamptz,
  applied_at            timestamptz,
  applied_result        jsonb,

  created_at            timestamptz not null default now()
);
create index proposed_actions_status_idx on proposed_actions (status);

-- ════════════════════════════════════════════════════════════════════════
-- command_inbox — ambiguous Telegram commands awaiting clarification
-- ════════════════════════════════════════════════════════════════════════
create table command_inbox (
  id                   uuid primary key default gen_random_uuid(),
  source               text not null default 'telegram',
  raw_message          text not null,
  parsed_intent        text,
  candidates           jsonb,                                    -- e.g. [{lead_id, label, score}]
  status               text not null default 'open' check (status in ('open','resolved','cancelled')),
  resolved_via         text,
  resolved_at          timestamptz,
  telegram_user_id     text,
  telegram_message_id  text,
  created_at           timestamptz not null default now()
);
create index command_inbox_status_idx on command_inbox (status);

-- ════════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════════
alter table users_meta          enable row level security;
alter table campaigns           enable row level security;
alter table import_jobs         enable row level security;
alter table properties          enable row level security;
alter table contacts            enable row level security;
alter table property_contacts   enable row level security;
alter table phones              enable row level security;
alter table leads               enable row level security;
alter table lead_assignments    enable row level security;
alter table call_logs           enable row level security;
alter table lead_submissions    enable row level security;
alter table review_items        enable row level security;
alter table follow_ups          enable row level security;
alter table automation_events   enable row level security;
alter table proposed_actions    enable row level security;
alter table command_inbox       enable row level security;

-- Admin: full access everywhere.
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'users_meta','campaigns','import_jobs','properties','contacts',
      'property_contacts','phones','leads','lead_assignments','call_logs',
      'lead_submissions','review_items','follow_ups','automation_events',
      'proposed_actions','command_inbox'
    ])
  loop
    execute format(
      'create policy admin_all on %I for all to authenticated using (is_admin()) with check (is_admin())',
      t
    );
  end loop;
end $$;

-- Caller: limited reads (only their assigned leads + linked records).
create policy caller_select_own_leads on leads
  for select to authenticated
  using (not is_admin() and assigned_to = auth.uid());

create policy caller_select_properties on properties
  for select to authenticated
  using (
    not is_admin() and exists (
      select 1 from leads l where l.property_id = properties.id and l.assigned_to = auth.uid()
    )
  );

create policy caller_select_contacts on contacts
  for select to authenticated
  using (
    not is_admin() and exists (
      select 1 from leads l where l.contact_id = contacts.id and l.assigned_to = auth.uid()
    )
  );

create policy caller_select_phones on phones
  for select to authenticated
  using (
    not is_admin() and phones.contact_id is not null and exists (
      select 1 from leads l where l.contact_id = phones.contact_id and l.assigned_to = auth.uid()
    )
  );

-- Caller: can write their own call_logs + lead_submissions for assigned leads.
create policy caller_insert_call_logs on call_logs
  for insert to authenticated
  with check (
    user_id = auth.uid() and exists (
      select 1 from leads l where l.id = call_logs.lead_id and l.assigned_to = auth.uid()
    )
  );

create policy caller_select_call_logs on call_logs
  for select to authenticated
  using (not is_admin() and user_id = auth.uid());

create policy caller_insert_submissions on lead_submissions
  for insert to authenticated
  with check (
    submitted_by = auth.uid() and exists (
      select 1 from leads l where l.id = lead_submissions.lead_id and l.assigned_to = auth.uid()
    )
  );

create policy caller_select_own_submissions on lead_submissions
  for select to authenticated
  using (not is_admin() and submitted_by = auth.uid());

-- users_meta: a user can read+update their own row.
create policy users_meta_self on users_meta
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════════
-- Useful views
-- ════════════════════════════════════════════════════════════════════════

-- Leads enriched with property + contact + best phone for list views.
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
    (select ph.display from phones ph
       where ph.contact_id = ct.id and ph.status in ('unverified','valid')
       order by ph.confidence desc nulls last, ph.created_at asc limit 1) as best_phone,
    l.created_at,
    l.updated_at
  from leads l
  left join campaigns c on c.id = l.campaign_id
  join properties p on p.id = l.property_id
  join contacts ct on ct.id = l.contact_id;

-- Open review items count for Anthony's badge.
create view open_review_count as
  select count(*)::int as n from review_items where status = 'open';
