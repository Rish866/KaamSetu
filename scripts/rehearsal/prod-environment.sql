-- Recreates, on a throw-away LOCAL database, the production environment differences found by the drift check
-- (Actions run 44803878681): Supabase's restricted default privileges for API roles, the Supabase-managed
-- public.rls_auto_enable() event trigger (owned by supabase_admin, not postgres), and RLS on private tables.
-- Must run as supabase_admin, before the pending migrations: that is the state production is in today.
\set ON_ERROR_STOP on
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant maintain, references, trigger, truncate on tables to anon, authenticated, service_role;
revoke select, insert, update, delete on all tables in schema public from service_role;
alter table private.app_roles enable row level security;
alter table private.audit_events enable row level security;
alter table private.company_verifications enable row level security;

create or replace function public.rls_auto_enable() returns event_trigger language plpgsql security definer set search_path to 'pg_catalog' as $function$
declare cmd record; tbl name;
begin
  for cmd in select * from pg_event_trigger_ddl_commands()
             where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') and object_type in ('table', 'partitioned table') loop
    if cmd.schema_name = 'public' then
      begin
        select c.relname into tbl from pg_catalog.pg_class c where c.oid = cmd.objid;
        execute format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
      exception when others then raise log 'rls_auto_enable: failed on %', cmd.object_identity;
      end;
    end if;
  end loop;
end $function$;
-- As in production (Actions run 44807025417): function and event trigger owned by postgres; PUBLIC keeps the default EXECUTE.
alter function public.rls_auto_enable() owner to postgres;
revoke all on function public.rls_auto_enable() from anon, authenticated, service_role;
drop event trigger if exists ensure_rls;
create event trigger ensure_rls on ddl_command_end execute function public.rls_auto_enable();
alter event trigger ensure_rls owner to postgres;
select 'production environment emulated' as step, (select usename from pg_user u join pg_proc p on p.proowner = u.usesysid where p.proname = 'rls_auto_enable') as rls_auto_enable_owner;
