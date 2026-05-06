-- Migration 0016 — Import pipeline v3: structured mailing-address fields,
-- name-parser audit, and per-row import audits.
--
-- Purely additive. Existing rows keep their data; the v3 importer populates
-- the new columns from now on. The reparse-contacts backfill endpoint can
-- backfill existing contacts.

-- ── New contacts columns: structured mailing address ───────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS mailing_civic        text,
  ADD COLUMN IF NOT EXISTS mailing_street       text,
  ADD COLUMN IF NOT EXISTS mailing_unit         text,
  ADD COLUMN IF NOT EXISTS mailing_province     text,
  ADD COLUMN IF NOT EXISTS mailing_postal_fsa   text,
  ADD COLUMN IF NOT EXISTS mailing_parsed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS mailing_parse_quality text,
  -- Name-parser audit
  ADD COLUMN IF NOT EXISTS middle_names         text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS name_was_inverted    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS name_parse_quality   text;

CREATE INDEX IF NOT EXISTS contacts_mailing_parse_quality_idx
  ON contacts(mailing_parse_quality)
  WHERE mailing_parse_quality IS NOT NULL;

CREATE INDEX IF NOT EXISTS contacts_mailing_postal_fsa_idx
  ON contacts(mailing_postal_fsa)
  WHERE mailing_postal_fsa IS NOT NULL;

CREATE INDEX IF NOT EXISTS contacts_inverted_names_idx
  ON contacts(name_was_inverted)
  WHERE name_was_inverted = true;

-- ── Per-row import audit table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_row_audits (
  id              uuid primary key default gen_random_uuid(),
  import_job_id   uuid not null references import_jobs(id) on delete cascade,
  row_number      int not null,
  outcome         text not null check (outcome in ('imported_clean', 'imported_with_warnings', 'blocked', 'error')),
  blocking        jsonb not null default '[]'::jsonb,
  warnings        jsonb not null default '[]'::jsonb,
  owners          jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS import_row_audits_job_idx ON import_row_audits(import_job_id, row_number);
CREATE INDEX IF NOT EXISTS import_row_audits_outcome_idx ON import_row_audits(outcome);

ALTER TABLE import_row_audits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='import_row_audits' AND policyname='admin_all'
  ) THEN
    CREATE POLICY admin_all ON import_row_audits FOR ALL TO authenticated
      USING (is_admin()) WITH CHECK (is_admin());
  END IF;
END $$;

COMMENT ON TABLE import_row_audits IS 'Per-row diagnostics emitted by the v3 import validator. One row per imported (or blocked) source row.';
COMMENT ON COLUMN contacts.mailing_parse_quality IS 'v3: complete | missing_civic | missing_street | missing_postal | incoherent_city | unparseable';
COMMENT ON COLUMN contacts.name_parse_quality IS 'v3: complete | inverted_corrected | middle_moved | ambiguous | single_token | company | unparseable';
