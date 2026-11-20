-- Production's Supabase-managed RLS event trigger, recreated exactly as observed in Actions run 44807025417:
-- function public.rls_auto_enable() and event trigger ensure_rls, both owned by postgres; PUBLIC keeps EXECUTE.
-- Must run as postgres (supautils lets postgres own event triggers on Supabase images).
\set ON_ERROR_STOP on
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
revoke all on function public.rls_auto_enable() from anon, authenticated, service_role;
drop event trigger if exists ensure_rls;
create event trigger ensure_rls on ddl_command_end execute function public.rls_auto_enable();
select 'event trigger emulated' as step, pg_get_userbyid(evtowner) as owner from pg_event_trigger where evtname = 'ensure_rls';
