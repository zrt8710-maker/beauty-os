create table public.capabilities (
  code text primary key check (
    code in ('hydration', 'barrier_support', 'soothing', 'oil_balance', 'sun_protection')
  ),
  display_name text not null check (char_length(display_name) between 1 and 80),
  definition text not null check (char_length(definition) between 1 and 1000),
  definition_version smallint not null default 1 check (definition_version > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.capabilities (code, display_name, definition)
values
  ('hydration', '补水', '帮助皮肤补充或维持水分，改善暂时性缺水状态。'),
  ('barrier_support', '屏障支持', '帮助维持或支持皮肤屏障，减少水分流失并提升屏障稳定性。'),
  ('soothing', '舒缓', '帮助缓解暂时性不适、紧绷或泛红感。'),
  ('oil_balance', '油脂平衡', '帮助管理皮肤表面油脂，降低过度油光而不过度剥脱。'),
  ('sun_protection', '防晒', '通过明确的防晒用途帮助降低紫外线暴露对皮肤的影响。');

create table public.catalog_product_capabilities (
  id uuid primary key default gen_random_uuid(),
  catalog_product_id uuid not null references public.catalog_products (id) on delete cascade,
  capability_code text not null references public.capabilities (code) on update cascade on delete restrict,
  status text not null check (status in ('verified', 'candidate', 'unknown')),
  confidence smallint check (confidence is null or confidence between 0 and 100),
  assessment_note text check (assessment_note is null or char_length(assessment_note) between 1 and 2000),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (catalog_product_id, capability_code),
  check (status <> 'verified' or confidence is not null)
);

create index catalog_product_capabilities_product_status_idx
on public.catalog_product_capabilities (catalog_product_id, status);

create table public.product_capability_evidence (
  id uuid primary key default gen_random_uuid(),
  product_capability_id uuid not null references public.catalog_product_capabilities (id) on delete cascade,
  evidence_type text not null check (
    evidence_type in ('official_product_description', 'manual_curation', 'external_dataset')
  ),
  direction text not null check (direction in ('supports', 'contradicts')),
  evidence_note text not null check (char_length(evidence_note) between 1 and 2000),
  source_locator text check (source_locator is null or char_length(source_locator) between 1 and 2000),
  confidence smallint check (confidence is null or confidence between 0 and 100),
  review_status text not null default 'candidate' check (
    review_status in ('verified', 'candidate', 'rejected')
  ),
  created_at timestamptz not null default now()
);

create index product_capability_evidence_capability_review_idx
on public.product_capability_evidence (product_capability_id, review_status);

alter table public.capabilities enable row level security;
alter table public.catalog_product_capabilities enable row level security;
alter table public.product_capability_evidence enable row level security;

revoke all on table public.capabilities from anon, authenticated;
revoke all on table public.catalog_product_capabilities from anon, authenticated;
revoke all on table public.product_capability_evidence from anon, authenticated;

grant select on table public.capabilities, public.catalog_product_capabilities, public.product_capability_evidence to authenticated;

create policy "capabilities_select_active"
on public.capabilities for select to authenticated
using (is_active = true);

create policy "catalog_product_capabilities_select_verified_catalog"
on public.catalog_product_capabilities for select to authenticated
using (
  exists (
    select 1
    from public.catalog_products
    where catalog_products.id = catalog_product_capabilities.catalog_product_id
      and catalog_products.status = 'verified'
  )
);

create policy "product_capability_evidence_select_verified_catalog"
on public.product_capability_evidence for select to authenticated
using (
  exists (
    select 1
    from public.catalog_product_capabilities
    join public.catalog_products
      on catalog_products.id = catalog_product_capabilities.catalog_product_id
    where catalog_product_capabilities.id = product_capability_evidence.product_capability_id
      and catalog_products.status = 'verified'
  )
);
