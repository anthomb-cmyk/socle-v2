-- Migration 0017 — LLM cost tracking + per-lead briefings.
--
-- 1. llm_usage_log: every Anthropic API call is logged here. Powers the
--    /admin/costs page. Append-only; never updated.
-- 2. leads.briefing_text + briefing_generated_at: pre-generated briefing
--    cards rendered at the top of the lead/calls page.

-- ── llm_usage_log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_usage_log (
  id              uuid primary key default gen_random_uuid(),
  feature         text not null,             -- e.g. 'g6_haiku_validation', 'briefing'
  model           text not null,             -- e.g. 'claude-haiku-4-5'
  input_tokens    int  not null default 0,
  output_tokens   int  not null default 0,
  cost_usd        numeric(10, 6) not null default 0,
  latency_ms      int  not null default 0,
  success         boolean not null default true,
  http_status     int  not null default 0,
  error_message   text,
  lead_id         uuid references leads(id) on delete set null,
  candidate_id    uuid references phone_candidates(id) on delete set null,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS llm_usage_log_created_at_idx ON llm_usage_log(created_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_log_feature_idx    ON llm_usage_log(feature, created_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_log_model_idx      ON llm_usage_log(model, created_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_log_lead_idx       ON llm_usage_log(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS llm_usage_log_success_idx    ON llm_usage_log(success, created_at DESC);

ALTER TABLE llm_usage_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='llm_usage_log' AND policyname='admin_all') THEN
    CREATE POLICY admin_all ON llm_usage_log FOR ALL TO authenticated
      USING (is_admin()) WITH CHECK (is_admin());
  END IF;
END $$;

COMMENT ON TABLE llm_usage_log IS 'Append-only log of every Anthropic API call. Powers /admin/costs.';

-- ── leads.briefing_text ────────────────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS briefing_text         text,
  ADD COLUMN IF NOT EXISTS briefing_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS briefing_metadata     jsonb;

CREATE INDEX IF NOT EXISTS leads_briefing_generated_at_idx
  ON leads(briefing_generated_at)
  WHERE briefing_generated_at IS NOT NULL;

COMMENT ON COLUMN leads.briefing_text IS 'AI-generated context briefing shown at the top of the lead page.';
COMMENT ON COLUMN leads.briefing_generated_at IS 'When the briefing was last generated. Null = never generated. Stale > 14 days = re-generate on next view.';
