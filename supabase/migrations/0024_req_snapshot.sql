CREATE TABLE req_entities (
  neq                  text primary key,
  legal_name           text not null,
  legal_name_normalized text not null,
  juridical_form       text,
  status               text,
  status_date          date,
  registered_address_raw text,
  mailing_address_raw  text,
  registered_geocode   geography(Point, 4326),
  mailing_geocode      geography(Point, 4326),
  postal_fsa           text,
  registered_phone     text,
  activity_codes       text[],
  imported_at          timestamptz not null default now()
);
CREATE INDEX req_entities_legal_name_normalized_idx ON req_entities(legal_name_normalized);
CREATE INDEX req_entities_postal_fsa_idx ON req_entities(postal_fsa);
CREATE INDEX req_entities_mailing_geocode_idx ON req_entities USING gist(mailing_geocode);
CREATE INDEX req_entities_registered_geocode_idx ON req_entities USING gist(registered_geocode);

CREATE TABLE req_directors (
  id            uuid primary key default gen_random_uuid(),
  neq           text not null references req_entities(neq) on delete cascade,
  full_name     text not null,
  full_name_normalized text not null,
  surname       text not null,
  given_name    text,
  role          text,
  start_date    date,
  end_date      date
);
CREATE INDEX req_directors_full_name_idx ON req_directors(full_name_normalized);
CREATE INDEX req_directors_surname_idx ON req_directors(surname);
CREATE INDEX req_directors_neq_idx ON req_directors(neq);

CREATE TABLE req_snapshot_meta (
  id                serial primary key,
  imported_at       timestamptz not null default now(),
  source_file       text not null,
  source_date       date,
  entity_count      integer not null,
  director_count    integer not null
);

ALTER TABLE req_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE req_directors ENABLE ROW LEVEL SECURITY;
ALTER TABLE req_snapshot_meta ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='req_entities' AND policyname='admin_all') THEN
    CREATE POLICY admin_all ON req_entities FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON req_directors FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY admin_all ON req_snapshot_meta FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
  END IF;
END $$;
