-- Least-privilege Data API grants and automatic profile bootstrap.

grant usage on schema public to anon, authenticated;

grant select on public.locations, public.job_categories, public.skills to anon, authenticated;
grant select on public.companies, public.jobs, public.job_skills to anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.candidate_profiles to authenticated;
grant select, insert, update, delete on public.candidate_skills to authenticated;
grant select, insert, update, delete on public.candidate_locations to authenticated;
grant select, insert, update, delete on public.resumes to authenticated;
grant select, update on public.companies to authenticated;
grant select, insert, update, delete on public.company_members to authenticated;
grant select, insert, update on public.jobs to authenticated;
grant select, insert, update, delete on public.job_skills to authenticated;
grant select, insert on public.applications to authenticated;
grant select on public.application_events to authenticated;
grant select, insert, update on public.job_invitations to authenticated;
grant select, insert on public.interviews to authenticated;
grant select, insert on public.consent_records to authenticated;
grant select, update on public.notifications to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, phone, phone_verified_at)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'KaamSetu member'),
    new.phone,
    case when new.phone_confirmed_at is null then null else new.phone_confirmed_at end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

revoke all on function private.handle_new_user() from public, anon, authenticated;
