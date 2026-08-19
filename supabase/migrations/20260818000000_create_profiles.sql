create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'Asia/Shanghai',
  locale text not null default 'zh-CN',
  location_name text,
  latitude numeric(8, 5) check (latitude between -90 and 90),
  longitude numeric(8, 5) check (longitude between -180 and 180),
  skin_type text check (
    skin_type is null
    or skin_type in ('dry', 'oily', 'combination', 'normal', 'unknown')
  ),
  sensitivity_level smallint not null default 0 check (
    sensitivity_level between 0 and 4
  ),
  goals text[] not null default '{}',
  allergies text[] not null default '{}',
  avoid_ingredients text[] not null default '{}',
  max_am_steps smallint not null default 4 check (max_am_steps between 1 and 8),
  max_pm_steps smallint not null default 5 check (max_pm_steps between 1 and 8),
  preferences jsonb not null default '{}'::jsonb check (
    jsonb_typeof(preferences) = 'object'
  ),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon;
grant select, insert, update, delete on table public.profiles to authenticated;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "profiles_delete_own"
on public.profiles
for delete
to authenticated
using ((select auth.uid()) = user_id);

create function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user_profile() from public;

create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute procedure public.handle_new_user_profile();

insert into public.profiles (user_id)
select id
from auth.users
on conflict (user_id) do nothing;
