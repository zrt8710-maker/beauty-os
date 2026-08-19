-- Fix PostgreSQL polymorphic least/greatest resolution without changing RPC
-- signatures, permissions, RLS, or business behavior.

create or replace function public.save_product_draft_match(
  p_draft_id uuid,
  p_candidate_catalog_product_id uuid,
  p_match_source text
)
returns setof public.product_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_record public.product_drafts%rowtype;
  candidate_record public.catalog_products%rowtype;
  normalized_match_count integer;
  resolved_confidence smallint;
  resolved_evidence text;
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

  if p_candidate_catalog_product_id is null then
    if p_match_source is not null then
      raise exception 'INVALID_EMPTY_DRAFT_MATCH' using errcode = '23514';
    end if;

    return query
    update public.product_drafts
    set
      candidate_catalog_product_id = null,
      match_source = null,
      match_confidence = null,
      match_evidence = null,
      updated_at = now()
    where id = draft_record.id
    returning *;
    return;
  end if;

  select *
  into candidate_record
  from public.catalog_products
  where id = p_candidate_catalog_product_id
    and status = 'verified';

  if not found then
    raise exception 'VERIFIED_CATALOG_CANDIDATE_NOT_FOUND' using errcode = '23514';
  end if;

  if p_match_source = 'barcode_exact' then
    if draft_record.barcode is null
      or candidate_record.barcode is distinct from draft_record.barcode then
      raise exception 'INVALID_BARCODE_MATCH' using errcode = '23514';
    end if;
    resolved_confidence := 100;
    resolved_evidence := '条码精确匹配已验证目录产品。';
  elsif p_match_source = 'normalized_name_exact' then
    if draft_record.brand_name is null
      or draft_record.product_name is null
      or public.normalize_product_match_text(candidate_record.brand_name)
        <> public.normalize_product_match_text(draft_record.brand_name)
      or public.normalize_product_match_text(candidate_record.product_name)
        <> public.normalize_product_match_text(draft_record.product_name) then
      raise exception 'INVALID_NORMALIZED_NAME_MATCH' using errcode = '23514';
    end if;

    select count(*)
    into normalized_match_count
    from public.catalog_products
    where status = 'verified'
      and public.normalize_product_match_text(brand_name)
        = public.normalize_product_match_text(draft_record.brand_name)
      and public.normalize_product_match_text(product_name)
        = public.normalize_product_match_text(draft_record.product_name);

    if normalized_match_count <> 1 then
      raise exception 'NORMALIZED_NAME_MATCH_NOT_UNIQUE' using errcode = '23514';
    end if;
    resolved_confidence := pg_catalog.least(
      90::smallint,
      candidate_record.confidence
    );
    resolved_evidence := '品牌与产品名称标准化后精确匹配。';
  else
    raise exception 'INVALID_DRAFT_MATCH_SOURCE' using errcode = '23514';
  end if;

  return query
  update public.product_drafts
  set
    candidate_catalog_product_id = candidate_record.id,
    match_source = p_match_source,
    match_confidence = resolved_confidence,
    match_evidence = resolved_evidence,
    updated_at = now()
  where id = draft_record.id
  returning *;
end;
$$;

create or replace function public.persist_purchase_analysis(
  p_candidate_product_id uuid,
  p_candidate_snapshot jsonb,
  p_inventory_snapshot jsonb,
  p_goal_snapshot jsonb,
  p_duplicate_score smallint,
  p_gap_score smallint,
  p_compatibility_score smallint,
  p_usage_probability_score smallint,
  p_risk_score smallint,
  p_final_score smallint,
  p_decision text,
  p_evidence jsonb,
  p_unknowns jsonb,
  p_reason_codes text[]
)
returns setof public.purchase_analyses
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_final_score smallint;
  expected_decision text;
  has_critical_unknown boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_candidate_product_id is not null and not exists (
    select 1
    from public.catalog_products
    where id = p_candidate_product_id
      and status = 'verified'
  ) then
    raise exception 'VERIFIED_CATALOG_CANDIDATE_NOT_FOUND' using errcode = '23514';
  end if;

  expected_final_score := pg_catalog.greatest(
    0::smallint,
    pg_catalog.least(
      100::smallint,
      pg_catalog.round(
        p_duplicate_score * 0.30
        + p_gap_score * 0.20
        + p_compatibility_score * 0.20
        + p_usage_probability_score * 0.10
        + (100 - p_risk_score) * 0.20
      )::smallint
    )
  );

  if p_final_score is distinct from expected_final_score then
    raise exception 'PURCHASE_FINAL_SCORE_MISMATCH' using errcode = '23514';
  end if;

  has_critical_unknown := p_reason_codes && array[
    'MISSING_PROFILE',
    'MISSING_INGREDIENT_DATA',
    'LOW_CATALOG_CONFIDENCE'
  ]::text[];
  expected_decision := case
    when has_critical_unknown then 'insufficient_data'
    when expected_final_score >= 90 then 'consider_buy'
    when expected_final_score >= 60 then 'wait'
    else 'do_not_buy'
  end;

  if p_decision is distinct from expected_decision then
    raise exception 'PURCHASE_DECISION_MISMATCH' using errcode = '23514';
  end if;

  return query
  insert into public.purchase_analyses (
    user_id,
    candidate_product_id,
    candidate_snapshot,
    inventory_snapshot,
    goal_snapshot,
    duplicate_score,
    gap_score,
    compatibility_score,
    usage_probability_score,
    risk_score,
    final_score,
    decision,
    evidence,
    unknowns,
    reason_codes
  ) values (
    (select auth.uid()),
    p_candidate_product_id,
    p_candidate_snapshot,
    p_inventory_snapshot,
    p_goal_snapshot,
    p_duplicate_score,
    p_gap_score,
    p_compatibility_score,
    p_usage_probability_score,
    p_risk_score,
    p_final_score,
    p_decision,
    p_evidence,
    p_unknowns,
    p_reason_codes
  )
  returning *;
end;
$$;
