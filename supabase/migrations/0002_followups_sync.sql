-- ════════════════════════════════════════════════════════════════════════
-- Add Google Calendar / Google Tasks sync fields to follow_ups
-- ════════════════════════════════════════════════════════════════════════
-- 0001_init already has: gcal_event_id, gtask_id, last_synced_at.
-- This migration adds the missing IDs that n8n needs to round-trip a sync,
-- plus a status enum + error message column for visibility.

alter table follow_ups
  add column if not exists gtask_list_id   text,
  add column if not exists gcal_calendar_id text,
  add column if not exists sync_status     text default 'unsynced'
    check (sync_status in ('unsynced','syncing','synced','error','disabled')),
  add column if not exists sync_error      text,
  add column if not exists sync_target     text default 'none'
    check (sync_target in ('none','gcal','gtask','both'));

create index if not exists follow_ups_sync_idx
  on follow_ups (sync_status)
  where sync_status in ('syncing', 'error');

comment on column follow_ups.gtask_list_id    is 'Google Tasks task list ID. Returned by n8n after first sync.';
comment on column follow_ups.gcal_calendar_id is 'Google Calendar calendar ID (default: "primary").';
comment on column follow_ups.sync_status      is 'unsynced → syncing → synced; error if a sync attempt failed.';
comment on column follow_ups.sync_error       is 'Last sync error message (cleared on next successful sync).';
comment on column follow_ups.sync_target      is 'Which external system(s) this follow-up should sync to.';
