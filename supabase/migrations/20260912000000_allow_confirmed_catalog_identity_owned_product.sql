-- Catalog identity and Product Knowledge publication are independent.
-- A confirmed candidate can create a user asset; knowledge enrichment remains
-- a separate, non-blocking lifecycle.
create or replace function public.create_owned_product_with_identity(
  p_user_id uuid,
  p_resolution_kind text,
  p_brand_name text,
  p_product_name text,
  p_variant_name text,
  p_barcode text,
  p_category text,
  p_subcategory text,
  p_product_type text,
  p_catalog_product_id uuid,
  p_status text,
  p_purchase_date date,
  p_opened_at date,
  p_expires_on date,
  p_quantity_remaining_percent smallint,
  p_notes text
)
returns setof public.user_owned_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  catalog_record public.catalog_products%rowtype;
  created_product_id uuid;
  created_owned_product_id uuid;
  has_catalog_barcode_match boolean := false;
  resolved_identity_status text;
begin
  if auth.uid() is null or auth.uid() is distinct from p_user_id then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_resolution_kind is null
    or p_resolution_kind not in ('catalog', 'external', 'unknown') then
    raise exception 'INVALID_IDENTITY_RESOLUTION_KIND' using errcode = '23514';
  end if;

  if p_resolution_kind = 'catalog' and p_catalog_product_id is null then
    raise exception 'CATALOG_RESOLUTION_REQUIRES_CATALOG_PRODUCT'
      using errcode = '23514';
  end if;

  if p_resolution_kind <> 'catalog' and p_catalog_product_id is not null then
    raise exception 'NON_CATALOG_RESOLUTION_FORBIDS_CATALOG_PRODUCT'
      using errcode = '23514';
  end if;

  if p_purchase_date is not null
    and p_opened_at is not null
    and p_opened_at < p_purchase_date then
    raise exception 'OPENED_BEFORE_PURCHASE' using errcode = '23514';
  end if;

  resolved_identity_status := case
    when p_resolution_kind in ('catalog', 'external') then 'matched'
    else 'unknown'
  end;

  if p_resolution_kind = 'catalog' then
    select *
    into catalog_record
    from public.catalog_products
    where id = p_catalog_product_id
      and status in ('candidate', 'verified');

    if not found then
      raise exception 'CONFIRMED_CATALOG_IDENTITY_NOT_FOUND'
        using errcode = '23514';
    end if;

    if p_barcode is not null then
      select exists (
        select 1
        from public.catalog_products
        where status in ('candidate', 'verified')
          and barcode = p_barcode
      ) into has_catalog_barcode_match;
    end if;

    if has_catalog_barcode_match then
      if catalog_record.barcode is distinct from p_barcode then
        raise exception 'CATALOG_IDENTITY_MISMATCH' using errcode = '23514';
      end if;
    elsif p_brand_name is null
      or public.normalize_product_match_text(catalog_record.brand_name)
        is distinct from public.normalize_product_match_text(p_brand_name)
      or public.normalize_product_match_text(catalog_record.product_name)
        is distinct from public.normalize_product_match_text(p_product_name) then
      raise exception 'CATALOG_IDENTITY_MISMATCH' using errcode = '23514';
    end if;

    insert into public.products (
      brand_name,
      product_name,
      variant_name,
      barcode,
      category,
      subcategory,
      product_type,
      catalog_product_id,
      identity_status,
      created_by_user_id
    ) values (
      catalog_record.brand_name,
      catalog_record.product_name,
      catalog_record.variant_name,
      catalog_record.barcode,
      catalog_record.category,
      catalog_record.subcategory,
      catalog_record.product_type,
      catalog_record.id,
      resolved_identity_status,
      p_user_id
    ) returning id into created_product_id;
  else
    insert into public.products (
      brand_name,
      product_name,
      variant_name,
      barcode,
      category,
      subcategory,
      product_type,
      catalog_product_id,
      identity_status,
      created_by_user_id
    ) values (
      p_brand_name,
      p_product_name,
      p_variant_name,
      p_barcode,
      p_category,
      p_subcategory,
      p_product_type,
      null,
      resolved_identity_status,
      p_user_id
    ) returning id into created_product_id;
  end if;

  insert into public.user_owned_products (
    user_id,
    product_id,
    status,
    purchase_date,
    opened_at,
    expires_on,
    quantity_remaining_percent,
    notes
  ) values (
    p_user_id,
    created_product_id,
    p_status,
    p_purchase_date,
    p_opened_at,
    p_expires_on,
    p_quantity_remaining_percent,
    p_notes
  ) returning id into created_owned_product_id;

  return query
  select *
  from public.user_owned_products
  where id = created_owned_product_id
    and user_id = p_user_id;
end;
$$;
