-- 0013: Deals pipeline
-- Qualified acquisition opportunities Anthony actively pursues.
-- Stages: prospection → analyse → offre → due_diligence → financement → cloture / abandonne

create table if not exists deals (
  id            uuid    primary key default gen_random_uuid(),
  v1_id         text    unique,                              -- migration ref from V1 socle_crm_state
  title         text    not null,
  stage         text    not null default 'prospection',      -- see comment below
  address       text,
  units         integer,
  asking_price  bigint,                                      -- CAD, cents-free (e.g. 1100000 = $1.1M)
  offer_price   bigint,
  temperature   text    not null default 'tiede',            -- froid | tiede | chaud
  priority      text    not null default 'medium',           -- low | medium | high
  contact_name  text,
  contact_phone text,
  contact_email text,
  notes_deal    text,
  notes_vendeur text,
  ai_analysis   text,
  next_action   text,
  checklists    jsonb   not null default '{}',               -- {stage: [{id,label,done}]}
  activities    jsonb   not null default '[]',               -- [{id,text,time}]
  lat           numeric,
  lng           numeric,
  assigned_to   uuid    references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table deals is 'Deal pipeline — qualified acquisition opportunities.';
comment on column deals.stage is 'prospection | analyse | offre | due_diligence | financement | cloture | abandonne';
comment on column deals.temperature is 'froid | tiede | chaud';
comment on column deals.checklists is 'JSONB map of stage → [{id, label, done}]';

create table if not exists deal_documents (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references deals(id) on delete cascade,
  name         text not null,
  size         integer,
  mime_type    text,
  storage_path text,                                         -- Supabase Storage path (future)
  uploaded_by  uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

comment on table deal_documents is 'Documents attached to a deal (inspection reports, offers, leases, etc.)';

create index if not exists deals_stage_idx        on deals(stage);
create index if not exists deals_updated_at_idx   on deals(updated_at desc);
create index if not exists deal_docs_deal_id_idx  on deal_documents(deal_id);
