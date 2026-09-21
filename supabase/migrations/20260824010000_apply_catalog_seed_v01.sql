create function public.apply_catalog_seed_v01(
  p_input jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source jsonb;
  v_identity jsonb;
  v_source_id uuid;
  v_catalog_product_id uuid;
  v_source_type text;
  v_source_name text;
  v_source_url text;
  v_license_note text;
  v_retrieved_at timestamptz;
  v_brand_name text;
  v_product_name text;
  v_variant_name text;
  v_barcode text;
  v_category text;
  v_subcategory text;
  v_product_type text;
  v_confidence smallint;
  v_status text;
  v_expected_category text;
  v_expected_subcategory text;
  v_existing_source public.knowledge_sources%rowtype;
  v_existing_catalog public.catalog_products%rowtype;
  v_conflicting_catalog_id uuid;
  v_source_exists boolean := false;
  v_catalog_exists boolean := false;
  v_source_created boolean := false;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'INVALID_CATALOG_SEED_INPUT'
      using errcode = '22023';
  end if;

  if p_input ->> 'schema_version' is distinct from 'catalog-seed/v0.1' then
    raise exception 'UNSUPPORTED_CATALOG_SEED_SCHEMA_VERSION'
      using errcode = '22023';
  end if;

  v_source := p_input -> 'source';
  v_identity := p_input -> 'identity';

  if v_source is null or jsonb_typeof(v_source) <> 'object' then
    raise exception 'INVALID_CATALOG_SEED_SOURCE'
      using errcode = '22023';
  end if;

  if v_identity is null or jsonb_typeof(v_identity) <> 'object' then
    raise exception 'INVALID_CATALOG_SEED_IDENTITY'
      using errcode = '22023';
  end if;

  begin
    v_source_id := (v_source ->> 'source_id')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'INVALID_CATALOG_SEED_SOURCE_ID'
        using errcode = '22023';
  end;

  begin
    v_catalog_product_id := (p_input ->> 'catalog_product_id')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'INVALID_CATALOG_SEED_PRODUCT_ID'
        using errcode = '22023';
  end;

  if v_source_id is null then
    raise exception 'CATALOG_SEED_SOURCE_ID_REQUIRED'
      using errcode = '22023';
  end if;

  if v_catalog_product_id is null then
    raise exception 'CATALOG_SEED_PRODUCT_ID_REQUIRED'
      using errcode = '22023';
  end if;

  v_source_type := v_source ->> 'source_type';
  v_source_name := v_source ->> 'name';
  v_source_url := v_source ->> 'source_url';
  v_license_note := v_source ->> 'license_note';
  v_brand_name := v_identity ->> 'brand_name';
  v_product_name := v_identity ->> 'product_name';
  v_variant_name := v_identity ->> 'variant_name';
  v_barcode := v_identity ->> 'barcode';
  v_category := v_identity ->> 'category';
  v_subcategory := v_identity ->> 'subcategory';
  v_product_type := v_identity ->> 'product_type';
  v_status := v_identity ->> 'status';

  begin
    v_retrieved_at := (v_source ->> 'retrieved_at')::timestamptz;
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception 'INVALID_CATALOG_SEED_RETRIEVED_AT'
        using errcode = '22023';
  end;

  begin
    v_confidence := (v_identity ->> 'confidence')::smallint;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'INVALID_CATALOG_SEED_CONFIDENCE'
        using errcode = '22023';
  end;

  if v_source_type is null or v_source_type not in (
    'official_brand',
    'official_retailer',
    'open_dataset',
    'user_submitted',
    'ai_candidate'
  ) then
    raise exception 'INVALID_CATALOG_SEED_SOURCE_TYPE'
      using errcode = '22023';
  end if;

  if v_source_type = 'ai_candidate' then
    raise exception 'CATALOG_SEED_VERIFIED_AI_SOURCE_FORBIDDEN'
      using errcode = '23514';
  end if;

  if v_source_name is null
    or v_source_name <> btrim(v_source_name)
    or char_length(v_source_name) not between 1 and 200 then
    raise exception 'INVALID_CATALOG_SEED_SOURCE_NAME'
      using errcode = '22023';
  end if;

  if v_source_url is not null and (
    v_source_url <> btrim(v_source_url)
    or char_length(v_source_url) not between 1 and 2000
  ) then
    raise exception 'INVALID_CATALOG_SEED_SOURCE_URL'
      using errcode = '22023';
  end if;

  if v_license_note is not null and (
    v_license_note <> btrim(v_license_note)
    or char_length(v_license_note) not between 1 and 2000
  ) then
    raise exception 'INVALID_CATALOG_SEED_LICENSE_NOTE'
      using errcode = '22023';
  end if;

  if v_retrieved_at is null then
    raise exception 'CATALOG_SEED_RETRIEVED_AT_REQUIRED'
      using errcode = '22023';
  end if;

  if v_brand_name is null
    or v_brand_name <> btrim(v_brand_name)
    or char_length(v_brand_name) not between 1 and 120 then
    raise exception 'INVALID_CATALOG_SEED_BRAND_NAME'
      using errcode = '22023';
  end if;

  if v_product_name is null
    or v_product_name <> btrim(v_product_name)
    or char_length(v_product_name) not between 1 and 200 then
    raise exception 'INVALID_CATALOG_SEED_PRODUCT_NAME'
      using errcode = '22023';
  end if;

  if v_variant_name is not null and (
    v_variant_name <> btrim(v_variant_name)
    or char_length(v_variant_name) not between 1 and 200
  ) then
    raise exception 'INVALID_CATALOG_SEED_VARIANT_NAME'
      using errcode = '22023';
  end if;

  if v_barcode is not null and (
    v_barcode <> btrim(v_barcode)
    or char_length(v_barcode) not between 8 and 32
  ) then
    raise exception 'INVALID_CATALOG_SEED_BARCODE'
      using errcode = '22023';
  end if;

  if v_confidence is null then
    raise exception 'CATALOG_SEED_CONFIDENCE_REQUIRED'
      using errcode = '22023';
  end if;

  if v_status is distinct from 'verified' then
    raise exception 'CATALOG_SEED_STATUS_MUST_BE_VERIFIED'
      using errcode = '22023';
  end if;

  select classification.category, classification.subcategory
  into v_expected_category, v_expected_subcategory
  from (values
    ('makeup_remover', 'skincare', 'face_care'),
    ('cleanser', 'skincare', 'face_care'),
    ('toner', 'skincare', 'face_care'),
    ('essence', 'skincare', 'face_care'),
    ('serum', 'skincare', 'face_care'),
    ('treatment', 'skincare', 'face_care'),
    ('moisturizer', 'skincare', 'face_care'),
    ('face_oil', 'skincare', 'face_care'),
    ('sunscreen', 'skincare', 'sun_care'),
    ('mask', 'skincare', 'face_care'),
    ('eye_care', 'skincare', 'eye_care'),
    ('lip_care', 'skincare', 'lip_care'),
    ('primer', 'makeup', 'base_makeup'),
    ('foundation', 'makeup', 'base_makeup'),
    ('bb_cc_cream', 'makeup', 'base_makeup'),
    ('concealer', 'makeup', 'base_makeup'),
    ('powder', 'makeup', 'base_makeup'),
    ('blush', 'makeup', 'cheek_makeup'),
    ('contour', 'makeup', 'cheek_makeup'),
    ('highlighter', 'makeup', 'cheek_makeup'),
    ('eyeshadow', 'makeup', 'eye_makeup'),
    ('eyeliner', 'makeup', 'eye_makeup'),
    ('mascara', 'makeup', 'eye_makeup'),
    ('brow_product', 'makeup', 'brow_makeup'),
    ('lip_color', 'makeup', 'lip_makeup'),
    ('setting_spray', 'makeup', 'setting_makeup'),
    ('body_cleanser', 'bodycare', 'body_care'),
    ('body_lotion', 'bodycare', 'body_care'),
    ('body_treatment', 'bodycare', 'body_care'),
    ('shampoo', 'haircare', 'hair_care'),
    ('conditioner', 'haircare', 'hair_care'),
    ('hair_treatment', 'haircare', 'hair_care'),
    ('hair_styling', 'haircare', 'hair_care'),
    ('perfume', 'fragrance', 'fragrance'),
    ('body_mist', 'fragrance', 'fragrance'),
    ('applicator', 'beauty_tool', 'tool'),
    ('device', 'beauty_tool', 'tool'),
    ('other', 'other', 'other')
  ) as classification(product_type, category, subcategory)
  where classification.product_type = v_product_type;

  if not found then
    raise exception 'INVALID_CATALOG_SEED_PRODUCT_TYPE'
      using errcode = '22023';
  end if;

  if v_category is distinct from v_expected_category
    or v_subcategory is distinct from v_expected_subcategory then
    raise exception 'CATALOG_SEED_CLASSIFICATION_MISMATCH'
      using errcode = '23514';
  end if;

  -- Catalog seeding is a low-volume internal workflow. These locks make the
  -- read/check/insert sequence serializable against every direct table writer.
  lock table public.knowledge_sources in share row exclusive mode;
  lock table public.catalog_products in share row exclusive mode;

  select source.*
  into v_existing_source
  from public.knowledge_sources as source
  where source.id = v_source_id
  for update;
  v_source_exists := found;

  if v_source_exists and (
    v_existing_source.source_type is distinct from v_source_type
    or v_existing_source.name is distinct from v_source_name
    or v_existing_source.source_url is distinct from v_source_url
    or v_existing_source.license_note is distinct from v_license_note
    or v_existing_source.retrieved_at is distinct from v_retrieved_at
  ) then
    raise exception 'CATALOG_SEED_SOURCE_ID_CONFLICT'
      using errcode = '23505';
  end if;

  select catalog_product.*
  into v_existing_catalog
  from public.catalog_products as catalog_product
  where catalog_product.id = v_catalog_product_id
  for update;
  v_catalog_exists := found;

  if v_catalog_exists and v_existing_catalog.status <> 'verified' then
    raise exception 'CATALOG_SEED_CATALOG_STATUS_CONFLICT'
      using errcode = '23514';
  end if;

  if v_catalog_exists and (
    v_existing_catalog.brand_name is distinct from v_brand_name
    or v_existing_catalog.product_name is distinct from v_product_name
    or v_existing_catalog.variant_name is distinct from v_variant_name
    or v_existing_catalog.barcode is distinct from v_barcode
    or v_existing_catalog.category is distinct from v_category
    or v_existing_catalog.subcategory is distinct from v_subcategory
    or v_existing_catalog.product_type is distinct from v_product_type
    or v_existing_catalog.primary_source_id is distinct from v_source_id
    or v_existing_catalog.confidence is distinct from v_confidence
  ) then
    raise exception 'CATALOG_SEED_STABLE_ID_CONFLICT'
      using errcode = '23505';
  end if;

  if v_barcode is not null then
    select catalog_product.id
    into v_conflicting_catalog_id
    from public.catalog_products as catalog_product
    where catalog_product.barcode = v_barcode
      and catalog_product.id <> v_catalog_product_id
    order by catalog_product.id
    limit 1;

    if found then
      raise exception 'CATALOG_SEED_BARCODE_CONFLICT: %',
        v_conflicting_catalog_id
        using errcode = '23505';
    end if;
  end if;

  select catalog_product.id
  into v_conflicting_catalog_id
  from public.catalog_products as catalog_product
  where catalog_product.brand_name = v_brand_name
    and catalog_product.product_name = v_product_name
    and catalog_product.variant_name is not distinct from v_variant_name
    and catalog_product.id <> v_catalog_product_id
  order by catalog_product.id
  limit 1;

  if found then
    raise exception 'CATALOG_SEED_RAW_IDENTITY_CONFLICT: %',
      v_conflicting_catalog_id
      using errcode = '23505';
  end if;

  select catalog_product.id
  into v_conflicting_catalog_id
  from public.catalog_products as catalog_product
  where public.normalize_product_match_text(catalog_product.brand_name)
      = public.normalize_product_match_text(v_brand_name)
    and public.normalize_product_match_text(catalog_product.product_name)
      = public.normalize_product_match_text(v_product_name)
    and catalog_product.id <> v_catalog_product_id
  order by catalog_product.id
  limit 1;

  if found then
    raise exception 'CATALOG_SEED_NORMALIZED_IDENTITY_CONFLICT: %',
      v_conflicting_catalog_id
      using errcode = '23505';
  end if;

  if v_catalog_exists then
    return jsonb_build_object(
      'outcome', 'existing',
      'catalog_product_id', v_catalog_product_id,
      'source_id', v_source_id,
      'source_created', false,
      'catalog_product_created', false,
      'status', 'verified'
    );
  end if;

  if not v_source_exists then
    insert into public.knowledge_sources (
      id,
      source_type,
      name,
      source_url,
      license_note,
      retrieved_at
    ) values (
      v_source_id,
      v_source_type,
      v_source_name,
      v_source_url,
      v_license_note,
      v_retrieved_at
    );
    v_source_created := true;
  end if;

  insert into public.catalog_products (
    id,
    brand_name,
    product_name,
    variant_name,
    barcode,
    category,
    subcategory,
    product_type,
    primary_source_id,
    confidence,
    status
  ) values (
    v_catalog_product_id,
    v_brand_name,
    v_product_name,
    v_variant_name,
    v_barcode,
    v_category,
    v_subcategory,
    v_product_type,
    v_source_id,
    v_confidence,
    'verified'
  );

  return jsonb_build_object(
    'outcome', 'created',
    'catalog_product_id', v_catalog_product_id,
    'source_id', v_source_id,
    'source_created', v_source_created,
    'catalog_product_created', true,
    'status', 'verified'
  );
end;
$$;

revoke all on function public.apply_catalog_seed_v01(jsonb)
from public, anon, authenticated;

grant execute on function public.normalize_product_match_text(text)
to service_role;

grant execute on function public.apply_catalog_seed_v01(jsonb)
to service_role;
