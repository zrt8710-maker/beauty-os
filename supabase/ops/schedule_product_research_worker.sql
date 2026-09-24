-- One-time production setup after the migration and EdgeOne deployment.
-- Enable pg_cron and pg_net in Supabase Dashboard first. Store the SAME random
-- token as EdgeOne PRODUCT_RESEARCH_WORKER_SECRET in Supabase Vault under the
-- name beauty_os_product_research_worker_secret. Never put the token in Git.
-- Supabase Cron runs this once per minute; the worker claims at most one job.
select cron.schedule(
  'beauty-os-product-research-worker',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://biubiuos.com/api/internal/product-research',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'beauty_os_product_research_worker_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 115000
    );
  $job$
);
