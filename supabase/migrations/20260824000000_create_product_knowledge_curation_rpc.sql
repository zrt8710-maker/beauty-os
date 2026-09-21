create function public.apply_product_knowledge_curation_v01(
  p_input jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_catalog_product_id uuid;
  v_catalog_status text;
  v_roles jsonb;
  v_capabilities jsonb;
  v_role jsonb;
  v_capability jsonb;
  v_evidence jsonb;
  v_evidence_items jsonb;
  v_care_role_code text;
  v_capability_code text;
  v_assignment_status text;
  v_role_assignment_id uuid;
  v_product_capability_id uuid;
  v_role_assignment_ids jsonb := '{}'::jsonb;
  v_capability_assignment_ids jsonb := '{}'::jsonb;
  v_evidence_counts jsonb := '{}'::jsonb;
  v_capability_evidence_count integer;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'INVALID_PRODUCT_KNOWLEDGE_CURATION_INPUT'
      using errcode = '22023';
  end if;

  if p_input ->> 'schema_version'
    is distinct from 'product-knowledge-curation/v0.1' then
    raise exception 'UNSUPPORTED_PRODUCT_KNOWLEDGE_CURATION_SCHEMA_VERSION'
      using errcode = '22023';
  end if;

  if p_input ->> 'catalog_product_id' is null then
    raise exception 'CATALOG_PRODUCT_ID_REQUIRED'
      using errcode = '22023';
  end if;

  begin
    v_catalog_product_id := (p_input ->> 'catalog_product_id')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'INVALID_CATALOG_PRODUCT_ID'
        using errcode = '22023';
  end;

  v_roles := coalesce(p_input -> 'roles', '[]'::jsonb);
  v_capabilities := coalesce(p_input -> 'capabilities', '[]'::jsonb);

  if jsonb_typeof(v_roles) <> 'array' then
    raise exception 'INVALID_CARE_ROLE_ASSIGNMENTS'
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_capabilities) <> 'array' then
    raise exception 'INVALID_CAPABILITY_ASSESSMENTS'
      using errcode = '22023';
  end if;

  select catalog_product.status
  into v_catalog_status
  from public.catalog_products as catalog_product
  where catalog_product.id = v_catalog_product_id
  for update;

  if not found then
    raise exception 'CATALOG_PRODUCT_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if v_catalog_status <> 'verified' then
    raise exception 'CATALOG_PRODUCT_NOT_VERIFIED'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_roles) as role_item(value)
    group by role_item.value ->> 'care_role_code'
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_CARE_ROLE_ASSIGNMENT'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_capabilities) as capability_item(value)
    group by capability_item.value ->> 'capability_code'
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_CAPABILITY_ASSESSMENT'
      using errcode = '22023';
  end if;

  for v_role in
    select role_item.value
    from jsonb_array_elements(v_roles) as role_item(value)
  loop
    if jsonb_typeof(v_role) <> 'object' then
      raise exception 'INVALID_CARE_ROLE_ASSIGNMENT'
        using errcode = '22023';
    end if;

    v_care_role_code := v_role ->> 'care_role_code';
    v_assignment_status := v_role ->> 'status';

    if v_care_role_code is null then
      raise exception 'CARE_ROLE_CODE_REQUIRED'
        using errcode = '22023';
    end if;

    perform 1
    from public.care_roles
    where code = v_care_role_code
      and is_active = true;

    if not found then
      raise exception 'ACTIVE_CARE_ROLE_NOT_FOUND:%', v_care_role_code
        using errcode = '23503';
    end if;

    if v_assignment_status not in ('verified', 'candidate', 'unknown') then
      raise exception 'INVALID_CARE_ROLE_STATUS:%', v_care_role_code
        using errcode = '22023';
    end if;

    if v_role ->> 'assignment_kind' not in ('primary', 'secondary') then
      raise exception 'INVALID_CARE_ROLE_ASSIGNMENT_KIND:%', v_care_role_code
        using errcode = '22023';
    end if;

    if v_assignment_status = 'verified'
      and v_role ->> 'confidence' is null then
      raise exception 'VERIFIED_CARE_ROLE_CONFIDENCE_REQUIRED:%', v_care_role_code
        using errcode = '23514';
    end if;
  end loop;

  for v_capability in
    select capability_item.value
    from jsonb_array_elements(v_capabilities) as capability_item(value)
  loop
    if jsonb_typeof(v_capability) <> 'object' then
      raise exception 'INVALID_CAPABILITY_ASSESSMENT'
        using errcode = '22023';
    end if;

    v_capability_code := v_capability ->> 'capability_code';
    v_assignment_status := v_capability ->> 'status';
    v_evidence_items := coalesce(v_capability -> 'evidence', '[]'::jsonb);

    if v_capability_code is null then
      raise exception 'CAPABILITY_CODE_REQUIRED'
        using errcode = '22023';
    end if;

    if jsonb_typeof(v_evidence_items) <> 'array' then
      raise exception 'INVALID_CAPABILITY_EVIDENCE:%', v_capability_code
        using errcode = '22023';
    end if;

    perform 1
    from public.capabilities
    where code = v_capability_code
      and is_active = true;

    if not found then
      raise exception 'ACTIVE_CAPABILITY_NOT_FOUND:%', v_capability_code
        using errcode = '23503';
    end if;

    if v_assignment_status not in ('verified', 'candidate', 'unknown') then
      raise exception 'INVALID_CAPABILITY_STATUS:%', v_capability_code
        using errcode = '22023';
    end if;

    if v_assignment_status = 'verified'
      and v_capability ->> 'confidence' is null then
      raise exception 'VERIFIED_CAPABILITY_CONFIDENCE_REQUIRED:%', v_capability_code
        using errcode = '23514';
    end if;

    if v_assignment_status = 'verified'
      and not exists (
        select 1
        from jsonb_array_elements(v_evidence_items) as evidence_item(value)
        where evidence_item.value ->> 'direction' = 'supports'
          and evidence_item.value ->> 'review_status' = 'verified'
      ) then
      raise exception 'VERIFIED_CAPABILITY_SUPPORTING_EVIDENCE_REQUIRED:%',
        v_capability_code
        using errcode = '23514';
    end if;
  end loop;

  for v_role in
    select role_item.value
    from jsonb_array_elements(v_roles) as role_item(value)
  loop
    v_care_role_code := v_role ->> 'care_role_code';

    insert into public.catalog_product_care_roles (
      catalog_product_id,
      care_role_code,
      assignment_kind,
      status,
      confidence,
      assessment_note,
      source_locator,
      reviewed_at,
      updated_at
    ) values (
      v_catalog_product_id,
      v_care_role_code,
      v_role ->> 'assignment_kind',
      v_role ->> 'status',
      (v_role ->> 'confidence')::smallint,
      v_role ->> 'assessment_note',
      v_role ->> 'source_locator',
      (v_role ->> 'reviewed_at')::timestamptz,
      now()
    )
    on conflict (catalog_product_id, care_role_code) do update
    set assignment_kind = excluded.assignment_kind,
        status = excluded.status,
        confidence = excluded.confidence,
        assessment_note = excluded.assessment_note,
        source_locator = excluded.source_locator,
        reviewed_at = excluded.reviewed_at,
        updated_at = now()
    returning id into v_role_assignment_id;

    v_role_assignment_ids := v_role_assignment_ids
      || jsonb_build_object(v_care_role_code, v_role_assignment_id);
  end loop;

  for v_capability in
    select capability_item.value
    from jsonb_array_elements(v_capabilities) as capability_item(value)
  loop
    v_capability_code := v_capability ->> 'capability_code';
    v_evidence_items := coalesce(v_capability -> 'evidence', '[]'::jsonb);

    insert into public.catalog_product_capabilities (
      catalog_product_id,
      capability_code,
      status,
      confidence,
      assessment_note,
      reviewed_at,
      updated_at
    ) values (
      v_catalog_product_id,
      v_capability_code,
      v_capability ->> 'status',
      (v_capability ->> 'confidence')::smallint,
      v_capability ->> 'assessment_note',
      (v_capability ->> 'reviewed_at')::timestamptz,
      now()
    )
    on conflict (catalog_product_id, capability_code) do update
    set status = excluded.status,
        confidence = excluded.confidence,
        assessment_note = excluded.assessment_note,
        reviewed_at = excluded.reviewed_at,
        updated_at = now()
    returning id into v_product_capability_id;

    delete from public.product_capability_evidence
    where product_capability_id = v_product_capability_id;

    v_capability_evidence_count := 0;

    for v_evidence in
      select evidence_item.value
      from jsonb_array_elements(v_evidence_items) as evidence_item(value)
    loop
      if jsonb_typeof(v_evidence) <> 'object' then
        raise exception 'INVALID_CAPABILITY_EVIDENCE_ITEM:%', v_capability_code
          using errcode = '22023';
      end if;

      insert into public.product_capability_evidence (
        product_capability_id,
        evidence_type,
        direction,
        evidence_note,
        source_locator,
        confidence,
        review_status
      ) values (
        v_product_capability_id,
        v_evidence ->> 'evidence_type',
        v_evidence ->> 'direction',
        v_evidence ->> 'evidence_note',
        v_evidence ->> 'source_locator',
        (v_evidence ->> 'confidence')::smallint,
        v_evidence ->> 'review_status'
      );

      v_capability_evidence_count := v_capability_evidence_count + 1;
    end loop;

    v_capability_assignment_ids := v_capability_assignment_ids
      || jsonb_build_object(v_capability_code, v_product_capability_id);
    v_evidence_counts := v_evidence_counts
      || jsonb_build_object(v_capability_code, v_capability_evidence_count);
  end loop;

  return jsonb_build_object(
    'catalog_product_id', v_catalog_product_id,
    'role_assignment_ids', v_role_assignment_ids,
    'capability_assignment_ids', v_capability_assignment_ids,
    'evidence_counts', v_evidence_counts
  );
end;
$$;

revoke all on function public.apply_product_knowledge_curation_v01(jsonb)
from public, anon, authenticated;

grant execute on function public.apply_product_knowledge_curation_v01(jsonb)
to service_role;
