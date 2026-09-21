create table public.care_roles (
  code text primary key check (
    code in ('remover', 'cleanser', 'hydration', 'treatment', 'moisturizer', 'sunscreen')
  ),
  display_name text not null check (char_length(display_name) between 1 and 80),
  definition text not null check (char_length(definition) between 1 and 1000),
  definition_version smallint not null default 1 check (definition_version > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.care_roles (code, display_name, definition)
values
  ('remover', '卸除', '承担彩妆、防晒或其他需要预清洁产品的卸除步骤。'),
  ('cleanser', '清洁', '承担皮肤清洁步骤。'),
  ('hydration', '补水步骤', '承担补水、打底或轻质护理步骤；该角色本身不代表已验证补水功效。'),
  ('treatment', '针对性护理', '承担针对性护理步骤；该角色本身不代表已验证任何具体护理功效。'),
  ('moisturizer', '保湿收尾', '承担保湿封层或护理流程收尾步骤。'),
  ('sunscreen', '防晒步骤', '承担日间防晒产品的使用步骤。');

create table public.catalog_product_care_roles (
  id uuid primary key default gen_random_uuid(),
  catalog_product_id uuid not null references public.catalog_products (id) on delete cascade,
  care_role_code text not null references public.care_roles (code) on update cascade on delete restrict,
  assignment_kind text not null check (assignment_kind in ('primary', 'secondary')),
  status text not null check (status in ('verified', 'candidate', 'unknown')),
  confidence smallint check (confidence is null or confidence between 0 and 100),
  assessment_note text check (assessment_note is null or char_length(assessment_note) between 1 and 2000),
  source_locator text check (source_locator is null or char_length(source_locator) between 1 and 2000),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (catalog_product_id, care_role_code),
  check (status <> 'verified' or confidence is not null)
);

create index catalog_product_care_roles_product_status_idx
on public.catalog_product_care_roles (catalog_product_id, status);

create index catalog_product_care_roles_role_status_idx
on public.catalog_product_care_roles (care_role_code, status);

alter table public.care_roles enable row level security;
alter table public.catalog_product_care_roles enable row level security;

revoke all on table public.care_roles from anon, authenticated;
revoke all on table public.catalog_product_care_roles from anon, authenticated;

grant select on table public.care_roles, public.catalog_product_care_roles to authenticated;

create policy "care_roles_select_active"
on public.care_roles for select to authenticated
using (is_active = true);

create policy "catalog_product_care_roles_select_verified_catalog"
on public.catalog_product_care_roles for select to authenticated
using (
  exists (
    select 1
    from public.catalog_products
    where catalog_products.id = catalog_product_care_roles.catalog_product_id
      and catalog_products.status = 'verified'
  )
);
