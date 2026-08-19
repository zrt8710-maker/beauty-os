alter table public.routine_steps
drop constraint if exists routine_steps_reason_code_check;

alter table public.routine_steps
add constraint routine_steps_reason_code_check check (
  reason_code in (
    'BASE_ROUTINE_SELECTED',
    'SKIN_DRYNESS_FIT',
    'HIGH_SENSITIVITY_BASIC_CARE',
    'HIGH_UV_SUNSCREEN_PRIORITY',
    'RECENT_POSITIVE_FEEDBACK',
    'RECENT_HIGH_REACTION_PENALTY',
    'INVENTORY_USE_FIRST'
  )
);

update public.routine_steps
set score_breakdown = (score_breakdown - 'recent_feedback')
  || jsonb_build_object(
    'feedback_score',
    coalesce((score_breakdown->>'recent_feedback')::integer, 0)
  )
where score_breakdown ? 'recent_feedback';

create table public.usage_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  routine_id uuid not null references public.routines (id) on delete restrict,
  used_date date not null,
  period text not null check (period in ('am', 'pm')),
  completion_status text not null check (
    completion_status in ('completed', 'partial', 'skipped')
  ),
  overall_rating smallint check (overall_rating between 1 and 5),
  skin_reaction_level smallint check (skin_reaction_level between 0 and 4),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);

create index usage_history_user_date_idx
on public.usage_history (user_id, used_date desc, created_at desc);

create index usage_history_routine_idx
on public.usage_history (routine_id, created_at desc);

alter table public.usage_history enable row level security;

revoke all on table public.usage_history from anon;
revoke all on table public.usage_history from authenticated;
grant select, insert on table public.usage_history to authenticated;

create policy "usage_history_select_own"
on public.usage_history for select to authenticated
using ((select auth.uid()) = user_id);

create policy "usage_history_insert_own"
on public.usage_history for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.routines
    where routines.id = routine_id
      and routines.user_id = (select auth.uid())
  )
);

create table public.usage_history_products (
  id uuid primary key default gen_random_uuid(),
  usage_history_id uuid not null references public.usage_history (id) on delete restrict,
  owned_product_id uuid not null references public.user_owned_products (id) on delete restrict,
  rating smallint check (rating between 1 and 5),
  reaction_level smallint check (reaction_level between 0 and 4),
  reaction_tags text[] not null default '{}'::text[] check (
    cardinality(reaction_tags) <= 10
  ),
  texture_feedback text check (
    texture_feedback is null or char_length(texture_feedback) between 1 and 100
  ),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  unique (usage_history_id, owned_product_id)
);

create index usage_history_products_owned_idx
on public.usage_history_products (owned_product_id, created_at desc);

alter table public.usage_history_products enable row level security;

revoke all on table public.usage_history_products from anon;
revoke all on table public.usage_history_products from authenticated;
grant select, insert on table public.usage_history_products to authenticated;

create policy "usage_history_products_select_own"
on public.usage_history_products for select to authenticated
using (
  exists (
    select 1 from public.usage_history
    where usage_history.id = usage_history_products.usage_history_id
      and usage_history.user_id = (select auth.uid())
  )
);

create policy "usage_history_products_insert_own"
on public.usage_history_products for insert to authenticated
with check (
  exists (
    select 1 from public.usage_history
    where usage_history.id = usage_history_products.usage_history_id
      and usage_history.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.user_owned_products
    where user_owned_products.id = usage_history_products.owned_product_id
      and user_owned_products.user_id = (select auth.uid())
  )
);

create function public.record_routine_usage(
  p_routine_id uuid,
  p_used_date date,
  p_period text,
  p_completion_status text,
  p_overall_rating smallint,
  p_skin_reaction_level smallint,
  p_notes text,
  p_products jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  usage_id uuid;
  routine_record public.routines%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_period not in ('am', 'pm')
    or p_completion_status not in ('completed', 'partial', 'skipped')
    or (p_overall_rating is not null and p_overall_rating not between 1 and 5)
    or (p_skin_reaction_level is not null and p_skin_reaction_level not between 0 and 4)
    or jsonb_typeof(p_products) <> 'array' then
    raise exception 'INVALID_USAGE_INPUT' using errcode = '23514';
  end if;

  select * into routine_record
  from public.routines
  where id = p_routine_id
    and user_id = (select auth.uid());

  if not found then
    raise exception 'ROUTINE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if routine_record.routine_date <> p_used_date
    or routine_record.period <> p_period then
    raise exception 'ROUTINE_CONTEXT_MISMATCH' using errcode = '23514';
  end if;

  if p_completion_status = 'skipped' and nullif(trim(coalesce(p_notes, '')), '') is null then
    raise exception 'SKIP_REASON_REQUIRED' using errcode = '23514';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_products)
  ) <> (
    select count(distinct item->>'owned_product_id')
    from jsonb_array_elements(p_products) as item
  ) then
    raise exception 'DUPLICATE_USAGE_PRODUCT' using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_products) as item
    where not exists (
      select 1
      from public.routine_steps
      join public.user_owned_products
        on user_owned_products.id = routine_steps.owned_product_id
      where routine_steps.routine_id = p_routine_id
        and routine_steps.owned_product_id = (item->>'owned_product_id')::uuid
        and user_owned_products.user_id = (select auth.uid())
    )
  ) then
    raise exception 'USAGE_PRODUCT_NOT_IN_OWN_ROUTINE' using errcode = '42501';
  end if;

  insert into public.usage_history (
    user_id,
    routine_id,
    used_date,
    period,
    completion_status,
    overall_rating,
    skin_reaction_level,
    notes
  ) values (
    (select auth.uid()),
    p_routine_id,
    p_used_date,
    p_period,
    p_completion_status,
    p_overall_rating,
    p_skin_reaction_level,
    p_notes
  ) returning id into usage_id;

  insert into public.usage_history_products (
    usage_history_id,
    owned_product_id,
    rating,
    reaction_level,
    reaction_tags,
    texture_feedback,
    notes
  )
  select
    usage_id,
    (item->>'owned_product_id')::uuid,
    (item->>'rating')::smallint,
    (item->>'reaction_level')::smallint,
    coalesce(array(select jsonb_array_elements_text(coalesce(item->'reaction_tags', '[]'::jsonb))), '{}'::text[]),
    item->>'texture_feedback',
    item->>'notes'
  from jsonb_array_elements(p_products) as item;

  return usage_id;
end;
$$;

revoke all on function public.record_routine_usage(uuid, date, text, text, smallint, smallint, text, jsonb) from public;
revoke all on function public.record_routine_usage(uuid, date, text, text, smallint, smallint, text, jsonb) from anon;
grant execute on function public.record_routine_usage(uuid, date, text, text, smallint, smallint, text, jsonb) to authenticated;
