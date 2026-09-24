-- Durable, Catalog-scoped work. Private user assets never own research jobs.
create table public.catalog_product_research_jobs (
  catalog_product_id uuid primary key references public.catalog_products (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  lease_token uuid,
  research_input jsonb check (research_input is null or jsonb_typeof(research_input) = 'object'),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index catalog_product_research_jobs_pending_idx
  on public.catalog_product_research_jobs (status, available_at, created_at);

alter table public.catalog_product_research_jobs enable row level security;
revoke all on public.catalog_product_research_jobs from public, anon, authenticated;
grant select, insert, update on public.catalog_product_research_jobs to service_role;

create policy "catalog_product_research_jobs_service_role_only"
on public.catalog_product_research_jobs for all to service_role
using (true) with check (true);

-- The same call handles a newly inserted external candidate and a reused
-- external candidate that still has no usable draft. Internal Catalog matches
-- never call this function. The primary key is the durable deduplication key.
create function public.enqueue_catalog_product_research_job(
  p_catalog_product_id uuid, p_research_input jsonb default null
)
returns boolean language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_enqueued boolean := false;
begin
  if not exists (
    select 1 from public.catalog_products
    where id = p_catalog_product_id and status = 'candidate'
  ) or exists (
    select 1 from public.catalog_product_research_drafts
    where catalog_product_id = p_catalog_product_id
      and status in ('draft', 'review_pending', 'approved')
  ) then return false; end if;

  insert into public.catalog_product_research_jobs (catalog_product_id, research_input)
  values (p_catalog_product_id, p_research_input)
  on conflict (catalog_product_id) do update
    set status = 'queued', attempts = 0, available_at = now(),
        lease_expires_at = null, lease_token = null, last_error = null,
        research_input = coalesce(excluded.research_input, public.catalog_product_research_jobs.research_input),
        updated_at = now()
    where public.catalog_product_research_jobs.status in ('completed', 'failed')
  returning true into v_enqueued;
  return coalesce(v_enqueued, false);
end;
$$;

-- Self-heals an enqueue failure after an asset was saved, and backfills
-- existing user-linked candidates, including the reported 珀莱雅 record.
create function public.backfill_catalog_product_research_jobs()
returns integer language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_count integer;
begin
  insert into public.catalog_product_research_jobs (catalog_product_id)
  select c.id from public.catalog_products c
  where c.status = 'candidate'
    and exists (select 1 from public.products p where p.catalog_product_id = c.id)
    and not exists (
      select 1 from public.catalog_product_research_drafts d
      where d.catalog_product_id = c.id
        and d.status in ('draft', 'review_pending', 'approved')
    )
  on conflict (catalog_product_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- One worker claims one Catalog ID atomically. A dead worker's lease expires;
-- an old worker cannot complete a newer lease because the token changes.
create function public.claim_catalog_product_research_job()
returns table(catalog_product_id uuid, lease_token uuid, attempts integer, research_input jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.catalog_product_research_jobs j
  set status = 'failed', lease_token = null, lease_expires_at = null,
      last_error = 'attempt_limit_reached', updated_at = now()
  where j.status = 'running' and j.lease_expires_at < now() and j.attempts >= 4;

  return query
  with candidate as (
    select j.catalog_product_id from public.catalog_product_research_jobs j
    where (j.status = 'queued' and j.available_at <= now()
          or j.status = 'running' and j.lease_expires_at < now())
      and j.attempts < 4
    order by j.available_at, j.created_at
    for update skip locked limit 1
  )
  update public.catalog_product_research_jobs j
  set status = 'running', attempts = j.attempts + 1,
      lease_token = gen_random_uuid(), lease_expires_at = now() + interval '3 minutes',
      updated_at = now()
  from candidate c where j.catalog_product_id = c.catalog_product_id
  returning j.catalog_product_id, j.lease_token, j.attempts, j.research_input;
end;
$$;

create function public.finish_catalog_product_research_job(
  p_catalog_product_id uuid, p_lease_token uuid, p_result text, p_error text default null
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_finished boolean := false;
begin
  if p_result not in ('completed', 'retry') then raise exception 'invalid job result'; end if;
  update public.catalog_product_research_jobs j
  set status = case when p_result = 'completed' then 'completed'
                    when j.attempts >= 4 then 'failed' else 'queued' end,
      available_at = case when p_result = 'retry'
        then now() + make_interval(mins => least(j.attempts, 5)) else j.available_at end,
      lease_token = null, lease_expires_at = null,
      last_error = left(p_error, 200), updated_at = now()
  where j.catalog_product_id = p_catalog_product_id
    and j.status = 'running' and j.lease_token = p_lease_token
  returning true into v_finished;
  return coalesce(v_finished, false);
end;
$$;

revoke all on function public.enqueue_catalog_product_research_job(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.backfill_catalog_product_research_jobs() from public, anon, authenticated;
revoke all on function public.claim_catalog_product_research_job() from public, anon, authenticated;
revoke all on function public.finish_catalog_product_research_job(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_catalog_product_research_job(uuid, jsonb) to service_role;
grant execute on function public.backfill_catalog_product_research_jobs() to service_role;
grant execute on function public.claim_catalog_product_research_job() to service_role;
grant execute on function public.finish_catalog_product_research_job(uuid, uuid, text, text) to service_role;

select public.backfill_catalog_product_research_jobs();
