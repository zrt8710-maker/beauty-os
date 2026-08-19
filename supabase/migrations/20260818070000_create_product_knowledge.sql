create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (
    source_type in ('official_brand', 'official_retailer', 'open_dataset', 'user_submitted', 'ai_candidate')
  ),
  name text not null check (char_length(name) between 1 and 200),
  source_url text check (source_url is null or char_length(source_url) between 1 and 2000),
  license_note text check (license_note is null or char_length(license_note) <= 2000),
  retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null check (char_length(brand_name) between 1 and 120),
  product_name text not null check (char_length(product_name) between 1 and 200),
  variant_name text check (variant_name is null or char_length(variant_name) between 1 and 200),
  barcode text unique check (barcode is null or char_length(barcode) between 8 and 32),
  category text not null check (category in ('skincare', 'makeup', 'bodycare', 'haircare', 'fragrance', 'beauty_tool', 'other')),
  subcategory text not null check (subcategory in ('face_care', 'eye_care', 'lip_care', 'sun_care', 'base_makeup', 'cheek_makeup', 'eye_makeup', 'brow_makeup', 'lip_makeup', 'setting_makeup', 'body_care', 'hair_care', 'fragrance', 'tool', 'other')),
  product_type text not null check (product_type in ('makeup_remover', 'cleanser', 'toner', 'essence', 'serum', 'treatment', 'moisturizer', 'face_oil', 'sunscreen', 'mask', 'eye_care', 'lip_care', 'primer', 'foundation', 'bb_cc_cream', 'concealer', 'powder', 'blush', 'contour', 'highlighter', 'eyeshadow', 'eyeliner', 'mascara', 'brow_product', 'lip_color', 'setting_spray', 'body_cleanser', 'body_lotion', 'body_treatment', 'shampoo', 'conditioner', 'hair_treatment', 'hair_styling', 'perfume', 'body_mist', 'applicator', 'device', 'other')),
  primary_source_id uuid not null references public.knowledge_sources (id) on delete restrict,
  confidence smallint not null check (confidence between 0 and 100),
  status text not null default 'candidate' check (status in ('candidate', 'verified', 'deprecated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_name, product_name, variant_name)
);

create index catalog_products_verified_name_idx
on public.catalog_products (brand_name, product_name)
where status = 'verified';

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  inci_name text not null unique check (char_length(inci_name) between 1 and 200),
  display_name text check (display_name is null or char_length(display_name) between 1 and 200),
  aliases text[] not null default '{}'::text[] check (cardinality(aliases) <= 20),
  ingredient_kind text check (ingredient_kind is null or char_length(ingredient_kind) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.catalog_product_ingredients (
  catalog_product_id uuid not null references public.catalog_products (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  ingredient_order smallint check (ingredient_order is null or ingredient_order between 1 and 500),
  source_id uuid not null references public.knowledge_sources (id) on delete restrict,
  confidence smallint not null check (confidence between 0 and 100),
  evidence_note text check (evidence_note is null or char_length(evidence_note) <= 2000),
  primary key (catalog_product_id, ingredient_id)
);

create index catalog_product_ingredients_product_order_idx
on public.catalog_product_ingredients (catalog_product_id, ingredient_order);

alter table public.knowledge_sources enable row level security;
alter table public.catalog_products enable row level security;
alter table public.ingredients enable row level security;
alter table public.catalog_product_ingredients enable row level security;

revoke all on table public.knowledge_sources from anon, authenticated;
revoke all on table public.catalog_products from anon, authenticated;
revoke all on table public.ingredients from anon, authenticated;
revoke all on table public.catalog_product_ingredients from anon, authenticated;
grant select on table public.knowledge_sources, public.catalog_products, public.ingredients, public.catalog_product_ingredients to authenticated;

create policy "knowledge_sources_select_verified"
on public.knowledge_sources for select to authenticated
using (
  exists (select 1 from public.catalog_products where catalog_products.primary_source_id = knowledge_sources.id and catalog_products.status = 'verified')
  or exists (select 1 from public.catalog_product_ingredients join public.catalog_products on catalog_products.id = catalog_product_ingredients.catalog_product_id where catalog_product_ingredients.source_id = knowledge_sources.id and catalog_products.status = 'verified')
);

create policy "catalog_products_select_verified"
on public.catalog_products for select to authenticated
using (status = 'verified');

create policy "ingredients_select_verified_relationship"
on public.ingredients for select to authenticated
using (
  exists (select 1 from public.catalog_product_ingredients join public.catalog_products on catalog_products.id = catalog_product_ingredients.catalog_product_id where catalog_product_ingredients.ingredient_id = ingredients.id and catalog_products.status = 'verified')
);

create policy "catalog_product_ingredients_select_verified"
on public.catalog_product_ingredients for select to authenticated
using (
  exists (select 1 from public.catalog_products where catalog_products.id = catalog_product_ingredients.catalog_product_id and catalog_products.status = 'verified')
);
