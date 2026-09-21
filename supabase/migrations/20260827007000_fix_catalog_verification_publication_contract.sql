alter function public.publish_approved_research_draft_v01(uuid, uuid)
rename to publish_approved_research_draft_unsafe_v01;

create function public.publish_approved_research_draft_v01(p_draft_id uuid, p_published_by uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d public.catalog_product_research_drafts%rowtype; c public.catalog_products%rowtype; v_type text; v_existing jsonb; missing_fields jsonb := '[]'::jsonb;
begin
  select * into d from public.catalog_product_research_drafts where id=p_draft_id for update;
  if not found then raise exception 'RESEARCH_DRAFT_NOT_FOUND' using errcode='P0002'; end if;
  if d.status <> 'approved' then raise exception 'RESEARCH_DRAFT_NOT_APPROVED' using errcode='23514'; end if;
  select * into c from public.catalog_products where id=d.catalog_product_id for update;
  if not found then raise exception 'CATALOG_PRODUCT_NOT_FOUND' using errcode='P0002'; end if;
  select publication.result into v_existing from public.catalog_product_research_draft_publications publication where publication.draft_id=d.id;
  if found then return v_existing || jsonb_build_object('idempotent',true); end if;
  v_type := coalesce(d.research_payload->'product_type'->>'value', c.product_type);
  if c.category is null then missing_fields := missing_fields || '"category"'::jsonb; end if;
  if c.subcategory is null then missing_fields := missing_fields || '"subcategory"'::jsonb; end if;
  if c.primary_source_id is null then missing_fields := missing_fields || '"primary_source_id"'::jsonb; end if;
  if v_type is null then missing_fields := missing_fields || '"product_type"'::jsonb; end if;
  if jsonb_array_length(missing_fields) > 0 then return jsonb_build_object('status','verification_incomplete','catalog_product_id',c.id,'missing_fields',missing_fields); end if;
  update public.catalog_products set product_type=v_type where id=c.id;
  return public.publish_approved_research_draft_unsafe_v01(p_draft_id,p_published_by);
end; $$;
revoke all on function public.publish_approved_research_draft_v01(uuid,uuid) from public, anon, authenticated;
grant execute on function public.publish_approved_research_draft_v01(uuid,uuid) to service_role;
