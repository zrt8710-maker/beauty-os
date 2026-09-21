alter table public.profiles
add column long_term_skin_baseline jsonb not null default '{}'::jsonb check (
  jsonb_typeof(long_term_skin_baseline) = 'object'
);
