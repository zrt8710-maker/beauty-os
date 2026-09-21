-- Provisional, product-level research only. This table is deliberately not
-- user-asset state and does not publish any Product Knowledge.
create table public.catalog_product_research_drafts (
  id uuid primary key default gen_random_uuid(),
  catalog_product_id uuid not null references public.catalog_products (id) on delete cascade,
  research_version integer not null check (research_version > 0),
  status text not null default 'draft' check (
    status in ('draft', 'review_pending', 'approved', 'rejected', 'superseded')
  ),
  research_payload jsonb not null check (jsonb_typeof(research_payload) = 'object'),
  overall_confidence smallint check (overall_confidence is null or overall_confidence between 0 and 100),
  created_by text not null check (created_by in ('ai', 'admin', 'system')),
  research_model text check (research_model is null or char_length(research_model) between 1 and 200),
  research_run_id text check (research_run_id is null or char_length(research_run_id) between 1 and 200),
  reviewed_by uuid references public.profiles (user_id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (catalog_product_id, research_version),
  check (
    (reviewed_by is null and reviewed_at is null)
    or (reviewed_by is not null and reviewed_at is not null)
  )
);

create index catalog_product_research_drafts_product_created_idx
  on public.catalog_product_research_drafts (catalog_product_id, created_at desc);

create index catalog_product_research_drafts_status_created_idx
  on public.catalog_product_research_drafts (status, created_at desc);

alter table public.catalog_product_research_drafts enable row level security;

revoke all on table public.catalog_product_research_drafts
  from public, anon, authenticated;
grant select, insert, update, delete on table public.catalog_product_research_drafts
  to service_role;

create policy "catalog_product_research_drafts_service_role_only"
on public.catalog_product_research_drafts
for all to service_role
using (true)
with check (true);
