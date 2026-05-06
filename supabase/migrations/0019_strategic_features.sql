-- 0019: address-pattern learning + lead fit scoring + multi-property detection

CREATE TABLE IF NOT EXISTS address_parse_corrections (
  id              uuid primary key default gen_random_uuid(),
  raw_input       text not null,
  parser_output   jsonb,           -- what the deterministic parser produced (often partial/null)
  llm_output      jsonb not null,  -- what Haiku returned
  contact_id      uuid references contacts(id) on delete set null,
  created_at      timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS address_parse_corrections_created_at_idx ON address_parse_corrections(created_at DESC);
ALTER TABLE address_parse_corrections ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='address_parse_corrections' AND policyname='admin_all') THEN
    CREATE POLICY admin_all ON address_parse_corrections FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
  END IF;
END $$;

-- Lead fit scoring (#8)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS fit_score        smallint,
  ADD COLUMN IF NOT EXISTS fit_reasoning    text,
  ADD COLUMN IF NOT EXISTS fit_scored_at    timestamptz;
CREATE INDEX IF NOT EXISTS leads_fit_score_idx ON leads(fit_score DESC) WHERE fit_score IS NOT NULL;

-- Multi-property owner detection (#9)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS property_count       int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_portfolio_owner   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS portfolio_updated_at timestamptz;
CREATE INDEX IF NOT EXISTS contacts_portfolio_idx ON contacts(is_portfolio_owner) WHERE is_portfolio_owner = true;
