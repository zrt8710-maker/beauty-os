create table public.purchase_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  candidate_product_id uuid references public.catalog_products (id) on delete restrict,
  candidate_snapshot jsonb not null check (jsonb_typeof(candidate_snapshot) = 'object'),
  inventory_snapshot jsonb not null check (jsonb_typeof(inventory_snapshot) = 'object'),
  goal_snapshot jsonb not null check (jsonb_typeof(goal_snapshot) = 'object'),
  duplicate_score smallint not null check (duplicate_score between 0 and 100),
  gap_score smallint not null check (gap_score between 0 and 100),
  compatibility_score smallint not null check (compatibility_score between 0 and 100),
  usage_probability_score smallint not null check (usage_probability_score between 0 and 100),
  risk_score smallint not null check (risk_score between 0 and 100),
  final_score smallint not null check (final_score between 0 and 100),
  decision text not null check (decision in ('consider_buy', 'wait', 'do_not_buy', 'insufficient_data')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  unknowns jsonb not null default '[]'::jsonb check (jsonb_typeof(unknowns) = 'array'),
  reason_codes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index purchase_analyses_user_created_idx
on public.purchase_analyses (user_id, created_at desc);

create index purchase_analyses_candidate_idx
on public.purchase_analyses (candidate_product_id)
where candidate_product_id is not null;

alter table public.purchase_analyses enable row level security;

revoke all on table public.purchase_analyses from anon, authenticated;
grant select, insert on table public.purchase_analyses to authenticated;

create policy "purchase_analyses_select_own"
on public.purchase_analyses for select to authenticated
using ((select auth.uid()) = user_id);

create policy "purchase_analyses_insert_own"
on public.purchase_analyses for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (
    candidate_product_id is null
    or exists (
      select 1 from public.catalog_products
      where catalog_products.id = candidate_product_id
        and catalog_products.status = 'verified'
    )
  )
);
