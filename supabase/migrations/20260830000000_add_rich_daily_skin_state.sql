alter table public.skin_checkins
  add column daily_state jsonb;

alter table public.skin_checkins
  add constraint skin_checkins_daily_state_object_check
    check (daily_state is null or jsonb_typeof(daily_state) = 'object');

comment on column public.skin_checkins.daily_state is
  'Versioned, user-confirmed rich daily skin state: natural summary and structured area/symptom details. NULL denotes records created before v0.2 or without rich details.';
