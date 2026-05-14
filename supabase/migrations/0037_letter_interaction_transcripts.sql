-- 0037: Store inbound call transcripts and import metadata on letter interactions.

alter table public.letter_interactions
  add column if not exists source text not null default 'manual',
  add column if not exists transcript text,
  add column if not exists inbound_phone text,
  add column if not exists call_started_at timestamptz,
  add column if not exists raw jsonb not null default '{}'::jsonb;

comment on column public.letter_interactions.source is
  'manual | inbound_call | transcript_import';

create index if not exists letter_interactions_source_idx on public.letter_interactions(source);
create index if not exists letter_interactions_call_started_idx on public.letter_interactions(call_started_at desc) where call_started_at is not null;
