create table public.upload_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  storage_path text not null unique check (
    char_length(storage_path) between 1 and 500
    and storage_path like user_id::text || '/%'
  ),
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  file_size bigint not null check (file_size between 1 and 5242880),
  purpose text not null check (purpose in ('product_image')),
  status text not null default 'pending' check (
    status in ('pending', 'ready', 'failed')
  ),
  created_at timestamptz not null default now()
);

create index upload_assets_user_created_idx
on public.upload_assets (user_id, created_at desc);

create index upload_assets_user_product_idx
on public.upload_assets (user_id, product_id)
where product_id is not null;

alter table public.upload_assets enable row level security;

revoke all on table public.upload_assets from anon;
grant select, insert, update, delete on table public.upload_assets to authenticated;

create policy "upload_assets_select_own"
on public.upload_assets
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "upload_assets_insert_own"
on public.upload_assets
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and storage_path like (select auth.uid())::text || '/%'
  and exists (
    select 1
    from public.products
    where products.id = upload_assets.product_id
      and products.created_by_user_id = (select auth.uid())
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
  and exists (
    select 1
    from public.products
    where products.id = upload_assets.product_id
      and products.created_by_user_id = (select auth.uid())
  )
);

create policy "upload_assets_delete_own"
on public.upload_assets
for delete
to authenticated
using ((select auth.uid()) = user_id);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'product-images',
  'product-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "product_images_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "product_images_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "product_images_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "product_images_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
