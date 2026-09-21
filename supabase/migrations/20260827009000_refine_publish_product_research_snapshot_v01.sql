-- Forward-only refinement of the narrow V1 bridge. Research snapshots retain
-- source-backed raw ingredient names even when no separate canonical alias has
-- been supplied; this does not derive formula order, concentration, function,
-- capability, or risk.
create or replace function public.publish_product_research_snapshot_v01(
  p_draft_id uuid,
  p_catalog_product_id uuid,
  p_category text,
  p_subcategory text,
  p_product_type text,
  p_selected_source_id text,
  p_published_by uuid
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_draft public.catalog_product_research_drafts%rowtype;
  v_catalog public.catalog_products%rowtype;
  v_selected_source jsonb;
  v_existing_result jsonb;
  v_source_id uuid;
  v_source_created boolean := false;
  v_source_type text;
  v_source_name text;
  v_source_url text;
  v_retrieved_at timestamptz;
  v_item jsonb;
  v_ingredient_id uuid;
  v_canonical_name text;
  v_ingredient_count integer := 0;
  v_result jsonb;
begin
  select * into v_draft from public.catalog_product_research_drafts as draft
  where draft.id = p_draft_id for update;
  if not found then raise exception 'RESEARCH_DRAFT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_draft.catalog_product_id is distinct from p_catalog_product_id then raise exception 'RESEARCH_DRAFT_CATALOG_MISMATCH' using errcode = '23514'; end if;
  if v_draft.status not in ('draft', 'review_pending', 'approved') then raise exception 'RESEARCH_DRAFT_NOT_USABLE' using errcode = '23514'; end if;

  select publication.result into v_existing_result
  from public.catalog_product_research_draft_publications as publication
  where publication.draft_id = v_draft.id;
  if found then return v_existing_result || jsonb_build_object('idempotent', true); end if;

  select * into v_catalog from public.catalog_products as catalog_product
  where catalog_product.id = p_catalog_product_id for update;
  if not found then raise exception 'CATALOG_PRODUCT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_catalog.status <> 'candidate' then raise exception 'CATALOG_PRODUCT_NOT_CANDIDATE' using errcode = '23514'; end if;

  if not exists (
    select 1 from (values
      ('skincare', 'face_care', 'makeup_remover'), ('skincare', 'face_care', 'cleanser'),
      ('skincare', 'face_care', 'toner'), ('skincare', 'face_care', 'essence'),
      ('skincare', 'face_care', 'serum'), ('skincare', 'face_care', 'treatment'),
      ('skincare', 'face_care', 'moisturizer'), ('skincare', 'face_care', 'face_oil'),
      ('skincare', 'sun_care', 'sunscreen'), ('skincare', 'face_care', 'mask'),
      ('skincare', 'eye_care', 'eye_care'), ('skincare', 'lip_care', 'lip_care'),
      ('makeup', 'base_makeup', 'primer'), ('makeup', 'base_makeup', 'foundation'),
      ('makeup', 'base_makeup', 'bb_cc_cream'), ('makeup', 'base_makeup', 'concealer'),
      ('makeup', 'base_makeup', 'powder'), ('makeup', 'cheek_makeup', 'blush'),
      ('makeup', 'cheek_makeup', 'contour'), ('makeup', 'cheek_makeup', 'highlighter'),
      ('makeup', 'eye_makeup', 'eyeshadow'), ('makeup', 'eye_makeup', 'eyeliner'),
      ('makeup', 'eye_makeup', 'mascara'), ('makeup', 'brow_makeup', 'brow_product'),
      ('makeup', 'lip_makeup', 'lip_color'), ('makeup', 'setting_makeup', 'setting_spray'),
      ('bodycare', 'body_care', 'body_cleanser'), ('bodycare', 'body_care', 'body_lotion'),
      ('bodycare', 'body_care', 'body_treatment'), ('haircare', 'hair_care', 'shampoo'),
      ('haircare', 'hair_care', 'conditioner'), ('haircare', 'hair_care', 'hair_treatment'),
      ('haircare', 'hair_care', 'hair_styling'), ('fragrance', 'fragrance', 'perfume'),
      ('fragrance', 'fragrance', 'body_mist'), ('beauty_tool', 'tool', 'applicator'),
      ('beauty_tool', 'tool', 'device'), ('other', 'other', 'other')
    ) as classification(category, subcategory, product_type)
    where classification.category = p_category
      and classification.subcategory = p_subcategory
      and classification.product_type = p_product_type
  ) then raise exception 'CATALOG_PUBLICATION_CLASSIFICATION_MISMATCH' using errcode = '23514'; end if;

  select source.value into v_selected_source
  from jsonb_array_elements(v_draft.research_payload -> 'sources') as source(value)
  where source.value ->> 'source_id' = p_selected_source_id limit 1;
  if v_selected_source is null then raise exception 'SELECTED_RESEARCH_SOURCE_NOT_FOUND' using errcode = '23514'; end if;
  v_source_name := left(v_selected_source ->> 'title', 200);
  v_source_url := v_selected_source ->> 'url';
  if v_source_name is null or v_source_url is null
    or v_source_url <> btrim(v_source_url)
    or char_length(v_source_url) not between 1 and 2000
  then raise exception 'SELECTED_RESEARCH_SOURCE_INVALID' using errcode = '23514'; end if;
  begin v_retrieved_at := (v_selected_source ->> 'retrieved_at')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'SELECTED_RESEARCH_SOURCE_INVALID' using errcode = '23514';
  end;
  v_source_type := case
    when coalesce(v_selected_source ->> 'source_type', '') like 'official_brand%'
      or coalesce(v_selected_source ->> 'source_type', '') like 'brand_owner%' then 'official_brand'
    when coalesce(v_selected_source ->> 'source_type', '') like 'official_retailer%'
      or coalesce(v_selected_source ->> 'source_type', '') like 'official_store%'
      or coalesce(v_selected_source ->> 'source_type', '') like 'retail%' then 'official_retailer'
    else 'ai_candidate'
  end;

  lock table public.knowledge_sources in share row exclusive mode;
  select source.id into v_source_id from public.knowledge_sources as source
  where source.source_type = v_source_type and source.name = v_source_name and source.source_url = v_source_url
  order by source.id limit 1 for update;
  if not found then
    insert into public.knowledge_sources(source_type, name, source_url, retrieved_at)
    values(v_source_type, v_source_name, v_source_url, v_retrieved_at)
    returning id into v_source_id;
    v_source_created := true;
  end if;

  if v_draft.research_payload -> 'ingredients' ->> 'status' in ('found', 'partial') then
    for v_item in select item.value from jsonb_array_elements(coalesce(v_draft.research_payload -> 'ingredients' -> 'items', '[]'::jsonb)) as item(value)
    loop
      v_canonical_name := coalesce(nullif(btrim(v_item ->> 'normalized_name'), ''), nullif(btrim(v_item ->> 'raw_name'), ''));
      if v_canonical_name is null then continue; end if;
      insert into public.ingredients(inci_name, display_name)
      values(v_canonical_name, nullif(btrim(v_item ->> 'raw_name'), ''))
      on conflict(inci_name) do update set display_name = coalesce(ingredients.display_name, excluded.display_name)
      returning id into v_ingredient_id;
      insert into public.catalog_product_ingredients(catalog_product_id, ingredient_id, ingredient_order, source_id, confidence, evidence_note)
      values(v_catalog.id, v_ingredient_id, nullif(v_item ->> 'ingredient_order', '')::smallint, v_source_id,
        coalesce((v_item ->> 'confidence')::smallint, 0), nullif(array_to_string(array(select jsonb_array_elements_text(coalesce(v_item -> 'evidence_refs', '[]'::jsonb))), ','), ''))
      on conflict(catalog_product_id, ingredient_id) do update
      set ingredient_order = excluded.ingredient_order, source_id = excluded.source_id,
          confidence = excluded.confidence, evidence_note = excluded.evidence_note;
    end loop;
  end if;
  select count(*) into v_ingredient_count from public.catalog_product_ingredients
  where catalog_product_id = v_catalog.id;

  update public.catalog_products set category = p_category, subcategory = p_subcategory,
    product_type = p_product_type, primary_source_id = v_source_id,
    confidence = coalesce(v_draft.overall_confidence, v_catalog.confidence), updated_at = now()
  where id = v_catalog.id;

  v_result := jsonb_build_object('publication_kind', 'narrow_runtime_v01',
    'catalog_product_id', v_catalog.id, 'draft_id', v_draft.id,
    'primary_source_id', v_source_id, 'primary_source_created', v_source_created,
    'ingredient_count', v_ingredient_count,
    'ingredients_status', v_draft.research_payload -> 'ingredients' ->> 'status',
    'status', 'verified', 'published_at', now());
  insert into public.catalog_product_research_draft_publications(draft_id, catalog_product_id, published_by, result)
  values(v_draft.id, v_catalog.id, p_published_by, v_result);

  -- Final state change: all prerequisite writes and the audit row must exist.
  update public.catalog_products set status = 'verified', updated_at = now() where id = v_catalog.id;
  return v_result;
end;
$$;
