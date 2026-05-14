-- 0036: Letter campaigns / inbound lookup
-- Tracks direct-mail rounds, recipients, their property portfolios, and
-- callback outcomes. Built for fast typo-tolerant lookup when a seller calls.

create table if not exists letter_campaigns (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  city            text,
  source_file     text,
  mailed_at       date,
  letter_template text,
  notes           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists letter_campaigns_created_idx on letter_campaigns(created_at desc);

create table if not exists letter_recipients (
  id                    uuid primary key default gen_random_uuid(),
  campaign_id           uuid not null references letter_campaigns(id) on delete cascade,
  owner_key             text not null,
  owner_name            text not null,
  original_owner_name   text,
  company_name          text,
  mailing_address       text,
  mailing_city          text,
  mailing_province      text default 'QC',
  mailing_postal        text,
  phone_display         text,
  bucket                text not null default 'unknown',
  property_count        integer not null default 0,
  total_units           integer,
  status                text not null default 'sent',
  last_outcome          text,
  last_interaction_at   timestamptz,
  search_blob           text,
  raw                   jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (campaign_id, owner_key)
);

comment on column letter_recipients.status is
  'sent | called_back | interested | maybe_later | not_interested | wrong_person | bad_address | do_not_contact | deal_created';

create index if not exists letter_recipients_campaign_idx on letter_recipients(campaign_id);
create index if not exists letter_recipients_status_idx on letter_recipients(status);
create index if not exists letter_recipients_owner_trgm on letter_recipients using gin (owner_name gin_trgm_ops);
create index if not exists letter_recipients_mail_trgm on letter_recipients using gin (mailing_address gin_trgm_ops);
create index if not exists letter_recipients_search_trgm on letter_recipients using gin (search_blob gin_trgm_ops);

create table if not exists letter_recipient_properties (
  id                uuid primary key default gen_random_uuid(),
  recipient_id      uuid not null references letter_recipients(id) on delete cascade,
  matricule         text,
  address           text not null,
  city              text,
  postal_code       text,
  num_units         integer,
  cadastre          text,
  property_type     text,
  evaluation_total  numeric,
  raw               jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists letter_recipient_properties_recipient_idx on letter_recipient_properties(recipient_id);
create index if not exists letter_recipient_properties_matricule_idx on letter_recipient_properties(matricule) where matricule is not null;
create index if not exists letter_recipient_properties_address_trgm on letter_recipient_properties using gin (address gin_trgm_ops);

create table if not exists letter_interactions (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references letter_recipients(id) on delete cascade,
  outcome       text not null,
  notes         text,
  next_action   text,
  follow_up_at  timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists letter_interactions_recipient_idx on letter_interactions(recipient_id);
create index if not exists letter_interactions_outcome_idx on letter_interactions(outcome);
create index if not exists letter_interactions_created_idx on letter_interactions(created_at desc);

create or replace function public.set_letter_recipient_search_blob()
returns trigger language plpgsql as $$
begin
  new.search_blob = concat_ws(' ',
    new.owner_name,
    new.original_owner_name,
    new.company_name,
    new.mailing_address,
    new.mailing_city,
    new.mailing_postal,
    new.phone_display,
    new.owner_key
  );
  return new;
end;
$$;

drop trigger if exists letter_recipients_search_blob on letter_recipients;
create trigger letter_recipients_search_blob
before insert or update on letter_recipients
for each row execute function public.set_letter_recipient_search_blob();

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists letter_campaigns_set_updated_at on letter_campaigns;
drop trigger if exists letter_recipients_set_updated_at on letter_recipients;
create trigger letter_campaigns_set_updated_at before update on letter_campaigns for each row execute function public.set_updated_at();
create trigger letter_recipients_set_updated_at before update on letter_recipients for each row execute function public.set_updated_at();

create or replace function public.search_letter_recipients(
  p_query text,
  p_campaign_id uuid default null,
  p_limit integer default 25
)
returns table (
  recipient_id uuid,
  campaign_id uuid,
  owner_name text,
  original_owner_name text,
  company_name text,
  mailing_address text,
  mailing_city text,
  mailing_postal text,
  phone_display text,
  bucket text,
  property_count integer,
  total_units integer,
  status text,
  last_outcome text,
  last_interaction_at timestamptz,
  score real
)
language sql stable as $$
  with q as (
    select trim(coalesce(p_query, '')) as text
  )
  select
    r.id,
    r.campaign_id,
    r.owner_name,
    r.original_owner_name,
    r.company_name,
    r.mailing_address,
    r.mailing_city,
    r.mailing_postal,
    r.phone_display,
    r.bucket,
    r.property_count,
    r.total_units,
    r.status,
    r.last_outcome,
    r.last_interaction_at,
    greatest(
      similarity(coalesce(r.owner_name, ''), q.text),
      similarity(coalesce(r.original_owner_name, ''), q.text),
      similarity(coalesce(r.company_name, ''), q.text),
      similarity(coalesce(r.mailing_address, ''), q.text),
      similarity(coalesce(r.search_blob, ''), q.text)
    )::real as score
  from letter_recipients r, q
  where (p_campaign_id is null or r.campaign_id = p_campaign_id)
    and (
      q.text = ''
      or r.search_blob ilike '%' || q.text || '%'
      or r.search_blob % q.text
      or exists (
        select 1
        from letter_recipient_properties p
        where p.recipient_id = r.id
          and (
            p.address ilike '%' || q.text || '%'
            or p.matricule ilike '%' || q.text || '%'
            or p.address % q.text
          )
      )
    )
  order by
    case when q.text = '' then r.last_interaction_at end desc nulls last,
    score desc,
    r.property_count desc,
    r.owner_name asc
  limit least(greatest(p_limit, 1), 100);
$$;

alter table letter_campaigns enable row level security;
alter table letter_recipients enable row level security;
alter table letter_recipient_properties enable row level security;
alter table letter_interactions enable row level security;

drop policy if exists letter_campaigns_admin_all on letter_campaigns;
drop policy if exists letter_recipients_admin_all on letter_recipients;
drop policy if exists letter_recipient_properties_admin_all on letter_recipient_properties;
drop policy if exists letter_interactions_admin_all on letter_interactions;

create policy letter_campaigns_admin_all on letter_campaigns
  for all using (coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin')
  with check (coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin');

create policy letter_recipients_admin_all on letter_recipients
  for all using (coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin')
  with check (coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin');

create policy letter_recipient_properties_admin_all on letter_recipient_properties
  for all using (coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin')
  with check (coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin');

create policy letter_interactions_admin_all on letter_interactions
  for all using (coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin')
  with check (coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), 'caller') = 'admin');
