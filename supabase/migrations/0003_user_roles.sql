-- ════════════════════════════════════════════════════════════════════════
-- Widen users_meta.role to support the full role taxonomy.
-- Add is_active flag + email mirror so /admin/users doesn't need to
-- round-trip through auth.users for every render.
-- ════════════════════════════════════════════════════════════════════════
-- Roles:
--   admin              — full access (only role currently elevated by RLS)
--   manager            — can view all data, manage callers; future RLS work
--   cold_caller        — same as legacy 'caller'; works the queue
--   caller             — legacy alias for cold_caller (kept for compat)
--   research_assistant — handles enrichment / research jobs (read-only on leads)
--   viewer             — read-only across the system
-- Only `admin` is currently elevated. Other roles all fall back to the
-- caller-style RLS policies. Specialization happens in a later migration.
--
-- This migration is idempotent.

alter table users_meta drop constraint if exists users_meta_role_check;
alter table users_meta add constraint users_meta_role_check
  check (role in ('admin', 'manager', 'caller', 'cold_caller', 'research_assistant', 'viewer'));

alter table users_meta
  add column if not exists is_active boolean not null default true,
  add column if not exists email text;

create index if not exists users_meta_role_idx on users_meta (role);
create index if not exists users_meta_active_idx on users_meta (is_active) where is_active = false;

comment on column users_meta.is_active is 'Soft-deactivate a user without deleting their auth row.';
comment on column users_meta.email     is 'Mirror of auth.users.email — kept fresh on /admin/users edits. Rarely changes.';
