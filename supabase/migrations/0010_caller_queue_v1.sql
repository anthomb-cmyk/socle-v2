-- ════════════════════════════════════════════════════════════════════════
-- 0010 · Caller Queue V1
-- Adds:
--   • call_back_later value on call_outcome enum
--   • call_locks table — one lock per lead, 30-min TTL
-- ════════════════════════════════════════════════════════════════════════

-- 1. New outcome: caller asked to be called back at a specific time
ALTER TYPE call_outcome ADD VALUE IF NOT EXISTS 'call_back_later';

-- 2. Call locks — prevent two callers from working the same lead simultaneously.
--    One row per lead; locked_by is the caller who opened the call workspace.
--    expires_at is checked by /api/calls/next to skip "in use" leads.
--    Rows are cleaned up when a call is logged or on expiry.
create table if not exists call_locks (
  id          uuid        primary key default gen_random_uuid(),
  lead_id     uuid        not null references leads(id) on delete cascade,
  locked_by   uuid        not null references auth.users(id) on delete cascade,
  locked_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  constraint call_locks_lead_id_key unique (lead_id)
);

create index if not exists call_locks_expires_idx  on call_locks(expires_at);
create index if not exists call_locks_locked_by_idx on call_locks(locked_by);

-- RLS
alter table call_locks enable row level security;

-- Callers can see/upsert/delete their own lock rows.
-- Admins can read all (for the admin workload view).
create policy "caller_own_locks" on call_locks
  for all
  using (locked_by = auth.uid() or is_admin())
  with check (locked_by = auth.uid());
