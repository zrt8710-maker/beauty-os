create or replace function public.enforce_product_draft_state_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'pending' then
    if new.status in ('pending', 'rejected') then
      return new;
    end if;

    if new.status = 'confirmed'
      and pg_catalog.current_setting(
        'beauty_os.confirming_product_draft',
        true
      ) = 'true' then
      return new;
    end if;

    raise exception 'PENDING_DRAFT_MUST_USE_CONFIRM_FUNCTION'
      using errcode = '42501';
  end if;

  if old.status = 'confirmed' then
    raise exception 'CONFIRMED_DRAFT_IMMUTABLE'
      using errcode = '55000';
  end if;

  if old.status = 'rejected' then
    raise exception 'REJECTED_DRAFT_IMMUTABLE'
      using errcode = '55000';
  end if;

  raise exception 'INVALID_PRODUCT_DRAFT_STATUS'
    using errcode = '23514';
end;
$$;

revoke all on function public.enforce_product_draft_state_transition() from public;

create trigger product_drafts_enforce_state_transition
before update on public.product_drafts
for each row execute function public.enforce_product_draft_state_transition();

create or replace function public.confirm_product_draft(p_draft_id uuid)
returns table (
  created_product_id uuid,
  created_owned_product_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  draft_record public.product_drafts%rowtype;
  upload_record public.upload_assets%rowtype;
  new_product_id uuid;
  new_owned_product_id uuid;
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

  if draft_record.product_name is null
    or draft_record.category is null
    or draft_record.subcategory is null
    or draft_record.product_type is null then
    raise exception 'DRAFT_INCOMPLETE' using errcode = '23514';
  end if;

  select *
  into upload_record
  from public.upload_assets
  where id = draft_record.upload_asset_id
    and user_id = (select auth.uid())
    and status = 'ready'
    and product_id is null
  for update;

  if not found then
    raise exception 'UPLOAD_NOT_READY_OR_ALREADY_LINKED' using errcode = '23514';
  end if;

  insert into public.products (
    brand_name,
    product_name,
    category,
    subcategory,
    product_type,
    created_by_user_id
  )
  values (
    draft_record.brand_name,
    draft_record.product_name,
    draft_record.category,
    draft_record.subcategory,
    draft_record.product_type,
    (select auth.uid())
  )
  returning id into new_product_id;

  insert into public.user_owned_products (
    user_id,
    product_id,
    status,
    quantity_remaining_percent,
    notes
  )
  values (
    (select auth.uid()),
    new_product_id,
    'unopened',
    100,
    draft_record.notes
  )
  returning id into new_owned_product_id;

  update public.upload_assets
  set product_id = new_product_id
  where id = upload_record.id
    and user_id = (select auth.uid());

  perform pg_catalog.set_config(
    'beauty_os.confirming_product_draft',
    'true',
    true
  );

  update public.product_drafts
  set
    status = 'confirmed',
    updated_at = now()
  where id = draft_record.id
    and user_id = (select auth.uid());

  return query
  select new_product_id, new_owned_product_id;
end;
$$;

revoke all on function public.confirm_product_draft(uuid) from public;
revoke all on function public.confirm_product_draft(uuid) from anon;
grant execute on function public.confirm_product_draft(uuid) to authenticated;
