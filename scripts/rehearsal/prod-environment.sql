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

select 'production privileges emulated' as step;
