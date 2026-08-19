alter table public.upload_assets
alter column product_id drop not null;

drop policy "upload_assets_insert_own" on public.upload_assets;
drop policy "upload_assets_update_own" on public.upload_assets;

create policy "upload_assets_insert_own"
on public.upload_assets
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and storage_path like (select auth.uid())::text || '/%'
  and (
    product_id is null
    or exists (
      select 1
      from public.products
      where products.id = upload_assets.product_id
        and products.created_by_user_id = (select auth.uid())
    )
  )
);

create policy "upload_assets_update_own"
on public.upload_assets
for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and storage_path like (select auth.uid())::text || '/%'
  and (
    product_id is null
    or exists (
      select 1
      from public.products
      where products.id = upload_assets.product_id
        and products.created_by_user_id = (select auth.uid())
    )
  )
);

create table public.product_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  upload_asset_id uuid not null references public.upload_assets (id) on delete cascade,
  brand_name text check (brand_name is null or char_length(brand_name) between 1 and 120),
  product_name text check (product_name is null or char_length(product_name) between 1 and 200),
  category text check (
    category is null
    or category in (
      'skincare',
      'makeup',
      'bodycare',
      'haircare',
      'fragrance',
      'beauty_tool',
      'other'
    )
  ),
  subcategory text check (
    subcategory is null
    or subcategory in (
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
  product_type text check (
    product_type is null
    or product_type in (
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
  notes text check (notes is null or char_length(notes) <= 2000),
  source text not null default 'manual' check (
    source in ('manual', 'image', 'ai')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'confirmed', 'rejected')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_drafts_user_status_idx
on public.product_drafts (user_id, status, updated_at desc);

create unique index product_drafts_active_upload_idx
on public.product_drafts (upload_asset_id)
where status in ('pending', 'confirmed');

alter table public.product_drafts enable row level security;

revoke all on table public.product_drafts from anon;
grant select, insert, update, delete on table public.product_drafts to authenticated;

create policy "product_drafts_select_own"
on public.product_drafts
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "product_drafts_insert_own"
on public.product_drafts
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.upload_assets
    where upload_assets.id = product_drafts.upload_asset_id
      and upload_assets.user_id = (select auth.uid())
      and upload_assets.status = 'ready'
      and upload_assets.product_id is null
  )
);

create policy "product_drafts_update_own"
on public.product_drafts
for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.upload_assets
    where upload_assets.id = product_drafts.upload_asset_id
      and upload_assets.user_id = (select auth.uid())
  )
);

create policy "product_drafts_delete_unconfirmed_own"
on public.product_drafts
for delete
to authenticated
using (
  (select auth.uid()) = user_id
  and status <> 'confirmed'
);

create or replace function public.confirm_product_draft(p_draft_id uuid)
returns table (
  created_product_id uuid,
  created_owned_product_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  draft_record public.product_drafts%rowtype;
  upload_record public.upload_assets%rowtype;
  new_product_id uuid;
  new_owned_product_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select *
  into draft_record
  from public.product_drafts
  where id = p_draft_id
    and user_id = (select auth.uid())
    and status = 'pending'
  for update;

  if not found then
    raise exception 'DRAFT_NOT_FOUND_OR_NOT_PENDING' using errcode = 'P0002';
  end if;

  if draft_record.product_name is null
    or draft_record.category is null
    or draft_record.subcategory is null
    or draft_record.product_type is null then
    raise exception 'DRAFT_INCOMPLETE' using errcode = '23514';
  end if;

  select *
  into upload_record
  from public.upload_assets
  where id = draft_record.upload_asset_id
    and user_id = (select auth.uid())
    and status = 'ready'
    and product_id is null
  for update;

  if not found then
    raise exception 'UPLOAD_NOT_READY_OR_ALREADY_LINKED' using errcode = '23514';
  end if;

  insert into public.products (
    brand_name,
    product_name,
    category,
    subcategory,
    product_type,
    created_by_user_id
  )
  values (
    draft_record.brand_name,
    draft_record.product_name,
    draft_record.category,
    draft_record.subcategory,
    draft_record.product_type,
    (select auth.uid())
  )
  returning id into new_product_id;

  insert into public.user_owned_products (
    user_id,
    product_id,
    status,
    quantity_remaining_percent,
    notes
  )
  values (
    (select auth.uid()),
    new_product_id,
    'unopened',
    100,
    draft_record.notes
  )
  returning id into new_owned_product_id;

  update public.upload_assets
  set product_id = new_product_id
  where id = upload_record.id
    and user_id = (select auth.uid());

  update public.product_drafts
  set
    status = 'confirmed',
    updated_at = now()
  where id = draft_record.id
    and user_id = (select auth.uid());

  return query
  select new_product_id, new_owned_product_id;
end;
$$;

revoke all on function public.confirm_product_draft(uuid) from public;
revoke all on function public.confirm_product_draft(uuid) from anon;
grant execute on function public.confirm_product_draft(uuid) to authenticated;
