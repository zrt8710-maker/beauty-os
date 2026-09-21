-- Asset image state is deliberately user-asset scoped. It never writes Catalog
-- or Product Knowledge and existing product_id uploads remain legacy-only.
alter table public.user_owned_products
  add column identified_image_url text,
  add column identified_image_source_url text,
  add column image_override_upload_id uuid;

alter table public.upload_assets
  add column owned_product_id uuid references public.user_owned_products (id) on delete set null;

alter table public.user_owned_products
  add constraint user_owned_products_identified_image_url_https_check
    check (identified_image_url is null or identified_image_url ~ '^https://'),
  add constraint user_owned_products_identified_image_source_url_https_check
    check (identified_image_source_url is null or identified_image_source_url ~ '^https://'),
  add constraint user_owned_products_image_override_upload_id_fkey
    foreign key (image_override_upload_id) references public.upload_assets (id) on delete set null;

create index upload_assets_user_owned_product_idx
on public.upload_assets (user_id, owned_product_id)
where owned_product_id is not null;

drop policy "owned_products_update_own" on public.user_owned_products;
create policy "owned_products_update_own"
on public.user_owned_products for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.products
    where products.id = user_owned_products.product_id
      and products.created_by_user_id = (select auth.uid())
  )
  and (
    image_override_upload_id is null
    or exists (
      select 1 from public.upload_assets
      where upload_assets.id = user_owned_products.image_override_upload_id
        and upload_assets.user_id = (select auth.uid())
        and upload_assets.owned_product_id = user_owned_products.id
        and upload_assets.status = 'ready'
    )
  )
);

drop policy "upload_assets_insert_own" on public.upload_assets;
drop policy "upload_assets_update_own" on public.upload_assets;

create policy "upload_assets_insert_own"
on public.upload_assets for insert to authenticated with check (
  (select auth.uid()) = user_id
  and storage_path like (select auth.uid())::text || '/%'
  and (
    (product_id is null and owned_product_id is null)
    or (product_id is not null and owned_product_id is null and exists (
      select 1 from public.products
      where products.id = upload_assets.product_id
        and products.created_by_user_id = (select auth.uid())
    ))
    or (product_id is null and owned_product_id is not null and exists (
      select 1 from public.user_owned_products
      where user_owned_products.id = upload_assets.owned_product_id
        and user_owned_products.user_id = (select auth.uid())
        and user_owned_products.archived_at is null
    ))
  )
);

create policy "upload_assets_update_own"
on public.upload_assets for update to authenticated using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and storage_path like (select auth.uid())::text || '/%'
  and (
    (product_id is null and owned_product_id is null)
    or (product_id is not null and owned_product_id is null and exists (
      select 1 from public.products
      where products.id = upload_assets.product_id
        and products.created_by_user_id = (select auth.uid())
    ))
    or (product_id is null and owned_product_id is not null and exists (
      select 1 from public.user_owned_products
      where user_owned_products.id = upload_assets.owned_product_id
        and user_owned_products.user_id = (select auth.uid())
        and user_owned_products.archived_at is null
    ))
  )
);
