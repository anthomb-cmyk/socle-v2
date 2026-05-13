-- 0034: Link investor deals to active acquisition pipeline deals
--
-- Investors can already track free-form opportunities and optionally link a
-- property. This adds a direct pointer to the canonical /pipeline deals table
-- so a capital partner can be tied to an active Socle acquisition deal.

alter table investor_deals
  add column if not exists pipeline_deal_id uuid references deals(id) on delete set null;

create index if not exists investor_deals_pipeline_deal_idx
  on investor_deals(pipeline_deal_id);

create unique index if not exists investor_deals_investor_pipeline_deal_unique_idx
  on investor_deals(investor_id, pipeline_deal_id)
  where pipeline_deal_id is not null;

comment on column investor_deals.pipeline_deal_id is
  'Optional link to an existing acquisition pipeline deal in deals.';
