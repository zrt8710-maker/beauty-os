alter table public.product_drafts
  add column barcode text check (barcode is null or char_length(barcode) between 8 and 32),
  add column candidate_catalog_product_id uuid references public.catalog_products (id) on delete set null,
  add column match_source text check (match_source is null or match_source in ('barcode_exact', 'normalized_name_exact')),
  add column match_confidence smallint check (match_confidence is null or match_confidence between 0 and 100),
  add column match_evidence text check (match_evidence is null or char_length(match_evidence) between 1 and 1000),
  add column knowledge_confirmed_at timestamptz;

create index product_drafts_candidate_catalog_idx
on public.product_drafts (candidate_catalog_product_id)
where candidate_catalog_product_id is not null;

alter table public.products
  add column catalog_product_id uuid references public.catalog_products (id) on delete set null;

create index products_catalog_product_idx
on public.products (catalog_product_id)
where catalog_product_id is not null;

drop function public.confirm_product_draft(uuid);

create function public.confirm_product_draft(
  p_draft_id uuid,
  p_catalog_product_id uuid default null
)
returns table (created_product_id uuid, created_owned_product_id uuid)
language plpgsql security invoker set search_path = ''
as $$
declare
  draft_record public.product_drafts%rowtype;
  upload_record public.upload_assets%rowtype;
  new_product_id uuid;
  new_owned_product_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into draft_record from public.product_drafts where id = p_draft_id and user_id = (select auth.uid()) and status = 'pending' for update;
  if not found then raise exception 'DRAFT_NOT_FOUND_OR_NOT_PENDING' using errcode = 'P0002'; end if;
  if draft_record.product_name is null or draft_record.category is null or draft_record.subcategory is null or draft_record.product_type is null then raise exception 'DRAFT_INCOMPLETE' using errcode = '23514'; end if;
  if p_catalog_product_id is not null and (draft_record.candidate_catalog_product_id is distinct from p_catalog_product_id or not exists (select 1 from public.catalog_products where id = p_catalog_product_id and status = 'verified')) then raise exception 'INVALID_CATALOG_CONFIRMATION' using errcode = '23514'; end if;
  select * into upload_record from public.upload_assets where id = draft_record.upload_asset_id and user_id = (select auth.uid()) and status = 'ready' and product_id is null for update;
  if not found then raise exception 'UPLOAD_NOT_READY_OR_ALREADY_LINKED' using errcode = '23514'; end if;
  insert into public.products (brand_name, product_name, category, subcategory, product_type, catalog_product_id, created_by_user_id) values (draft_record.brand_name, draft_record.product_name, draft_record.category, draft_record.subcategory, draft_record.product_type, p_catalog_product_id, (select auth.uid())) returning id into new_product_id;
  insert into public.user_owned_products (user_id, product_id, status, quantity_remaining_percent, notes) values ((select auth.uid()), new_product_id, 'unopened', 100, draft_record.notes) returning id into new_owned_product_id;
  update public.upload_assets set product_id = new_product_id where id = upload_record.id and user_id = (select auth.uid());
  perform pg_catalog.set_config('beauty_os.confirming_product_draft', 'true', true);
  update public.product_drafts set status = 'confirmed', knowledge_confirmed_at = case when p_catalog_product_id is null then null else now() end, updated_at = now() where id = draft_record.id and user_id = (select auth.uid());
  return query select new_product_id, new_owned_product_id;
end;
$$;

revoke all on function public.confirm_product_draft(uuid, uuid) from public, anon;
grant execute on function public.confirm_product_draft(uuid, uuid) to authenticated;
