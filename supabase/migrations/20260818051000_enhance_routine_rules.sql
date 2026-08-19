alter table public.routines
add column excluded_products jsonb not null default '[]'::jsonb check (
  jsonb_typeof(excluded_products) = 'array'
);

alter table public.products
drop constraint if exists products_product_type_check;

alter table public.products
add constraint products_product_type_check check (
  product_type in (
    'makeup_remover', 'cleanser', 'toner', 'essence', 'serum', 'treatment',
    'moisturizer', 'face_oil', 'sunscreen', 'mask', 'eye_care', 'lip_care',
    'primer', 'foundation', 'bb_cc_cream', 'concealer', 'powder', 'blush',
    'contour', 'highlighter', 'eyeshadow', 'eyeliner', 'mascara',
    'brow_product', 'lip_color', 'setting_spray', 'body_cleanser',
    'body_lotion', 'body_treatment', 'shampoo', 'conditioner',
    'hair_treatment', 'hair_styling', 'perfume', 'body_mist', 'applicator',
    'device', 'other'
  )
);

alter table public.product_drafts
drop constraint if exists product_drafts_product_type_check;

alter table public.product_drafts
add constraint product_drafts_product_type_check check (
  product_type is null or product_type in (
    'makeup_remover', 'cleanser', 'toner', 'essence', 'serum', 'treatment',
    'moisturizer', 'face_oil', 'sunscreen', 'mask', 'eye_care', 'lip_care',
    'primer', 'foundation', 'bb_cc_cream', 'concealer', 'powder', 'blush',
    'contour', 'highlighter', 'eyeshadow', 'eyeliner', 'mascara',
    'brow_product', 'lip_color', 'setting_spray', 'body_cleanser',
    'body_lotion', 'body_treatment', 'shampoo', 'conditioner',
    'hair_treatment', 'hair_styling', 'perfume', 'body_mist', 'applicator',
    'device', 'other'
  )
);

alter table public.routine_steps
drop constraint if exists routine_steps_role_check;

update public.routine_steps
set role = case role
  when 'cleanse' then 'cleanser'
  when 'hydrate' then 'hydration'
  when 'treat' then 'treatment'
  when 'moisturize' then 'moisturizer'
  when 'sun_protection' then 'sunscreen'
  else role
end;

alter table public.routine_steps
add constraint routine_steps_role_check check (
  role in (
    'remover',
    'cleanser',
    'hydration',
    'treatment',
    'moisturizer',
    'sunscreen'
  )
);

alter table public.routine_steps
add column reason_code text not null default 'BASE_ROUTINE_SELECTED' check (
  reason_code in (
    'BASE_ROUTINE_SELECTED',
    'SKIN_DRYNESS_FIT',
    'HIGH_SENSITIVITY_BASIC_CARE',
    'HIGH_UV_SUNSCREEN_PRIORITY',
    'RECENT_POSITIVE_FEEDBACK',
    'INVENTORY_USE_FIRST'
  )
),
add column score_breakdown jsonb not null default '{}'::jsonb check (
  jsonb_typeof(score_breakdown) = 'object'
);

revoke all on function public.replace_daily_routine(date, text, jsonb, jsonb, jsonb) from public;
revoke all on function public.replace_daily_routine(date, text, jsonb, jsonb, jsonb) from anon;
revoke all on function public.replace_daily_routine(date, text, jsonb, jsonb, jsonb) from authenticated;
drop function public.replace_daily_routine(date, text, jsonb, jsonb, jsonb);

create function public.replace_daily_routine(
  p_routine_date date,
  p_period text,
  p_skin_snapshot jsonb,
  p_weather_snapshot jsonb,
  p_excluded_products jsonb,
  p_steps jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_routine_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_period not in ('am', 'pm')
    or jsonb_typeof(p_skin_snapshot) <> 'object'
    or jsonb_typeof(p_weather_snapshot) <> 'object'
    or jsonb_typeof(p_excluded_products) <> 'array'
    or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'INVALID_ROUTINE_INPUT' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_excluded_products) as item
    where not exists (
      select 1
      from public.user_owned_products
      where user_owned_products.id = (item->>'owned_product_id')::uuid
        and user_owned_products.user_id = (select auth.uid())
    )
    or coalesce(item->>'reason_code', '') not in (
      'PRODUCT_NOT_ACTIVE',
      'PRODUCT_ARCHIVED',
      'PRODUCT_FINISHED',
      'PRODUCT_EMPTY',
      'PRODUCT_EXPIRED',
      'NON_SKINCARE_PRODUCT',
      'UNSUPPORTED_PRODUCT_TYPE',
      'PERIOD_NOT_APPLICABLE',
      'HIGH_SENSITIVITY_REDUCE_ACTIVE',
      'DUPLICATE_ROLE_REMOVED',
      'OPTIONAL_SLOT_REPLACED',
      'STEP_LIMIT_REMOVED'
    )
  ) then
    raise exception 'ROUTINE_EXCLUDES_UNOWNED_PRODUCT' using errcode = '42501';
  end if;

  insert into public.routines (
    user_id,
    routine_date,
    period,
    skin_snapshot,
    weather_snapshot,
    excluded_products,
    status
  ) values (
    (select auth.uid()),
    p_routine_date,
    p_period,
    p_skin_snapshot,
    p_weather_snapshot,
    p_excluded_products,
    'generated'
  )
  on conflict (user_id, routine_date, period) do update set
    skin_snapshot = excluded.skin_snapshot,
    weather_snapshot = excluded.weather_snapshot,
    excluded_products = excluded.excluded_products,
    status = 'generated',
    updated_at = now()
  returning id into target_routine_id;

  delete from public.routine_steps where routine_id = target_routine_id;

  insert into public.routine_steps (
    routine_id,
    owned_product_id,
    step_order,
    role,
    reason,
    reason_code,
    score,
    score_breakdown
  )
  select
    target_routine_id,
    (item->>'owned_product_id')::uuid,
    (item->>'step_order')::smallint,
    item->>'role',
    item->>'reason',
    item->>'reason_code',
    (item->>'score')::smallint,
    item->'score_breakdown'
  from jsonb_array_elements(p_steps) as item
  where exists (
    select 1 from public.user_owned_products
    where user_owned_products.id = (item->>'owned_product_id')::uuid
      and user_owned_products.user_id = (select auth.uid())
  );

  if (select count(*) from public.routine_steps where routine_id = target_routine_id)
    <> jsonb_array_length(p_steps) then
    raise exception 'ROUTINE_CONTAINS_UNOWNED_PRODUCT' using errcode = '42501';
  end if;

  return target_routine_id;
end;
$$;

revoke all on function public.replace_daily_routine(date, text, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.replace_daily_routine(date, text, jsonb, jsonb, jsonb, jsonb) from anon;
grant execute on function public.replace_daily_routine(date, text, jsonb, jsonb, jsonb, jsonb) to authenticated;
