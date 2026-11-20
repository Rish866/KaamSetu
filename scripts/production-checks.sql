-- Read-only catalog checks run against PRODUCTION after migrations (and as information before).
-- Raises an exception listing every failure, so psql exits non-zero.
do $$
declare problems text[] := '{}'; r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity loop
    problems := array_append(problems, 'RLS disabled on public.' || r.relname);
  end loop;
  for r in select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
             and p.proname <> 'schema_version' and p.prorettype <> 'event_trigger'::regtype loop
    problems := array_append(problems, 'anon can execute ' || r.sig);
  end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'private' and c.relkind = 'r'
             and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select')) loop
    problems := array_append(problems, 'private.' || r.relname || ' readable by API roles');
  end loop;
  for r in select id from storage.buckets where id in ('resumes', 'profile-photos', 'company-evidence') and public loop
    problems := array_append(problems, 'bucket ' || r.id || ' is public');
  end loop;
  if (select count(*) from storage.buckets where id in ('resumes', 'profile-photos', 'company-evidence')) < 3 then
    problems := array_append(problems, 'private buckets missing');
  end if;
  for r in select f from unnest(array['public.outbox_claim(integer)', 'public.resume_work_claim(integer)', 'public.privacy_deletions_pending()',
             'public.run_retention_jobs()']) f where to_regprocedure(f) is not null and has_function_privilege('authenticated', to_regprocedure(f), 'execute') loop
    problems := array_append(problems, 'authenticated can execute worker function ' || r.f);
  end loop;
  for r in select c.relname, privilege_type from information_schema.role_table_grants g join pg_class c on c.relname = g.table_name
           join pg_namespace n on n.oid = c.relnamespace and n.nspname = g.table_schema
           where g.grantee = 'service_role' and g.table_schema = 'public' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE') loop
    problems := array_append(problems, 'service_role has ' || r.privilege_type || ' on public.' || r.relname);
  end loop;
  if cardinality(problems) > 0 then raise exception 'Production checks failed: %', array_to_string(problems, '; '); end if;
  raise notice 'Production catalog checks passed at %', now();
end $$;
