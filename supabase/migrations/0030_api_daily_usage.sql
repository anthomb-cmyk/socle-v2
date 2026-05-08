-- 0030_api_daily_usage.sql — daily API usage counters for rate caps.
--
-- One row per (date, key). Used by rate-limits.ts to atomically increment
-- counters for external API calls (Twilio Lookup, Brave Search, etc.).

create table if not exists api_daily_usage (
  date date not null,
  key text not null,
  count int not null default 0,
  primary key (date, key)
);

create index if not exists api_daily_usage_date_idx on api_daily_usage(date);

-- Atomic increment helper: bumps today's counter and returns the new count.
create or replace function increment_api_daily_usage(p_key text)
returns int
language plpgsql
as $$
declare
  new_count int;
begin
  insert into api_daily_usage(date, key, count)
  values (current_date, p_key, 1)
  on conflict (date, key) do update
    set count = api_daily_usage.count + 1
  returning count into new_count;
  return new_count;
end;
$$;
