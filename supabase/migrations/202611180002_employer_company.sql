-- Authenticated employer onboarding without granting direct company INSERT access.

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
