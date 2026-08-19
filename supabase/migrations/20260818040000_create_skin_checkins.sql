create table public.skin_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  dryness_level smallint not null default 0 check (dryness_level between 0 and 4),
  oiliness_level smallint not null default 0 check (oiliness_level between 0 and 4),
  redness_level smallint not null default 0 check (redness_level between 0 and 4),
  sensitivity_level smallint not null default 0 check (sensitivity_level between 0 and 4),
  acne_level smallint not null default 0 check (acne_level between 0 and 4),
  notes text check (notes is null or char_length(notes) <= 2000),
  recorded_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, recorded_date)
);

create index skin_checkins_user_date_idx
on public.skin_checkins (user_id, recorded_date desc);

alter table public.skin_checkins enable row level security;

revoke all on table public.skin_checkins from anon;
grant select, insert, update, delete on table public.skin_checkins to authenticated;

create policy "skin_checkins_select_own"
on public.skin_checkins
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "skin_checkins_insert_own"
on public.skin_checkins
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "skin_checkins_update_own"
on public.skin_checkins
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "skin_checkins_delete_own"
on public.skin_checkins
for delete
to authenticated
using ((select auth.uid()) = user_id);
