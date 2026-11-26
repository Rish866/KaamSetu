-- 202611260005 DPDP alignment for the hiring features (Parts 1-4).
-- 1. New consent purpose "joining_verification": the candidate agrees that KaamSetu records and confirms their joining and
--    day-15/day-30 status with the employer. Given when accepting an offer (required to accept), withdrawable at any time
--    in Settings. While withdrawn, no new joining/retention record about the candidate can be created or confirmed,
--    and pending ones are no longer auto-confirmed. Records made earlier stay, as evidence of what was agreed.
-- 2. "Download my data" adds hiring milestones, readable place names, and the candidate's location preferences.
-- 3. Account deletion: pending joining/retention reports about the person are closed, and free-text notes they wrote are
--    removed. Confirmed outcomes stay as anonymised hiring records (they feed employers' public scorecards and fee records).

------------------------------------------------------------------------------
-- 1. Consent purpose
------------------------------------------------------------------------------
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.consent_records'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) like '%purpose%' loop
    execute format('alter table public.consent_records drop constraint %I', c);
  end loop;
end $$;
alter table public.consent_records add constraint consent_records_purpose_check check (purpose in ('account', 'resume_parsing', 'matching',
  'employer_discovery', 'contact_sharing', 'essential_notifications', 'marketing', 'ai_coaching', 'joining_verification'));

create or replace function public.set_consent(p_purpose text, p_granted boolean, p_notice_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); r record;
begin
  if p_purpose not in ('resume_parsing','matching','employer_discovery','contact_sharing','marketing','ai_coaching','joining_verification') then
    raise exception 'Unknown consent purpose' using errcode = '22023';
  end if;
  if p_notice_version is null or char_length(trim(p_notice_version)) = 0 then
    raise exception 'Notice version is required' using errcode = '22023';
  end if;
  insert into public.consent_records (user_id, purpose, action, notice_version)
  values (uid, p_purpose, (case when p_granted then 'granted' else 'withdrawn' end)::public.consent_action, trim(p_notice_version));
  if p_purpose = 'employer_discovery' then
    update public.candidate_profiles set discovery_enabled = p_granted, updated_at = now() where user_id = uid;
  elsif p_purpose = 'resume_parsing' and p_granted then
    update public.resumes set parse_status = 'pending' where candidate_id = uid and active and deleted_at is null and parse_status = 'skipped';
  elsif p_purpose = 'joining_verification' and not p_granted then
    -- Employers of current hires learn that joining confirmations about this person have stopped.
    for r in select distinct j.company_id from public.applications a join public.jobs j on j.id = a.job_id
              where a.candidate_id = uid and a.stage = 'hired' loop
      perform private.notify_company(r.company_id, array['owner','recruiter']::public.company_role[], 'hiring.consent_withdrawn',
        'Joining confirmations stopped', 'A hired candidate withdrew permission for joining confirmations in KaamSetu.');
    end loop;
  end if;
end $$;

create or replace function private.joining_consent(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select action = 'granted' from public.consent_records where user_id = p_user and purpose = 'joining_verification'
                    order by created_at desc, id desc limit 1), false) $$;

-- Applies to every way a joining/retention record is created or confirmed (both sides, admins excepted, worker).
create or replace function private.require_joining_consent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind in ('offer_accepted', 'joined_day_1', 'candidate_no_show', 'retained_day_15', 'retained_day_30', 'left_before_day_30')
     and (tg_op = 'INSERT' or (new.status = 'confirmed' and old.status <> 'confirmed' and coalesce(new.confirmed_via, '') <> 'admin'))
     and not private.joining_consent(new.candidate_id) then
    if new.kind = 'offer_accepted' then
      raise exception 'Agree to joining confirmations to accept this offer' using errcode = '42501';
    end if;
    raise exception 'The candidate has not agreed to joining confirmations in KaamSetu' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger hiring_milestones_joining_consent before insert or update of status on public.hiring_milestones
  for each row execute function private.require_joining_consent();

create or replace function public.hiring_milestones_auto_confirm()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer := 0; r record;
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  for r in update public.hiring_milestones m set status = 'confirmed', confirmed_at = now(), confirmed_via = 'auto'
            where m.status = 'pending' and m.reported_at < now() - interval '7 days' and private.joining_consent(m.candidate_id)
            returning m.id, m.application_id, m.company_id, m.candidate_id, m.kind loop
    n := n + 1;
    perform private.notify(r.candidate_id, 'hiring.auto_confirmed', 'Confirmed automatically: ' || private.milestone_label(r.kind), 'Nobody disputed it within 7 days.');
    perform private.notify_company(r.company_id, array['owner', 'recruiter']::public.company_role[], 'hiring.auto_confirmed',
      'Confirmed automatically: ' || private.milestone_label(r.kind), 'Nobody disputed it within 7 days.');
    perform private.audit('hiring.' || r.kind || '.auto_confirmed', 'application', r.application_id, r.company_id, jsonb_build_object('milestone', r.id));
  end loop;
  return n;
end $$;

------------------------------------------------------------------------------
-- 2. Data export
------------------------------------------------------------------------------
alter function public.request_data_export() set schema private;
alter function private.request_data_export() rename to data_export_base;
revoke all on function private.data_export_base() from public, anon, authenticated, service_role;

create or replace function public.request_data_export()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  return private.data_export_base() || jsonb_build_object(
    'export_version', 2,
    'current_location', (select private.location_label(l.kind, l.city, l.locality, l.district, l.state, l.pincode)
                           from public.candidate_profiles cp join public.locations l on l.id = cp.current_location_id where cp.user_id = uid),
    'preferred_locations', coalesce((select jsonb_agg(jsonb_build_object('place', private.location_label(l.kind, l.city, l.locality, l.district, l.state, l.pincode),
                             'kind', l.kind, 'rank', cl.preference_rank) order by cl.preference_rank)
                           from public.candidate_locations cl join public.locations l on l.id = cl.location_id where cl.candidate_id = uid), '[]'),
    'hiring', coalesce((select jsonb_agg(jsonb_build_object('job', j.title, 'company', c.display_name, 'joining_date', a.joining_date,
        'milestones', (select coalesce(jsonb_agg(jsonb_build_object('milestone', private.milestone_label(m.kind), 'date', m.occurred_on, 'status', m.status,
                         'reported_by', m.reported_role, 'confirmed_via', m.confirmed_via, 'note', m.note, 'dispute_reason', m.dispute_reason,
                         'decision', m.resolution_reason) order by m.reported_at), '[]')
                       from public.hiring_milestones m where m.application_id = a.id)))
      from public.applications a join public.jobs j on j.id = a.job_id join public.companies c on c.id = j.company_id
     where a.candidate_id = uid and exists (select 1 from public.hiring_milestones m where m.application_id = a.id)), '[]'));
end $$;

------------------------------------------------------------------------------
-- 3. Account deletion
------------------------------------------------------------------------------
create or replace function private.on_profile_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.hiring_milestones set status = 'rejected', resolved_at = now(), resolution_reason = 'Closed: account deleted'
   where candidate_id = new.id and status in ('pending', 'disputed');
  update public.hiring_milestones set note = null where reported_by = new.id;
  update public.hiring_milestones set dispute_reason = null where disputed_by = new.id;
  return new;
end $$;
create trigger profiles_deleted_hiring after update of status on public.profiles
  for each row when (new.status = 'deleted' and old.status is distinct from 'deleted') execute function private.on_profile_deleted();

------------------------------------------------------------------------------
-- Privileges and version
------------------------------------------------------------------------------
create or replace function public.schema_version()
returns text language sql immutable set search_path = '' as $$ select '202611260005'::text $$;

revoke all on function public.request_data_export() from public, anon;
grant execute on function public.request_data_export() to authenticated;
revoke all on function public.set_consent(text, boolean, text) from public, anon;
grant execute on function public.set_consent(text, boolean, text) to authenticated;
revoke all on function public.hiring_milestones_auto_confirm() from public, anon, authenticated;
grant execute on function public.hiring_milestones_auto_confirm() to service_role;
revoke all on function private.joining_consent(uuid) from public, anon, authenticated;
revoke all on function private.require_joining_consent() from public, anon, authenticated;
revoke all on function private.on_profile_deleted() from public, anon, authenticated;
revoke all on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated, service_role;
