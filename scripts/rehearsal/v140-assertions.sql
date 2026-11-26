-- Assertions after applying the v1.4.0 migrations on top of v1.3.0-shaped data (local throw-away database only).
\set ON_ERROR_STOP on
do $$
declare problems text[] := '{}';
begin
  if public.schema_version() <> '202611260005' then problems := array_append(problems, 'schema_version'); end if;
  if (select count(*) from public.profiles) <> 2 then problems := array_append(problems, 'profiles lost'); end if;
  if (select count(*) from public.jobs where title = 'Legacy job' and status = 'pending_review') <> 1 then problems := array_append(problems, 'legacy job changed'); end if;
  if (select verification_status from public.companies where display_name = 'Legacy') <> 'draft' then problems := array_append(problems, 'legacy company not returned to draft'); end if;
  if (select count(*) from public.consent_records) < 3 then problems := array_append(problems, 'consent history lost'); end if;
  if (select discovery_enabled from public.candidate_profiles where user_id = '11111111-1111-4111-8111-111111111111') is not true then problems := array_append(problems, 'candidate profile changed'); end if;
  if (select count(*) from public.notification_preferences) <> 2 then problems := array_append(problems, 'preferences not backfilled'); end if;
  if (select count(*) from public.matching_versions where active) <> 1 then problems := array_append(problems, 'matching version'); end if;
  if (select email_verified_at is null from public.profiles where id = '22222222-2222-4222-8222-222222222222') is not true then problems := array_append(problems, 'unconfirmed employer marked verified'); end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and (select count(*) from cron.job where jobname in ('kaamsetu-expire-invitations', 'kaamsetu-retention')) <> 2 then
    problems := array_append(problems, 'cron jobs not scheduled');
  end if;
  if cardinality(problems) > 0 then raise exception 'Upgrade assertions failed: %', array_to_string(problems, '; '); end if;
  raise notice 'Upgrade assertions passed. pg_cron installed: %', exists (select 1 from pg_extension where extname = 'pg_cron');
end $$;

-- The confirmation sync trigger must work on the real auth.users table.
update auth.users set email_confirmed_at = now() where id = '22222222-2222-4222-8222-222222222222';
do $$ begin
  if (select email_verified_at from public.profiles where id = '22222222-2222-4222-8222-222222222222') is null then raise exception 'auth.users -> profiles sync failed'; end if;
end $$;
select version() as postgres_version;
select extname, extversion from pg_extension where extname in ('pg_cron', 'pgcrypto', 'pg_net') order by 1;
select jobname, schedule, command from cron.job where jobname like 'kaamsetu-%' order by 1;
