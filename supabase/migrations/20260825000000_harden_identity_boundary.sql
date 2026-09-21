create table public.asset_creation_idempotency (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_fingerprint text not null,
  owned_product_id uuid references public.user_owned_products(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);

alter table public.asset_creation_idempotency enable row level security;

create function public.create_owned_product_with_identity_idempotent(
  p_user_id uuid, p_resolution_kind text, p_brand_name text, p_product_name text,
  p_variant_name text, p_barcode text, p_category text, p_subcategory text,
  p_product_type text, p_catalog_product_id uuid, p_status text, p_purchase_date date,
  p_opened_at date, p_expires_on date, p_quantity_remaining_percent smallint,
  p_notes text, p_idempotency_key uuid
)
returns setof public.user_owned_products
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.asset_creation_idempotency%rowtype;
  created public.user_owned_products%rowtype;
  fingerprint text := md5(concat_ws('|', p_resolution_kind, p_brand_name, p_product_name,
    p_variant_name, p_barcode, p_category, p_product_type, p_catalog_product_id::text));
begin
  if auth.role() <> 'service_role'
    and (auth.uid() is null or auth.uid() is distinct from p_user_id) then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  insert into public.asset_creation_idempotency (
    user_id, idempotency_key, request_fingerprint, owned_product_id
  ) values (p_user_id, p_idempotency_key, fingerprint, null)
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
    p_barcode, p_category, p_subcategory, p_product_type, p_catalog_product_id,
    p_status, p_purchase_date, p_opened_at, p_expires_on,
    p_quantity_remaining_percent, p_notes
  ) limit 1;

  update public.asset_creation_idempotency set owned_product_id = created.id
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
  return next created;
end;
$$;

revoke all on function public.create_owned_product_with_identity_idempotent(
  uuid, text, text, text, text, text, text, text, text, uuid, text, date, date,
  date, smallint, text, uuid
) from public, anon;
grant execute on function public.create_owned_product_with_identity_idempotent(
  uuid, text, text, text, text, text, text, text, text, uuid, text, date, date,
  date, smallint, text, uuid
) to service_role;

revoke execute on function public.create_owned_product_with_identity(
  uuid, text, text, text, text, text, text, text, text, uuid, text, date,
  date, date, smallint, text
) from authenticated;
grant execute on function public.create_owned_product_with_identity(
  uuid, text, text, text, text, text, text, text, text, uuid, text, date,
  date, date, smallint, text
) to service_role;
