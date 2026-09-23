create table public.personal_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('daily_skin', 'feedback')),
  fingerprint text not null check (length(fingerprint) = 64),
  content text not null check (length(content) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create index personal_memories_user_recent_idx
on public.personal_memories (user_id, created_at desc);

alter table public.personal_memories enable row level security;
revoke all on table public.personal_memories from anon;
grant select, insert, delete on table public.personal_memories to authenticated;

create policy "personal_memories_select_own" on public.personal_memories
for select to authenticated using ((select auth.uid()) = user_id);
create policy "personal_memories_insert_own" on public.personal_memories
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "personal_memories_delete_own" on public.personal_memories
for delete to authenticated using ((select auth.uid()) = user_id);
