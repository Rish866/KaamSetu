-- Production parity and least privilege for service_role.
-- Found by the read-only drift check against production (Actions run 44803878681): the production project uses
-- Supabase's restricted default privileges (API roles receive no table privileges unless granted), it has RLS enabled
-- on the private tables, and it carries a Supabase-managed public.rls_auto_enable() event-trigger function.
-- This migration makes every environment (production, local stack, CI) converge on the same explicit state.

-- 1. service_role gets no implicit table privileges in public; workers use SECURITY DEFINER RPCs.
revoke all on all tables in schema public from service_role;
revoke all on all sequences in schema public from service_role;
alter default privileges for role postgres in schema public revoke all on tables from service_role;
alter default privileges for role postgres in schema public revoke all on sequences from service_role;
-- The resume-processor reads the active skill taxonomy to suggest skills (read-only).
grant select (name, active) on public.skills to service_role;

-- 2. RLS on the private tables, as in production (defence in depth; they have no policies, so only their owner,
--    i.e. SECURITY DEFINER functions owned by postgres, can read or write them).
alter table private.app_roles enable row level security;
alter table private.audit_events enable row level security;
alter table private.company_verifications enable row level security;
alter table private.email_outbox enable row level security;

-- 3. Re-state the two authorisation helpers so their definition comes from migrations, not from manual changes.
create or replace function private.is_company_member(target_company uuid, allowed_roles public.company_role[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_members cm
    where cm.company_id = target_company and cm.user_id = (select auth.uid()) and cm.active
      and (allowed_roles is null or cm.role = any(allowed_roles))
  );
$$;
create or replace function private.is_admin(allowed_roles text[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.app_roles ar
    where ar.user_id = (select auth.uid()) and (allowed_roles is null or ar.role = any(allowed_roles))
  );
$$;
revoke all on function private.is_company_member(uuid, public.company_role[]) from public, anon;
revoke all on function private.is_admin(text[]) from public, anon;
grant execute on function private.is_company_member(uuid, public.company_role[]) to authenticated;
grant execute on function private.is_admin(text[]) to authenticated;

create or replace function public.schema_version()
returns text language sql immutable set search_path = '' as $$ select '202611200005'::text $$;
