-- Scheduled maintenance via pg_cron (available on Supabase). Idempotent: safe to re-run.
-- The email worker is triggered separately (see docs/OPERATIONS.md) because it needs the service-role key.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname in ('kaamsetu-expire-invitations', 'kaamsetu-retention');
    perform cron.schedule('kaamsetu-expire-invitations', '15 * * * *', 'select public.expire_stale_invitations()');
    perform cron.schedule('kaamsetu-retention', '30 2 * * *', 'select public.run_retention_jobs()');
  else
    raise notice 'pg_cron is not available; schedule expire_stale_invitations() and run_retention_jobs() externally';
  end if;
end $$;
