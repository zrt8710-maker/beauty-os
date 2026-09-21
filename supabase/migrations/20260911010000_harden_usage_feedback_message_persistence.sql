-- One feedback conversation owns one mutable, private usage-history record.
-- Each client message is applied at most once; corrections replace current
-- product feedback rather than creating contradictory history rows.

alter table public.usage_history
  add column feedback_conversation_id uuid,
  add column feedback_message_ids uuid[] not null default '{}'::uuid[];

create unique index usage_history_feedback_conversation_unique
  on public.usage_history (user_id, routine_id, feedback_conversation_id)
  where feedback_conversation_id is not null;

create function public.record_usage_feedback_message(
  p_routine_id uuid,
  p_conversation_id uuid,
  p_message_id uuid,
  p_completion_status text,
  p_notes text,
  p_products jsonb
)
returns table (usage_id uuid, applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  routine_record public.routines%rowtype;
  usage_record public.usage_history%rowtype;
  item jsonb;
  operation text;
  product_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_completion_status not in ('completed', 'partial', 'skipped')
    or jsonb_typeof(p_products) <> 'array' then
    raise exception 'INVALID_USAGE_FEEDBACK_MESSAGE' using errcode = '23514';
  end if;

  select * into routine_record
  from public.routines
  where id = p_routine_id
    and user_id = (select auth.uid());
  if not found then
    raise exception 'ROUTINE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into usage_record
  from public.usage_history
  where user_id = (select auth.uid())
    and routine_id = p_routine_id
    and feedback_conversation_id = p_conversation_id
  for update;

  if found and p_message_id = any (usage_record.feedback_message_ids) then
    return query select usage_record.id, false;
    return;
  end if;

  if found then
    update public.usage_history
    set feedback_message_ids = array_append(feedback_message_ids, p_message_id),
        completion_status = p_completion_status,
        notes = coalesce(p_notes, notes)
    where id = usage_record.id
    returning * into usage_record;
  else
    insert into public.usage_history (
      user_id, routine_id, used_date, period, completion_status, notes,
      feedback_conversation_id, feedback_message_ids
    ) values (
      (select auth.uid()), p_routine_id, routine_record.routine_date,
      routine_record.period, p_completion_status, p_notes,
      p_conversation_id, array[p_message_id]
    )
    returning * into usage_record;
  end if;

  for item in select value from jsonb_array_elements(p_products)
  loop
    product_id := (item->>'owned_product_id')::uuid;
    if not exists (
      select 1
      from public.routine_steps
      join public.user_owned_products on user_owned_products.id = routine_steps.owned_product_id
      where routine_steps.routine_id = p_routine_id
        and routine_steps.owned_product_id = product_id
        and user_owned_products.user_id = (select auth.uid())
    ) then
      raise exception 'USAGE_PRODUCT_NOT_IN_OWN_ROUTINE' using errcode = '42501';
    end if;

    operation := coalesce(item->>'operation', 'add');
    if operation = 'retract' then
      delete from public.usage_history_products
      where usage_history_id = usage_record.id and owned_product_id = product_id;
    elsif operation in ('add', 'amend') then
      insert into public.usage_history_products (
        usage_history_id, owned_product_id, rating, reaction_level,
        reaction_tags, texture_feedback, notes
      ) values (
        usage_record.id, product_id, (item->>'rating')::smallint,
        (item->>'reaction_level')::smallint,
        coalesce(array(select jsonb_array_elements_text(coalesce(item->'reaction_tags', '[]'::jsonb))), '{}'::text[]),
        item->>'texture_feedback', item->>'notes'
      )
      on conflict (usage_history_id, owned_product_id) do update
      set rating = excluded.rating,
          reaction_level = excluded.reaction_level,
          reaction_tags = excluded.reaction_tags,
          texture_feedback = excluded.texture_feedback,
          notes = excluded.notes;
    else
      raise exception 'INVALID_USAGE_FEEDBACK_OPERATION' using errcode = '23514';
    end if;
  end loop;

  return query select usage_record.id, true;
end;
$$;

revoke all on function public.record_usage_feedback_message(uuid, uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function public.record_usage_feedback_message(uuid, uuid, uuid, text, text, jsonb) to authenticated;
