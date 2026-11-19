-- Password authentication, immutable account identity, and role-aware access.
-- Apply after 202611180002_employer_company.sql.

alter table public.profiles
  add column if not exists email text,
  add column if not exists email_verified_at timestamptz,
  add column if not exists account_kind text;

update public.profiles p
set
  email = lower(u.email),
  email_verified_at = u.email_confirmed_at,
  phone = coalesce(p.phone, u.phone),
  phone_verified_at = coalesce(p.phone_verified_at, u.phone_confirmed_at),
  account_kind = case
    when exists (select 1 from public.company_members cm where cm.user_id = p.id and cm.active) then 'employer'
    when u.raw_user_meta_data ->> 'account_kind' in ('candidate', 'employer') then u.raw_user_meta_data ->> 'account_kind'
    else 'candidate'
  end
from auth.users u
where u.id = p.id;

update public.profiles set account_kind = 'candidate' where account_kind is null;

alter table public.profiles
  alter column account_kind set default 'candidate',
  alter column account_kind set not null;

alter table public.profiles
  drop constraint if exists profiles_account_kind_check;
alter table public.profiles
  add constraint profiles_account_kind_check check (account_kind in ('candidate', 'employer'));

create unique index if not exists profiles_email_unique
  on public.profiles (lower(email)) where email is not null;
create unique index if not exists profiles_phone_unique
  on public.profiles (phone) where phone is not null;

-- Identity and account type are populated from auth.users by the trusted trigger.
-- Users may edit their display name, but cannot rewrite identity or role columns.
revoke insert, update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_kind text;
  notice_version text;
begin
  requested_kind := case
    when new.raw_user_meta_data ->> 'account_kind' in ('candidate', 'employer')
      then new.raw_user_meta_data ->> 'account_kind'
    else 'candidate'
  end;
  notice_version := nullif(new.raw_user_meta_data ->> 'accepted_notice_version', '');

  insert into public.profiles (
    id, display_name, email, email_verified_at, phone, phone_verified_at, account_kind
  ) values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'KaamSetu member'),
    lower(new.email),
    new.email_confirmed_at,
    new.phone,
    new.phone_confirmed_at,
    requested_kind
  )
  on conflict (id) do nothing;

  if notice_version is not null then
    insert into public.consent_records (user_id, purpose, action, notice_version, channel)
    values (new.id, 'account', 'granted', notice_version, 'app');
  end if;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create or replace function public.current_user_access()
returns table (
  account_kind text,
  display_name text,
  is_admin boolean,
  status public.account_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.account_kind,
    p.display_name,
    exists (
      select 1 from private.app_roles ar
      where ar.user_id = p.id and ar.role = 'admin'
    ) as is_admin,
    p.status
  from public.profiles p
  where p.id = (select auth.uid());
$$;

revoke all on function public.current_user_access() from public, anon;
grant execute on function public.current_user_access() to authenticated;

create or replace function public.create_employer_company(
  legal_name text,
  display_name text,
  city text default null,
  website text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_company_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.account_kind = 'employer'
      and p.status = 'active'
  ) then
    raise exception 'An active employer account is required';
  end if;

  if char_length(trim(legal_name)) < 2 or char_length(trim(display_name)) < 2 then
    raise exception 'Company name is required';
  end if;

  if exists (
    select 1 from public.company_members
    where user_id = (select auth.uid()) and active
  ) then
    raise exception 'This account already belongs to a company';
  end if;

  insert into public.companies (legal_name, display_name, city, website, verification_status)
  values (trim(legal_name), trim(display_name), nullif(trim(city), ''), nullif(trim(website), ''), 'pending')
  returning id into new_company_id;

  insert into public.company_members (company_id, user_id, role)
  values (new_company_id, (select auth.uid()), 'owner');

  return new_company_id;
end;
$$;

revoke all on function public.create_employer_company(text, text, text, text) from public, anon;
grant execute on function public.create_employer_company(text, text, text, text) to authenticated;
