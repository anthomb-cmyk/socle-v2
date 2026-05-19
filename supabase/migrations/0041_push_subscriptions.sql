create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time bigint,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions(user_id);

drop trigger if exists push_subscriptions_set_updated_at on public.push_subscriptions;
create trigger push_subscriptions_set_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

drop policy if exists "push subscriptions own select" on public.push_subscriptions;
create policy "push subscriptions own select"
  on public.push_subscriptions
  for select
  using (auth.uid() = user_id);

drop policy if exists "push subscriptions own insert" on public.push_subscriptions;
create policy "push subscriptions own insert"
  on public.push_subscriptions
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "push subscriptions own update" on public.push_subscriptions;
create policy "push subscriptions own update"
  on public.push_subscriptions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "push subscriptions own delete" on public.push_subscriptions;
create policy "push subscriptions own delete"
  on public.push_subscriptions
  for delete
  using (auth.uid() = user_id);
