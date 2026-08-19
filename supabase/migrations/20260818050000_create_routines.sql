alter table public.user_owned_products
add column expires_on date;

create index user_owned_products_user_expiry_idx
on public.user_owned_products (user_id, expires_on)
where expires_on is not null and archived_at is null;

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  routine_date date not null,
  period text not null check (period in ('am', 'pm')),
  skin_snapshot jsonb not null default '{}'::jsonb check (
    jsonb_typeof(skin_snapshot) = 'object'
  ),
  weather_snapshot jsonb not null default '{}'::jsonb check (
    jsonb_typeof(weather_snapshot) = 'object'
  ),
  status text not null default 'generated' check (
    status in ('generated', 'completed')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, routine_date, period)
);

create index routines_user_date_idx
on public.routines (user_id, routine_date desc, period);

alter table public.routines enable row level security;

revoke all on table public.routines from anon;
grant select, insert, update, delete on table public.routines to authenticated;

create policy "routines_select_own"
on public.routines for select to authenticated
using ((select auth.uid()) = user_id);

create policy "routines_insert_own"
on public.routines for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "routines_update_own"
on public.routines for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "routines_delete_own"
on public.routines for delete to authenticated
using ((select auth.uid()) = user_id);

create table public.routine_steps (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines (id) on delete cascade,
  owned_product_id uuid not null references public.user_owned_products (id) on delete restrict,
  step_order smallint not null check (step_order between 1 and 20),
  role text not null check (
    role in ('cleanse', 'hydrate', 'treat', 'moisturize', 'sun_protection')
  ),
  reason text not null check (char_length(reason) between 1 and 500),
  score smallint not null check (score between 0 and 100),
  feedback_rating smallint check (feedback_rating between 1 and 5),
  feedback_notes text check (
    feedback_notes is null or char_length(feedback_notes) <= 1000
  ),
  feedback_at timestamptz,
  created_at timestamptz not null default now(),
  unique (routine_id, step_order),
  unique (routine_id, owned_product_id)
);

create index routine_steps_routine_order_idx
on public.routine_steps (routine_id, step_order);

create index routine_steps_owned_feedback_idx
on public.routine_steps (owned_product_id, feedback_at desc)
where feedback_rating is not null;

alter table public.routine_steps enable row level security;

revoke all on table public.routine_steps from anon;
grant select, insert, update, delete on table public.routine_steps to authenticated;

create policy "routine_steps_select_own"
on public.routine_steps for select to authenticated
using (
  exists (
    select 1 from public.routines
    where routines.id = routine_steps.routine_id
      and routines.user_id = (select auth.uid())
  )
);

create policy "routine_steps_insert_own"
on public.routine_steps for insert to authenticated
with check (
  exists (
    select 1 from public.routines
    where routines.id = routine_steps.routine_id
      and routines.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.user_owned_products
    where user_owned_products.id = routine_steps.owned_product_id
      and user_owned_products.user_id = (select auth.uid())
  )
);

create policy "routine_steps_update_own"
on public.routine_steps for update to authenticated
using (
  exists (
    select 1 from public.routines
    where routines.id = routine_steps.routine_id
      and routines.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.routines
    where routines.id = routine_steps.routine_id
      and routines.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.user_owned_products
    where user_owned_products.id = routine_steps.owned_product_id
      and user_owned_products.user_id = (select auth.uid())
  )
);

create policy "routine_steps_delete_own"
on public.routine_steps for delete to authenticated
using (
  exists (
    select 1 from public.routines
    where routines.id = routine_steps.routine_id
      and routines.user_id = (select auth.uid())
  )
);

create or replace function public.replace_daily_routine(
  p_routine_date date,
  p_period text,
  p_skin_snapshot jsonb,
  p_weather_snapshot jsonb,
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
    or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'INVALID_ROUTINE_INPUT' using errcode = '23514';
  end if;

  insert into public.routines (
    user_id, routine_date, period, skin_snapshot, weather_snapshot, status
  ) values (
    (select auth.uid()), p_routine_date, p_period,
    p_skin_snapshot, p_weather_snapshot, 'generated'
  )
  on conflict (user_id, routine_date, period) do update set
    skin_snapshot = excluded.skin_snapshot,
    weather_snapshot = excluded.weather_snapshot,
    status = 'generated',
    updated_at = now()
  returning id into target_routine_id;

  delete from public.routine_steps where routine_id = target_routine_id;

  insert into public.routine_steps (
    routine_id, owned_product_id, step_order, role, reason, score
  )
  select
    target_routine_id,
    (item->>'owned_product_id')::uuid,
    (item->>'step_order')::smallint,
    item->>'role',
    item->>'reason',
    (item->>'score')::smallint
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

revoke all on function public.replace_daily_routine(date, text, jsonb, jsonb, jsonb) from public;
revoke all on function public.replace_daily_routine(date, text, jsonb, jsonb, jsonb) from anon;
grant execute on function public.replace_daily_routine(date, text, jsonb, jsonb, jsonb) to authenticated;
