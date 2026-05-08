CREATE TABLE req_entity_alias (
  id              uuid primary key default gen_random_uuid(),
  neq             text not null references req_entities(neq) on delete cascade,
  alias_name      text not null,
  alias_name_normalized text not null,
  alias_type      text,
  start_date      date,
  end_date        date
);
CREATE INDEX req_entity_alias_normalized_idx ON req_entity_alias(alias_name_normalized);
CREATE INDEX req_entity_alias_neq_idx ON req_entity_alias(neq);
ALTER TABLE req_entity_alias ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='req_entity_alias' AND policyname='admin_all') THEN
    CREATE POLICY admin_all ON req_entity_alias FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
  END IF;
END $$;
