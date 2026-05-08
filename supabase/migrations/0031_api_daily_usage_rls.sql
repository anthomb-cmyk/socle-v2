ALTER TABLE api_daily_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON api_daily_usage FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
