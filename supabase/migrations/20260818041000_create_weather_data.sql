create table public.weather_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recorded_date date not null,
  temperature numeric(5, 2) check (
    temperature is null or temperature between -100 and 100
  ),
  humidity numeric(5, 2) check (humidity is null or humidity between 0 and 100),
  uv_index numeric(5, 2) check (uv_index is null or uv_index between 0 and 30),
  weather_code text check (
    weather_code is null or char_length(weather_code) between 1 and 50
  ),
  source text not null default 'open_meteo' check (
    char_length(source) between 1 and 50
  ),
  raw_payload jsonb not null default '{}'::jsonb check (
    jsonb_typeof(raw_payload) = 'object'
  ),
  created_at timestamptz not null default now(),
  unique (user_id, recorded_date)
);

create index weather_data_user_date_idx
on public.weather_data (user_id, recorded_date desc);

alter table public.weather_data enable row level security;

revoke all on table public.weather_data from anon;
grant select, insert, update, delete on table public.weather_data to authenticated;

create policy "weather_data_select_own"
on public.weather_data
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "weather_data_insert_own"
on public.weather_data
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "weather_data_update_own"
on public.weather_data
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "weather_data_delete_own"
on public.weather_data
for delete
to authenticated
using ((select auth.uid()) = user_id);
