create or replace function public.publish_approved_research_draft_v01(p_draft_id uuid, p_published_by uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d public.catalog_product_research_drafts%rowtype; c public.catalog_products%rowtype; p jsonb; item jsonb; ingredient_id uuid; capability_id uuid; v_result jsonb; warnings jsonb := '[]'::jsonb; source jsonb;
begin
  select * into d from public.catalog_product_research_drafts where id=p_draft_id for update;
  if not found then raise exception 'RESEARCH_DRAFT_NOT_FOUND' using errcode='P0002'; end if;
  if d.status <> 'approved' then raise exception 'RESEARCH_DRAFT_NOT_APPROVED' using errcode='23514'; end if;
  select * into c from public.catalog_products where id=d.catalog_product_id for update;
  if not found then raise exception 'CATALOG_PRODUCT_NOT_FOUND' using errcode='P0002'; end if;
  select publication.result into v_result from public.catalog_product_research_draft_publications as publication where publication.draft_id=d.id;
  if found then return v_result || jsonb_build_object('idempotent',true); end if;
  p:=d.research_payload;
  if p->'ingredients'->>'status' = 'conflicted' then warnings := warnings || jsonb_build_array('ingredients_conflicted_skipped');
  elsif p->'ingredients'->>'status' = 'unknown' then warnings := warnings || jsonb_build_array('ingredients_unknown_skipped');
  else for item in select value from jsonb_array_elements(coalesce(p->'ingredients'->'items','[]'::jsonb)) loop
    if item->>'normalized_name' is not null then
      insert into public.ingredients(inci_name,display_name) values(item->>'normalized_name',item->>'raw_name') on conflict(inci_name) do update set display_name=coalesce(ingredients.display_name,excluded.display_name) returning id into ingredient_id;
      insert into public.catalog_product_ingredients(catalog_product_id,ingredient_id,ingredient_order,source_id,confidence,evidence_note) values(c.id,ingredient_id,nullif(item->>'ingredient_order','')::smallint,c.primary_source_id,coalesce((item->>'confidence')::smallint,0),array_to_string(array(select jsonb_array_elements_text(coalesce(item->'evidence_refs','[]'::jsonb))),',')) on conflict(catalog_product_id,ingredient_id) do update set ingredient_order=excluded.ingredient_order,confidence=excluded.confidence,evidence_note=excluded.evidence_note;
    end if;
  end loop; end if;
  for item in select value from jsonb_array_elements(coalesce(p->'care_role_candidates','[]'::jsonb)) loop
    if item->>'basis'='external_evidence' and item->>'confidence' is not null and jsonb_array_length(coalesce(item->'evidence_refs','[]'::jsonb))>0 then
      select value into source from jsonb_array_elements(coalesce(p->'sources','[]'::jsonb)) where value->>'source_id'=(item->'evidence_refs'->>0) limit 1;
      insert into public.catalog_product_care_roles(catalog_product_id,care_role_code,assignment_kind,status,confidence,assessment_note,source_locator,reviewed_at) values(c.id,item->>'code','secondary','verified',(item->>'confidence')::smallint,'Published from approved research draft',source->>'url',now()) on conflict(catalog_product_id,care_role_code) do update set status='verified',confidence=excluded.confidence,assessment_note=excluded.assessment_note,source_locator=excluded.source_locator,reviewed_at=excluded.reviewed_at,updated_at=now();
    end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(p->'capability_candidates','[]'::jsonb)) loop
    if item->>'basis'='external_evidence' and item->>'confidence' is not null and jsonb_array_length(coalesce(item->'evidence_refs','[]'::jsonb))>0 then
      insert into public.catalog_product_capabilities(catalog_product_id,capability_code,status,confidence,assessment_note,reviewed_at) values(c.id,item->>'code','verified',(item->>'confidence')::smallint,'Published from approved research draft',now()) on conflict(catalog_product_id,capability_code) do update set status='verified',confidence=excluded.confidence,assessment_note=excluded.assessment_note,reviewed_at=excluded.reviewed_at,updated_at=now() returning id into capability_id;
      delete from public.product_capability_evidence where product_capability_id=capability_id;
      for source in select value from jsonb_array_elements(coalesce(p->'sources','[]'::jsonb)) where value->>'source_id' in (select jsonb_array_elements_text(item->'evidence_refs')) loop
        insert into public.product_capability_evidence(product_capability_id,evidence_type,direction,evidence_note,source_locator,confidence,review_status) values(capability_id,'official_product_description','supports',coalesce(source->>'title','Approved research evidence'),source->>'url',(item->>'confidence')::smallint,'verified');
      end loop;
    end if;
  end loop;
  v_result:=jsonb_build_object('draft_id',d.id,'catalog_product_id',c.id,'ingredients_skipped',p->'ingredients'->>'status' in ('unknown','conflicted'),'warnings',warnings,'published_at',now());
  insert into public.catalog_product_research_draft_publications(draft_id,catalog_product_id,published_by,result) values(d.id,c.id,p_published_by,v_result);
  update public.catalog_products set product_type=coalesce(p->'product_type'->>'value',c.product_type),confidence=coalesce(d.overall_confidence,c.confidence),status='verified',updated_at=now() where id=c.id;
  return v_result;
end; $$;
