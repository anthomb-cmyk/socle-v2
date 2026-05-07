CREATE TABLE twilio_lookup_log (
  id            uuid primary key default gen_random_uuid(),
  phone_e164    text not null,
  carrier_name  text,
  caller_type   text,
  line_type     text,
  cost_usd      numeric not null default 0.04,
  raw_response  jsonb,
  fetched_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '30 days'
);
CREATE INDEX twilio_lookup_log_phone_idx ON twilio_lookup_log(phone_e164);
CREATE INDEX twilio_lookup_log_expires_idx ON twilio_lookup_log(expires_at);
ALTER TABLE twilio_lookup_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='twilio_lookup_log' AND policyname='admin_all') THEN
    CREATE POLICY admin_all ON twilio_lookup_log FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
  END IF;
END $$;
