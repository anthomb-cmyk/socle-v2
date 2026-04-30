-- ════════════════════════════════════════════════════════════════════════
-- Add `source` + `source_meta` to properties for consistency with the rest
-- of the schema (contacts/leads/campaigns/follow_ups all have a source field).
-- ════════════════════════════════════════════════════════════════════════
-- Without this, every code path that inserts into properties with `source`
-- silently fails with PGRST204 — the seed/import/n8n routes were all set up
-- to record provenance.
--
-- Idempotent.

alter table properties
  add column if not exists source      text,
  add column if not exists source_meta jsonb default '{}'::jsonb;

create index if not exists properties_source_idx on properties (source) where source is not null;

comment on column properties.source      is 'Where the row came from: role_import, n8n, manual, dev_seed, etc. Useful for cleanup + audit.';
comment on column properties.source_meta is 'Free-form metadata about the source — file_name, gmail_message_id, telegram_message_id, etc.';
