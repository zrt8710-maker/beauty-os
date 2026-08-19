create table public.products (
  id uuid primary key default gen_random_uuid(),
  brand_name text check (brand_name is null or char_length(brand_name) between 1 and 120),
  product_name text not null check (char_length(product_name) between 1 and 200),
  category text not null check (
    category in (
      'skincare',
      'makeup',
      'bodycare',
      'haircare',
      'fragrance',
      'beauty_tool',
      'other'
    )
  ),
  subcategory text not null check (
    subcategory in (
      'face_care',
      'eye_care',
      'lip_care',
      'sun_care',
      'base_makeup',
      'cheek_makeup',
      'eye_makeup',
      'brow_makeup',
      'lip_makeup',
      'setting_makeup',
      'body_care',
      'hair_care',
      'fragrance',
      'tool',
      'other'
    )
  ),
  product_type text not null check (
    product_type in (
      'cleanser',
      'toner',
      'essence',
      'serum',
      'treatment',
      'moisturizer',
      'face_oil',
      'sunscreen',
      'mask',
      'eye_care',
      'lip_care',
      'primer',
      'foundation',
      'bb_cc_cream',
      'concealer',
      'powder',
      'blush',
      'contour',
      'highlighter',
      'eyeshadow',
      'eyeliner',
      'mascara',
      'brow_product',
      'lip_color',
      'setting_spray',
      'body_cleanser',
      'body_lotion',
      'body_treatment',
      'shampoo',
      'conditioner',
      'hair_treatment',
      'hair_styling',
      'perfume',
      'body_mist',
      'applicator',
      'device',
      'other'
    )
  ),
  created_by_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_owner_category_idx
on public.products (created_by_user_id, category);

create index products_owner_updated_idx
on public.products (created_by_user_id, updated_at desc);

alter table public.products enable row level security;

revoke all on table public.products from anon;
grant select, insert, update, delete on table public.products to authenticated;

create policy "products_select_own"
on public.products
for select
to authenticated
using ((select auth.uid()) = created_by_user_id);

create policy "products_insert_own"
on public.products
for insert
to authenticated
with check ((select auth.uid()) = created_by_user_id);

create policy "products_update_own"
on public.products
for update
to authenticated
using ((select auth.uid()) = created_by_user_id)
with check ((select auth.uid()) = created_by_user_id);

create policy "products_delete_own"
on public.products
for delete
to authenticated
using ((select auth.uid()) = created_by_user_id);

create table public.user_owned_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  status text not null default 'unopened' check (
    status in ('unopened', 'active', 'paused', 'finished', 'discarded', 'archived')
  ),
  purchase_date date,
  opened_at date,
  quantity_remaining_percent smallint not null default 100 check (
    quantity_remaining_percent between 0 and 100
  ),
  notes text check (notes is null or char_length(notes) <= 2000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'archived' and archived_at is not null)
    or (status <> 'archived' and archived_at is null)
  )
);

create index user_owned_products_user_status_idx
on public.user_owned_products (user_id, status);

create index user_owned_products_user_updated_idx
on public.user_owned_products (user_id, updated_at desc);

create index user_owned_products_active_idx
on public.user_owned_products (user_id)
where archived_at is null;

alter table public.user_owned_products enable row level security;

revoke all on table public.user_owned_products from anon;
grant select, insert, update, delete on table public.user_owned_products to authenticated;

create policy "owned_products_select_own"
on public.user_owned_products
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "owned_products_insert_own"
on public.user_owned_products
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.products
    where products.id = product_id
      and products.created_by_user_id = (select auth.uid())
  )
);

create policy "owned_products_update_own"
on public.user_owned_products
for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.products
    where products.id = product_id
      and products.created_by_user_id = (select auth.uid())
  )
);

create policy "owned_products_delete_own"
on public.user_owned_products
for delete
to authenticated
using ((select auth.uid()) = user_id);
