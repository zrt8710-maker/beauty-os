-- A confirmed external identity may be anchored to a candidate Catalog row.
-- This preserves external (not verified) semantics while making the asset
-- eligible for product-level provisional research.
create or replace function public.create_owned_product_with_identity_idempotent(
  p_user_id uuid, p_resolution_kind text, p_brand_name text, p_product_name text,
  p_variant_name text, p_barcode text, p_category text, p_subcategory text,
  p_product_type text, p_catalog_product_id uuid, p_asset_category text,
  p_status text, p_purchase_date date, p_manufacture_date date, p_opened_at date,
  p_expires_on date, p_quantity_remaining_percent smallint, p_notes text,
  p_package_size text, p_idempotency_key uuid
) returns setof public.user_owned_products
language plpgsql security definer set search_path = '' as $$
declare
  existing public.asset_creation_idempotency%rowtype;
  created public.user_owned_products%rowtype;
  fingerprint text := md5(concat_ws('|', p_resolution_kind, p_brand_name,
    p_product_name, p_variant_name, p_barcode, p_category, p_product_type,
    p_catalog_product_id::text, p_asset_category, p_package_size,
    p_manufacture_date::text));
begin
  if auth.role() <> 'service_role'
    and (auth.uid() is null or auth.uid() is distinct from p_user_id) then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_resolution_kind = 'external' and p_catalog_product_id is not null
    and not exists (
      select 1 from public.catalog_products
      where id = p_catalog_product_id and status in ('candidate', 'verified')
    ) then
    raise exception 'CONFIRMED_CATALOG_CANDIDATE_NOT_FOUND' using errcode = '23514';
  end if;
  if p_resolution_kind <> 'external' and p_catalog_product_id is not null then
    -- Existing catalog resolution validation stays in the delegated RPC.
    null;
  end if;
  insert into public.asset_creation_idempotency
    (user_id, idempotency_key, request_fingerprint, owned_product_id)
  values (p_user_id, p_idempotency_key, fingerprint, null)
  on conflict (user_id, idempotency_key) do nothing;
  if not found then
    select * into existing from public.asset_creation_idempotency
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
    if existing.request_fingerprint <> fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '23514';
    end if;
    return query select * from public.user_owned_products
      where id = existing.owned_product_id and user_id = p_user_id;
    return;
  end if;
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  select * into created from public.create_owned_product_with_identity(
    p_user_id, p_resolution_kind, p_brand_name, p_product_name, p_variant_name,
    p_barcode, p_category, p_subcategory, p_product_type,
    case when p_resolution_kind = 'external' then null else p_catalog_product_id end,
    p_status, p_purchase_date, p_opened_at, p_expires_on,
    p_quantity_remaining_percent, p_notes
  ) limit 1;
  if p_resolution_kind = 'external' and p_catalog_product_id is not null then
    update public.products set catalog_product_id = p_catalog_product_id, updated_at = now()
    where id = created.product_id;
  end if;
  update public.user_owned_products
  set asset_category = p_asset_category, package_size = p_package_size,
      manufacture_date = p_manufacture_date
  where id = created.id returning * into created;
  update public.asset_creation_idempotency set owned_product_id = created.id
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  return next created;
end;
$$;

revoke all on function public.create_owned_product_with_identity_idempotent(
  uuid,text,text,text,text,text,text,text,text,uuid,text,text,date,date,date,date,
  smallint,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.create_owned_product_with_identity_idempotent(
  uuid,text,text,text,text,text,text,text,text,uuid,text,text,date,date,date,date,
  smallint,text,text,uuid
) to service_role;
