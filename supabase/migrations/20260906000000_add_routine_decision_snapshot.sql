-- Preserve generation-time routine decision facts alongside the saved plan.
-- NULL explicitly denotes a routine created before Decision Snapshot v1.

alter table public.routines
add column decision_snapshot jsonb null check (
  decision_snapshot is null
  or jsonb_typeof(decision_snapshot) = 'object'
);

drop function public.replace_daily_routine(date, text, jsonb, jsonb, jsonb, jsonb);

create or replace function public.replace_daily_routine(
  p_routine_date date,
  p_period text,
  p_skin_snapshot jsonb,
  p_weather_snapshot jsonb,
  p_decision_snapshot jsonb,
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
    or jsonb_typeof(p_decision_snapshot) <> 'object'
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
      'STEP_LIMIT_REMOVED',
      'RECENT_HIGH_REACTION_HARD_BLOCK',
      'AVOID_INGREDIENT_MATCH'
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
    decision_snapshot,
    excluded_products,
    status
  ) values (
    (select auth.uid()),
    p_routine_date,
    p_period,
    p_skin_snapshot,
    p_weather_snapshot,
    p_decision_snapshot,
    p_excluded_products,
    'generated'
  )
  on conflict (user_id, routine_date, period) do update set
    skin_snapshot = excluded.skin_snapshot,
    weather_snapshot = excluded.weather_snapshot,
    decision_snapshot = excluded.decision_snapshot,
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
    select 1
    from public.user_owned_products
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

revoke all on function public.replace_daily_routine(date, text, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.replace_daily_routine(date, text, jsonb, jsonb, jsonb, jsonb, jsonb) from anon;
grant execute on function public.replace_daily_routine(date, text, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
