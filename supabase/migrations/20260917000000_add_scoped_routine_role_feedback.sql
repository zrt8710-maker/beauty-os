alter table public.usage_history
add column routine_role_preferences jsonb not null default '[]'::jsonb
check (jsonb_typeof(routine_role_preferences) = 'array');

-- Keep the existing six-argument RPC as the canonical product-feedback writer.
-- This overload adds scoped preferences in the same transaction without
-- duplicating product ownership, idempotency, or reaction persistence logic.
create function public.record_usage_feedback_message(
  p_routine_id uuid,
  p_conversation_id uuid,
  p_message_id uuid,
  p_completion_status text,
  p_notes text,
  p_products jsonb,
  p_routine_role_preferences jsonb
)
returns table (usage_id uuid, applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  write_result record;
  preference jsonb;
  merged_preferences jsonb;
begin
  if jsonb_typeof(p_routine_role_preferences) <> 'array' then
    raise exception 'INVALID_USAGE_FEEDBACK_MESSAGE' using errcode = '23514';
  end if;

  for preference in select value from jsonb_array_elements(p_routine_role_preferences)
  loop
    if preference->>'scope' <> 'routine_role'
      or preference->>'period' not in ('am', 'pm')
      or preference->>'routine_role' not in ('remover', 'cleanser', 'hydration', 'treatment', 'moisturizer', 'sunscreen')
      or preference->>'polarity' not in ('avoid', 'prefer') then
      raise exception 'INVALID_ROUTINE_ROLE_PREFERENCE' using errcode = '23514';
    end if;
  end loop;

  select * into write_result
  from public.record_usage_feedback_message(
    p_routine_id,
    p_conversation_id,
    p_message_id,
    p_completion_status,
    p_notes,
    p_products
  );

  if not write_result.applied or jsonb_array_length(p_routine_role_preferences) = 0 then
    return query select write_result.usage_id::uuid, write_result.applied::boolean;
    return;
  end if;

  select routine_role_preferences into merged_preferences
  from public.usage_history
  where id = write_result.usage_id
    and user_id = (select auth.uid())
  for update;

  for preference in select value from jsonb_array_elements(p_routine_role_preferences)
  loop
    select coalesce(jsonb_agg(value), '[]'::jsonb)
    into merged_preferences
    from jsonb_array_elements(coalesce(merged_preferences, '[]'::jsonb))
    where value->>'period' <> preference->>'period'
       or value->>'routine_role' <> preference->>'routine_role';
    merged_preferences := merged_preferences || jsonb_build_array(preference);
  end loop;

  update public.usage_history
  set routine_role_preferences = merged_preferences
  where id = write_result.usage_id
    and user_id = (select auth.uid());

  return query select write_result.usage_id::uuid, true;
end;
$$;

revoke all on function public.record_usage_feedback_message(uuid, uuid, uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.record_usage_feedback_message(uuid, uuid, uuid, text, text, jsonb, jsonb) to authenticated;
