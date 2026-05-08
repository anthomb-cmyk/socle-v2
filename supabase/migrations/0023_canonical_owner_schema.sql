CREATE EXTENSION IF NOT EXISTS postgis;

-- Provenance floor: immutable raw rows from rôle imports
CREATE TABLE raw_property (
  id                uuid primary key default gen_random_uuid(),
  matricule         text not null,
  source_file_hash  text not null,
  source_import_job_id uuid references import_jobs(id) on delete set null,
  raw_row           jsonb not null,
  imported_at       timestamptz not null default now(),
  unique(matricule, source_file_hash)
);
CREATE INDEX raw_property_matricule_idx ON raw_property(matricule);

-- Deduped owner — the unit of work
CREATE TABLE canonical_owner (
  owner_id          uuid primary key default gen_random_uuid(),
  owner_type        text not null check (owner_type in ('individual', 'numbered_co', 'named_co', 'trust', 'government')),
  canonical_name    text not null,
  canonical_name_normalized text not null,
  neq               text,
  mailing_address_raw text,
  mailing_geocode   geography(Point, 4326),
  mailing_postal_fsa text,
  dedupe_status     text not null default 'auto' check (dedupe_status in ('auto', 'human_confirmed', 'pending_review')),
  is_aggregator_address boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
CREATE INDEX canonical_owner_normalized_idx ON canonical_owner(canonical_name_normalized);
CREATE INDEX canonical_owner_neq_idx ON canonical_owner(neq) where neq is not null;
CREATE INDEX canonical_owner_geocode_idx ON canonical_owner USING gist(mailing_geocode);
CREATE INDEX canonical_owner_postal_fsa_idx ON canonical_owner(mailing_postal_fsa);

CREATE TABLE owner_alias (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references canonical_owner(owner_id) on delete cascade,
  alias_name        text not null,
  alias_name_normalized text not null,
  source            text not null,
  first_seen_at     timestamptz not null default now()
);
CREATE INDEX owner_alias_normalized_idx ON owner_alias(alias_name_normalized);
CREATE INDEX owner_alias_owner_idx ON owner_alias(owner_id);

CREATE TABLE evidence (
  evidence_id       uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references canonical_owner(owner_id) on delete cascade,
  source            text not null,
  source_url        text,
  query_text        text,
  fetched_at        timestamptz not null default now(),
  raw_response      jsonb,
  structured        jsonb not null,
  weight_at_fetch   numeric not null default 1.0
);
CREATE INDEX evidence_owner_idx ON evidence(owner_id);
CREATE INDEX evidence_source_idx ON evidence(source);
CREATE INDEX evidence_fetched_at_idx ON evidence(fetched_at desc);

CREATE TABLE hypothesis (
  hypothesis_id     uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references canonical_owner(owner_id) on delete cascade,
  claim_type        text not null check (claim_type in ('phone', 'email', 'address')),
  claim_value       text not null,
  claim_value_e164  text,
  tier              text not null check (tier in ('A', 'B', 'C', 'D', 'E')),
  confidence_label  text not null check (confidence_label in ('confirmed', 'likely', 'connected', 'weak')),
  is_direct         boolean not null,
  status            text not null default 'candidate' check (status in ('candidate', 'accepted', 'rejected', 'superseded')),
  status_reason     text,
  evidence_ids      uuid[] not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
CREATE INDEX hypothesis_owner_idx ON hypothesis(owner_id);
CREATE INDEX hypothesis_status_idx ON hypothesis(status);

CREATE TABLE owner_record (
  record_id         uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references canonical_owner(owner_id) on delete cascade,
  snapshot_hash     text not null,
  primary_phone_e164 text,
  primary_phone_tier text,
  primary_phone_label text,
  primary_phone_is_direct boolean,
  alternate_phones  jsonb,
  briefing_text     text,
  whats_interesting text,
  property_matricules text[],
  audit_url         text,
  research_completed_at timestamptz not null default now(),
  published_to_crm  boolean not null default false,
  published_at      timestamptz,
  unique(owner_id, snapshot_hash)
);
CREATE INDEX owner_record_owner_idx ON owner_record(owner_id);
CREATE INDEX owner_record_published_idx ON owner_record(published_at desc nulls last);

CREATE TABLE owner_refresh_schedule (
  owner_id          uuid primary key references canonical_owner(owner_id) on delete cascade,
  last_researched_at timestamptz not null,
  next_research_at  timestamptz not null,
  current_tier      text,
  status            text not null default 'active' check (status in ('active', 'paused', 'do_not_research'))
);
CREATE INDEX owner_refresh_next_idx ON owner_refresh_schedule(next_research_at) where status = 'active';

CREATE TABLE phone_call_outcome (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid references canonical_owner(owner_id) on delete cascade,
  hypothesis_id     uuid references hypothesis(hypothesis_id) on delete cascade,
  phone_e164        text not null,
  outcome           text not null check (outcome in ('correct', 'wrong_number', 'voicemail', 'no_answer', 'do_not_contact')),
  caller_id         uuid references auth.users(id),
  notes             text,
  recorded_at       timestamptz not null default now()
);
CREATE INDEX phone_call_outcome_owner_idx ON phone_call_outcome(owner_id);

ALTER TABLE raw_property ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_owner ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE hypothesis ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_refresh_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_call_outcome ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='canonical_owner' AND policyname='admin_all') THEN
    CREATE POLICY admin_all ON raw_property FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON canonical_owner FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON owner_alias FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON evidence FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON hypothesis FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON owner_record FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON owner_refresh_schedule FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON phone_call_outcome FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
  END IF;
END $$;
