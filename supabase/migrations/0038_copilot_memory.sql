-- 0038: Persistent per-user Copilot memory.
--
-- Stores short, durable preferences and facts the Copilot has learned about
-- the user (workflow quirks, name preferences, ongoing constraints). Loaded
-- into the system prompt on every Copilot turn.

create table if not exists public.copilot_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 400),
  kind text not null default 'preference'
    check (kind in ('preference', 'fact', 'workflow', 'constraint')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists copilot_memory_user_idx
  on public.copilot_memory(user_id, updated_at desc);

alter table public.copilot_memory enable row level security;

-- Users see and manage their own memory rows. The admin client used by the
-- Copilot route bypasses RLS, so it can read+write on the user's behalf.
drop policy if exists copilot_memory_self_select on public.copilot_memory;
create policy copilot_memory_self_select on public.copilot_memory
  for select using (auth.uid() = user_id);

drop policy if exists copilot_memory_self_modify on public.copilot_memory;
create policy copilot_memory_self_modify on public.copilot_memory
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
