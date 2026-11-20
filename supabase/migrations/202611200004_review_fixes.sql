-- Fixes from the independent review of PR #2/#3 (docs/reviews/2026-11-19-210714-pr-2-3.md).
-- Forward-only. Recovery procedure: docs/OPERATIONS.md section "Migration recovery".

------------------------------------------------------------------------------
-- 0. Privilege defaults and helpers
------------------------------------------------------------------------------
-- Remove the global PUBLIC execute default so future functions are closed unless granted explicitly.
alter default privileges for role postgres revoke execute on functions from public;

create or replace function private.user_is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and status = 'active');
$$;

-- Lets the app detect a database that has not been migrated yet and show a maintenance screen.
create or replace function public.schema_version()
returns text language sql immutable set search_path = '' as $$ select '202611200004'::text $$;

------------------------------------------------------------------------------
-- 1. Immutable history: block DELETE and TRUNCATE as well as UPDATE
------------------------------------------------------------------------------
create or replace function private.deny_truncate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception '% cannot be truncated', tg_table_name using errcode = '42501';
end $$;

drop trigger if exists consent_records_immutable on public.consent_records;
create trigger consent_records_immutable before update or delete on public.consent_records for each row execute function private.deny_modify();
drop trigger if exists application_events_immutable on public.application_events;
create trigger application_events_immutable before update or delete on public.application_events for each row execute function private.deny_modify();
drop trigger if exists job_events_immutable on public.job_events;
create trigger job_events_immutable before update or delete on public.job_events for each row execute function private.deny_modify();
drop trigger if exists contact_disclosures_immutable on public.contact_disclosures;
create trigger contact_disclosures_immutable before update or delete on public.contact_disclosures for each row execute function private.deny_modify();

create trigger audit_events_no_truncate before truncate on private.audit_events for each statement execute function private.deny_truncate();
create trigger consent_records_no_truncate before truncate on public.consent_records for each statement execute function private.deny_truncate();
create trigger application_events_no_truncate before truncate on public.application_events for each statement execute function private.deny_truncate();
create trigger job_events_no_truncate before truncate on public.job_events for each statement execute function private.deny_truncate();
create trigger contact_disclosures_no_truncate before truncate on public.contact_disclosures for each statement execute function private.deny_truncate();

------------------------------------------------------------------------------
-- 2. Keep profiles in sync with auth.users (confirmation, email/phone change)
--    and make sure no notification failure can ever break sign-up or login.
------------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare requested_kind text; notice_version text;
begin
  requested_kind := case when new.raw_user_meta_data ->> 'account_kind' in ('candidate', 'employer')
    then new.raw_user_meta_data ->> 'account_kind' else 'candidate' end;
  notice_version := nullif(new.raw_user_meta_data ->> 'accepted_notice_version', '');

  insert into public.profiles (id, display_name, email, email_verified_at, phone, phone_verified_at, account_kind)
  values (new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'KaamSetu member'), 100),
    lower(nullif(new.email, '')), new.email_confirmed_at, nullif(new.phone, ''), new.phone_confirmed_at, requested_kind)
  on conflict (id) do nothing;

  if requested_kind = 'candidate' then
    insert into public.candidate_profiles (user_id) values (new.id) on conflict do nothing;
  end if;
  insert into public.notification_preferences (user_id) values (new.id) on conflict do nothing;
  if notice_version is not null then
    insert into public.consent_records (user_id, purpose, action, notice_version, channel)
    values (new.id, 'account', 'granted', notice_version, 'app');
  end if;
  return new;
end $$;

-- In-app welcome only. No email is sent to an address that has not been confirmed.
create or replace function private.on_profile_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.notifications (recipient_id, kind, title, body)
    values (new.id, 'account.registered', 'Welcome to KaamSetu', 'Your account is ready. Complete your profile to get better matches.');
  exception when others then
    raise warning 'welcome notification failed: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists auth_users_security_change on auth.users;
drop function if exists private.on_auth_security_change();

create or replace function private.sync_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    update public.profiles p
       set email = lower(nullif(new.email, '')), email_verified_at = new.email_confirmed_at,
           phone = nullif(new.phone, ''), phone_verified_at = new.phone_confirmed_at, updated_at = now()
     where p.id = new.id and p.status <> 'deleted'
       and (p.email is distinct from lower(nullif(new.email, '')) or p.email_verified_at is distinct from new.email_confirmed_at
            or p.phone is distinct from nullif(new.phone, '') or p.phone_verified_at is distinct from new.phone_confirmed_at);
    if exists (select 1 from public.profiles where id = new.id and status = 'active') then
      if new.encrypted_password is distinct from old.encrypted_password then
        perform private.notify(new.id, 'security.password_changed', 'Your password was changed',
          'If this was not you, reset your password immediately and contact support.');
      end if;
      if (new.email is distinct from old.email and old.email is not null) or (new.phone is distinct from old.phone and old.phone is not null) then
        perform private.notify(new.id, 'security.contact_changed', 'Your sign-in details were changed',
          'If this was not you, contact support immediately.');
      end if;
    end if;
  exception when others then
    raise warning 'sync_auth_user failed for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists auth_users_sync on auth.users;
create trigger auth_users_sync after update of email, email_confirmed_at, phone, phone_confirmed_at, encrypted_password on auth.users
  for each row execute function private.sync_auth_user();

-- Backfill rows that the sync would have produced.
update public.profiles p set email_verified_at = u.email_confirmed_at, phone_verified_at = u.phone_confirmed_at
  from auth.users u where u.id = p.id and p.status <> 'deleted'
   and (p.email_verified_at is distinct from u.email_confirmed_at or p.phone_verified_at is distinct from u.phone_confirmed_at);
insert into public.notification_preferences (user_id) select id from public.profiles on conflict do nothing;

------------------------------------------------------------------------------
-- 3. Storage: active accounts only; resumes downloadable only when scanned clean
------------------------------------------------------------------------------
create or replace function private.owner_can_read_resume(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.resumes r where r.storage_path = object_name and r.candidate_id = (select auth.uid())
                 and r.deleted_at is null and r.scan_status = 'clean');
$$;

-- Consent condition (documented in the Privacy Notice): applying to, or accepting an invitation for,
-- a company's job shares the candidate's active, scanned-clean resume with that company's recruiters.
create or replace function private.employer_can_read_resume(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.resumes r
    join public.applications a on a.candidate_id = r.candidate_id and a.stage <> 'withdrawn'
    join public.jobs j on j.id = a.job_id
    join public.profiles p on p.id = r.candidate_id and p.status = 'active'
    where r.storage_path = object_name and r.active and r.deleted_at is null and r.scan_status = 'clean'
      and private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[])
      and private.company_is_approved(j.company_id));
$$;

drop policy if exists resume_object_insert on storage.objects;
drop policy if exists resume_object_read on storage.objects;
drop policy if exists resume_object_delete on storage.objects;
create policy resume_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text
              and lower(name) ~ '\.(pdf|docx)$' and private.user_is_active());
create policy resume_object_read on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and (private.owner_can_read_resume(name) or private.employer_can_read_resume(name)));
-- No client delete: deleted resumes are purged by the trusted resume-processor worker.

drop policy if exists photo_object_insert on storage.objects;
create policy photo_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
              and lower(name) ~ '\.(png|jpe?g|webp)$' and private.user_is_active());

drop policy if exists evidence_object_insert on storage.objects;
create policy evidence_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'company-evidence' and private.user_is_active()
    and private.is_company_member(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid end, array['owner']::public.company_role[]));

------------------------------------------------------------------------------
-- 4. Resume processing pipeline (scan -> optional parse -> candidate review)
------------------------------------------------------------------------------
alter table public.resumes
  add column if not exists scan_attempts integer not null default 0,
  add column if not exists scan_next_attempt_at timestamptz not null default now(),
  add column if not exists lease_until timestamptz,
  add column if not exists scan_engine text,
  add column if not exists scan_detail text,
  add column if not exists scanned_at timestamptz,
  add column if not exists purged_at timestamptz;
alter table public.resumes drop constraint if exists resumes_parse_status_check;
alter table public.resumes add constraint resumes_parse_status_check
  check (parse_status in ('pending', 'processing', 'complete', 'failed', 'unavailable', 'skipped'));

-- Worker claims work with a 10-minute lease so two workers never process the same file.
create or replace function public.resume_work_claim(p_limit integer default 10)
returns table (resume_id uuid, candidate_id uuid, storage_path text, mime_type text, byte_size integer, task text, parsing_consent boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  return query
  with picked as (
    select r.id, case when r.deleted_at is not null then 'purge' when r.scan_status = 'pending' then 'scan' else 'parse' end as t
    from public.resumes r
    where (r.lease_until is null or r.lease_until < now())
      and ((r.deleted_at is not null and r.purged_at is null)
        or (r.deleted_at is null and r.scan_status = 'pending' and r.scan_next_attempt_at <= now())
        or (r.deleted_at is null and r.scan_status = 'clean' and r.parse_status = 'pending'))
    order by r.created_at limit least(greatest(coalesce(p_limit, 10), 1), 50)
    for update skip locked),
  leased as (
    update public.resumes r set lease_until = now() + interval '10 minutes' from picked where r.id = picked.id
    returning r.id, r.candidate_id, r.storage_path, r.mime_type, r.byte_size, picked.t)
  select l.id, l.candidate_id, l.storage_path, l.mime_type, l.byte_size, l.t, private.latest_consent(l.candidate_id, 'resume_parsing') from leased l;
end $$;

-- verdict: clean | infected | rejected (failed structural checks) | error (retry) | unavailable (no scanner configured)
create or replace function public.resume_scan_report(p_resume uuid, p_verdict text, p_engine text, p_detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.resumes%rowtype;
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into r from public.resumes where id = p_resume for update;
  if r.id is null or r.scan_status <> 'pending' then return; end if;
  if p_verdict = 'clean' then
    update public.resumes set scan_status = 'clean', scan_engine = left(p_engine, 60), scan_detail = left(p_detail, 300), scanned_at = now(), lease_until = null where id = r.id;
    perform private.notify(r.candidate_id, 'resume.ready', 'Your resume passed security checks', 'It is now attached to your profile and applications.');
  elsif p_verdict in ('infected', 'rejected') then
    update public.resumes set scan_status = case when p_verdict = 'infected' then 'infected' else 'failed' end, active = false,
      scan_engine = left(p_engine, 60), scan_detail = left(coalesce(p_detail, p_verdict), 300), scanned_at = now(), lease_until = null where id = r.id;
    perform private.notify(r.candidate_id, 'resume.blocked', 'Your resume could not be accepted', 'Open KaamSetu to see why and upload a different file.');
  elsif p_verdict = 'error' then
    update public.resumes set scan_attempts = scan_attempts + 1, scan_detail = left(p_detail, 300), lease_until = null,
      scan_status = case when scan_attempts + 1 >= 5 then 'failed' else 'pending' end,
      scan_next_attempt_at = now() + make_interval(mins => (power(2, least(scan_attempts + 1, 8)))::int) where id = r.id;
  elsif p_verdict = 'unavailable' then
    update public.resumes set scan_detail = 'awaiting_scanner', scan_next_attempt_at = now() + interval '1 hour', lease_until = null where id = r.id;
  else
    raise exception 'Unknown verdict' using errcode = '22023';
  end if;
  insert into private.audit_events (actor_id, action, target_type, target_id, metadata)
  values (null, 'resume.scan.' || p_verdict, 'resume', r.id, jsonb_build_object('engine', left(p_engine, 60)));
end $$;

-- status: complete (with suggestions) | skipped (no consent) | unavailable (no parser) | failed
create or replace function public.resume_parse_report(p_resume uuid, p_status text, p_data jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.resumes%rowtype;
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_status not in ('complete', 'skipped', 'unavailable', 'failed') then raise exception 'Unknown status' using errcode = '22023'; end if;
  select * into r from public.resumes where id = p_resume for update;
  if r.id is null or r.scan_status <> 'clean' or r.deleted_at is not null then return; end if;
  if p_status = 'complete' and not private.latest_consent(r.candidate_id, 'resume_parsing') then p_status := 'skipped'; end if;
  update public.resumes set parse_status = p_status, lease_until = null where id = r.id;
  if p_status = 'complete' and p_data is not null then
    insert into public.resume_extractions (resume_id, candidate_id, data) values (r.id, r.candidate_id, p_data) on conflict (resume_id) do nothing;
    perform private.notify(r.candidate_id, 'resume.suggestions', 'Profile suggestions are ready', 'Review the details we found in your resume before adding them.');
  end if;
end $$;

create or replace function public.resume_mark_purged(p_resume uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  update public.resumes set purged_at = now(), lease_until = null where id = p_resume and deleted_at is not null;
end $$;

-- Re-queue parsing when consent is granted after upload.
create or replace function public.set_consent(p_purpose text, p_granted boolean, p_notice_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if p_purpose not in ('resume_parsing','matching','employer_discovery','contact_sharing','marketing','ai_coaching') then
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
  end if;
end $$;

-- Employer access to an applicant's resume. Returns a storage path for a 60-second signed URL; every call is logged.
create or replace function public.get_applicant_resume(p_application uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); a public.applications%rowtype; comp uuid; path text;
begin
  select a2.* into a from public.applications a2 where a2.id = p_application;
  select company_id into comp from public.jobs where id = a.job_id;
  if a.id is null or comp is null or not private.is_company_member(comp, array['owner','recruiter']::public.company_role[]) then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if not private.company_is_approved(comp) then raise exception 'Company is not verified' using errcode = '55000'; end if;
  if a.stage = 'withdrawn' then raise exception 'This application was withdrawn' using errcode = '55000'; end if;
  select storage_path into path from public.resumes where candidate_id = a.candidate_id and active and deleted_at is null and scan_status = 'clean';
  if path is null then raise exception 'No security-checked resume is available for this candidate' using errcode = 'P0002'; end if;
  insert into public.contact_disclosures (application_id, candidate_id, company_id, disclosed_to, fields) values (a.id, a.candidate_id, comp, uid, array['resume']);
  perform private.audit('resume.disclosed', 'application', a.id, comp);
  return path;
end $$;

------------------------------------------------------------------------------
-- 5. Email outbox: categories, leases (no double send), late opt-out, address snapshot
------------------------------------------------------------------------------
alter table private.email_outbox
  add column if not exists category text not null default 'essential',
  add column if not exists address text,
  add column if not exists lease_until timestamptz;
alter table private.email_outbox drop constraint if exists email_outbox_status_check;
alter table private.email_outbox add constraint email_outbox_status_check check (status in ('pending','sending','sent','failed','suppressed'));
alter table private.email_outbox drop constraint if exists email_outbox_category_check;
alter table private.email_outbox add constraint email_outbox_category_check check (category in ('security','essential','optional'));

create or replace function private.email_category(p_kind text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_kind like 'security.%' or p_kind like 'privacy.%' then 'security'
    when p_kind in ('application.viewed','application.received','invitation.accepted','invitation.declined',
                    'interview.confirmed','interview.reschedule_requested','resume.suggestions','account.registered') then 'optional'
    else 'essential' end;
$$;
update private.email_outbox set category = private.email_category(kind);

create or replace function private.notify(p_recipient uuid, p_kind text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (recipient_id, kind, title, body) values (p_recipient, p_kind, p_title, p_body);
  if exists (select 1 from public.profiles where id = p_recipient and status = 'active' and email is not null) then
    insert into private.email_outbox (recipient_id, kind, subject, category) values (p_recipient, p_kind, p_title, private.email_category(p_kind));
  end if;
end $$;

-- Employers now receive email for company events too.
create or replace function private.notify_company(p_company uuid, p_roles public.company_role[], p_kind text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  for m in select cm.user_id from public.company_members cm where cm.company_id = p_company and cm.active and cm.role = any(p_roles) loop
    perform private.notify(m.user_id, p_kind, p_title, p_body);
  end loop;
end $$;

drop function if exists public.outbox_claim(integer);
create function public.outbox_claim(p_limit integer default 20)
returns table (id uuid, recipient_email text, kind text, category text, subject text, unsubscribe_token uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  -- Expired leases (worker crashed mid-send) go back to the queue.
  update private.email_outbox set status = 'pending', lease_until = null where status = 'sending' and lease_until < now();
  -- Optional mail is re-checked against the CURRENT preference, so a late opt-out still applies.
  update private.email_outbox o set status = 'suppressed'
   where o.status = 'pending' and o.category = 'optional'
     and exists (select 1 from public.notification_preferences np where np.user_id = o.recipient_id and not np.email_updates);
  -- No address any more (deleted or email removed): fail visibly instead of retrying forever.
  update private.email_outbox o set status = 'failed', last_error = 'no_recipient_address'
   where o.status = 'pending' and o.address is null
     and not exists (select 1 from public.profiles p where p.id = o.recipient_id and p.email is not null and p.status = 'active');
  insert into public.notification_preferences (user_id)
    select distinct o.recipient_id from private.email_outbox o where o.status = 'pending' on conflict do nothing;
  return query
  with due as (
    select o.id from private.email_outbox o where o.status = 'pending' and o.next_attempt_at <= now()
    order by o.created_at limit least(greatest(coalesce(p_limit, 20), 1), 100) for update skip locked),
  leased as (
    update private.email_outbox o set status = 'sending', lease_until = now() + interval '10 minutes'
    from due where o.id = due.id returning o.id, o.recipient_id, o.kind, o.category, o.subject, o.address)
  select l.id, coalesce(l.address, p.email), l.kind, l.category, l.subject, np.unsubscribe_token
  from leased l left join public.profiles p on p.id = l.recipient_id
  left join public.notification_preferences np on np.user_id = l.recipient_id;
end $$;

drop function if exists public.outbox_report(uuid, boolean, text);
create function public.outbox_report(p_id uuid, p_ok boolean, p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_ok then
    update private.email_outbox set status = 'sent', sent_at = now(), attempts = attempts + 1, lease_until = null where id = p_id and status = 'sending';
  else
    update private.email_outbox set attempts = attempts + 1, last_error = left(p_error, 300), lease_until = null,
      status = case when attempts + 1 >= 5 then 'failed' else 'pending' end,
      next_attempt_at = now() + make_interval(mins => (power(2, attempts + 1))::int) where id = p_id and status = 'sending';
  end if;
  return found;
end $$;

create or replace function public.admin_email_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','support']);
begin
  return jsonb_build_object(
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from private.email_outbox group by 1) s), '{}'::jsonb),
    'oldest_pending_minutes', (select round(extract(epoch from now() - min(created_at)) / 60) from private.email_outbox where status = 'pending'),
    'last_sent_at', (select max(sent_at) from private.email_outbox));
end $$;

------------------------------------------------------------------------------
-- 6. Moderation holds: employers cannot republish jobs that KaamSetu paused or removed
------------------------------------------------------------------------------
alter table public.jobs add column if not exists moderation_hold text check (moderation_hold in ('admin','company_suspension'));

create or replace function public.set_job_status(p_job uuid, p_to public.job_status, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); j public.jobs%rowtype;
begin
  select * into j from public.jobs where id = p_job for update;
  if j.id is null or not private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[]) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if j.moderation_hold is not null and p_to = 'published' then
    raise exception 'This job is on hold by KaamSetu moderators. Contact support to resolve it.' using errcode = '55000';
  end if;
  if not ((j.status = 'published' and p_to in ('paused','closed'))
       or (j.status = 'paused' and p_to in ('published','closed'))
       or (j.status = 'closed' and p_to = 'published')) then
    raise exception 'A % job cannot become %', j.status, p_to using errcode = '55000';
  end if;
  if p_to = 'published' and not private.company_is_approved(j.company_id) then
    raise exception 'Company is not verified' using errcode = '55000';
  end if;
  if p_to = 'published' and j.closes_at is not null and j.closes_at <= now() then
    raise exception 'Update the closing date before reopening' using errcode = '22023';
  end if;
  perform private.set_job_status(p_job, p_to, left(p_reason, 500), uid);
  perform private.audit('job.status.' || p_to, 'job', p_job, j.company_id);
end $$;

create or replace function public.admin_review_job(p_job uuid, p_decision text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','moderator']); j public.jobs%rowtype; v_reason text := private.require_reason(p_reason); new_st public.job_status;
begin
  select * into j from public.jobs where id = p_job for update;
  if j.id is null then raise exception 'Job not found' using errcode = 'P0002'; end if;
  new_st := case
    when p_decision = 'approve' and j.status = 'pending_review' then 'published'
    when p_decision = 'reject' and j.status = 'pending_review' then 'rejected'
    when p_decision = 'pause' and j.status = 'published' then 'paused'
    when p_decision = 'remove' and j.status in ('published','paused','pending_review') then 'closed'
    when p_decision = 'reinstate' and j.moderation_hold = 'admin' and j.status in ('paused','closed') then 'paused'
    else null end;
  if new_st is null then raise exception 'Decision "%" is not allowed for a % job', p_decision, j.status using errcode = '55000'; end if;
  if new_st = 'published' and not private.company_is_approved(j.company_id) then
    raise exception 'Company is not verified' using errcode = '55000';
  end if;
  if new_st is distinct from j.status then perform private.set_job_status(p_job, new_st, v_reason, uid); end if;
  update public.jobs set moderation_hold = case when p_decision in ('pause','remove') then 'admin' when p_decision = 'reinstate' then null else moderation_hold end
   where id = p_job;
  perform private.notify_company(j.company_id, array['owner','recruiter']::public.company_role[], 'job.' || p_decision,
    'Job review update', 'A job review decision is available in KaamSetu.');
  perform private.audit('job.' || p_decision, 'job', p_job, j.company_id, jsonb_build_object('reason', v_reason));
end $$;

create or replace function public.admin_review_company(p_company uuid, p_decision text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','moderator']); st public.verification_status; v_reason text := private.require_reason(p_reason); new_st public.verification_status; r record;
begin
  select verification_status into st from public.companies where id = p_company for update;
  if st is null then raise exception 'Company not found' using errcode = 'P0002'; end if;
  new_st := case
    when p_decision = 'approve' and st = 'pending' then 'approved'
    when p_decision = 'reject' and st = 'pending' then 'rejected'
    when p_decision = 'request_info' and st = 'pending' then 'draft'
    when p_decision = 'suspend' and st = 'approved' then 'suspended'
    when p_decision = 'restore' and st = 'suspended' then 'approved'
    else null end;
  if new_st is null then
    raise exception 'Decision "%" is not allowed while the company is %', p_decision, st using errcode = '55000';
  end if;
  update public.companies set verification_status = new_st, verification_reason = v_reason, updated_at = now() where id = p_company;
  update private.company_verifications set decision = new_st, reviewed_by = uid, reviewed_at = now(), reason = v_reason
   where id = (select id from private.company_verifications where company_id = p_company order by created_at desc limit 1);
  if new_st = 'suspended' then
    for r in select id, status from public.jobs where company_id = p_company and status = 'published' loop
      update public.jobs set status = 'paused', moderation_hold = coalesce(moderation_hold, 'company_suspension'), updated_at = now() where id = r.id;
      insert into public.job_events (job_id, from_status, to_status, actor_id, reason) values (r.id, r.status, 'paused', uid, 'Company suspended');
    end loop;
  elsif p_decision = 'restore' then
    -- Jobs stay paused; the employer may resume them once the suspension hold is lifted.
    update public.jobs set moderation_hold = null where company_id = p_company and moderation_hold = 'company_suspension';
  end if;
  perform private.notify_company(p_company, array['owner','recruiter']::public.company_role[], 'company.' || p_decision,
    'Company verification update', 'Your company verification status changed. Open KaamSetu to read the details.');
  perform private.audit('company.' || p_decision, 'company', p_company, p_company, jsonb_build_object('from', st, 'to', new_st, 'reason', v_reason));
end $$;

drop function if exists public.company_jobs(uuid);
create function public.company_jobs(p_company uuid)
returns table (job_id uuid, title text, status public.job_status, moderation_hold text, work_mode text, city text, salary_min integer, salary_max integer,
  salary_period text, applicants integer, new_applicants integer, published_at timestamptz, created_at timestamptz, closes_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not private.is_company_member(p_company) then raise exception 'Company not found' using errcode = 'P0002'; end if;
  return query select j.id, j.title, j.status, j.moderation_hold, j.work_mode, l.city, j.salary_min, j.salary_max, j.salary_period,
    (select count(*)::int from public.applications a where a.job_id = j.id and a.stage <> 'withdrawn'),
    (select count(*)::int from public.applications a where a.job_id = j.id and a.stage = 'applied'),
    j.published_at, j.created_at, j.closes_at
    from public.jobs j left join public.locations l on l.id = j.location_id where j.company_id = p_company order by j.created_at desc;
end $$;

drop function if exists public.admin_job_queue(public.job_status);
create function public.admin_job_queue(p_status public.job_status default 'pending_review')
returns table (job_id uuid, title text, description text, company_id uuid, company_name text, company_status public.verification_status,
  salary_min integer, salary_max integer, salary_period text, work_mode text, city text, skills text[], moderation_hold text, submitted_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','moderator']);
begin
  return query select j.id, j.title, j.description, c.id, c.display_name, c.verification_status, j.salary_min, j.salary_max, j.salary_period, j.work_mode, l.city,
    coalesce((select array_agg(s.name order by s.name) from public.job_skills js join public.skills s on s.id = js.skill_id where js.job_id = j.id), '{}'::text[]),
    j.moderation_hold, (select max(e.created_at) from public.job_events e where e.job_id = j.id)
  from public.jobs j join public.companies c on c.id = j.company_id left join public.locations l on l.id = j.location_id
  where j.status = p_status order by 14;
end $$;

------------------------------------------------------------------------------
-- 7. Column-level read access; company identity edits only via RPC
------------------------------------------------------------------------------
revoke select on public.companies from authenticated;
grant select (id, display_name, website, description, city, verification_status, industry, company_size, operating_locations, created_at)
  on public.companies to authenticated;
revoke update on public.companies from authenticated;

revoke select on public.jobs from anon, authenticated;
grant select (id, company_id, title, category_id, description, salary_min, salary_max, salary_period, experience_min_months, experience_max_months,
  location_id, work_mode, employment_type, vacancies, status, closes_at, published_at, created_at, updated_at, moderation_hold)
  on public.jobs to anon, authenticated;

create or replace function public.my_membership()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  return (select jsonb_build_object('role', cm.role, 'company', to_jsonb(c))
          from public.company_members cm join public.companies c on c.id = cm.company_id
          where cm.user_id = uid and cm.active limit 1);
end $$;

-- Identity fields (brand, website, address) can change only before approval; after approval they need support review.
create or replace function public.update_company_profile(p_company uuid, p_fields jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); st public.verification_status; locked boolean; k text;
begin
  if not private.is_company_member(p_company, array['owner']::public.company_role[]) then raise exception 'Only owners can edit the company profile' using errcode = '42501'; end if;
  select verification_status into st from public.companies where id = p_company for update;
  locked := st in ('pending', 'approved', 'suspended');
  for k in select jsonb_object_keys(p_fields) loop
    if k not in ('display_name','website','registered_address','description','industry','company_size','city','operating_locations') then
      raise exception 'Unknown field %', k using errcode = '22023';
    end if;
    if locked and k in ('display_name','website','registered_address') then
      raise exception 'Brand name, website and address can be changed only by KaamSetu support after verification' using errcode = '55000';
    end if;
  end loop;
  if p_fields ? 'website' and nullif(trim(p_fields->>'website'), '') is not null and trim(p_fields->>'website') !~* '^https?://[^\s]+$' then
    raise exception 'Website must start with http:// or https://' using errcode = '22023';
  end if;
  update public.companies set
    display_name = case when p_fields ? 'display_name' then coalesce(nullif(left(trim(p_fields->>'display_name'), 120), ''), display_name) else display_name end,
    website = case when p_fields ? 'website' then nullif(trim(p_fields->>'website'), '') else website end,
    registered_address = case when p_fields ? 'registered_address' then nullif(left(trim(p_fields->>'registered_address'), 500), '') else registered_address end,
    description = case when p_fields ? 'description' then nullif(left(trim(p_fields->>'description'), 3000), '') else description end,
    industry = case when p_fields ? 'industry' then nullif(left(trim(p_fields->>'industry'), 100), '') else industry end,
    company_size = case when p_fields ? 'company_size' then nullif(p_fields->>'company_size', '') else company_size end,
    city = case when p_fields ? 'city' then nullif(left(trim(p_fields->>'city'), 100), '') else city end,
    operating_locations = case when p_fields ? 'operating_locations' then coalesce((select array_agg(left(trim(x), 100)) from jsonb_array_elements_text(p_fields->'operating_locations') x where trim(x) <> ''), '{}') else operating_locations end,
    updated_at = now()
  where id = p_company;
  perform private.audit('company.profile_updated', 'company', p_company, p_company, jsonb_build_object('fields', (select jsonb_agg(k2) from jsonb_object_keys(p_fields) k2)));
end $$;

-- v1.3.0 created companies directly as "pending" without a verification record; return them to draft so owners can submit.
update public.companies c set verification_status = 'draft', updated_at = now()
 where c.verification_status = 'pending' and not exists (select 1 from private.company_verifications v where v.company_id = c.id);

------------------------------------------------------------------------------
-- 8. Abuse limits and safe pattern matching
------------------------------------------------------------------------------
create or replace function private.like_escape(p text)
returns text language sql immutable set search_path = '' as $$
  select replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

create or replace function private.enforce_quota(p_action text, p_company uuid, p_actor uuid, p_limit integer, p_window interval)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if (select count(*) from private.audit_events a where a.action = p_action and a.created_at > now() - p_window
        and (p_company is null or a.company_id = p_company) and (p_actor is null or a.actor_id = p_actor)) >= p_limit then
    raise exception 'Limit reached. Please try again later.' using errcode = '54000';
  end if;
end $$;

drop function if exists public.search_candidates(uuid, text, text, integer, integer, integer, integer);
create function public.search_candidates(
  p_job uuid, p_skill text default null, p_city text default null,
  p_min_months integer default null, p_max_months integer default null, p_max_salary integer default null, p_limit integer default 25)
returns table (candidate_id uuid, headline text, city text, locality text, experience_months integer,
               expected_salary integer, salary_period text, notice_days integer, skills text[], score numeric, match jsonb)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); j public.jobs%rowtype; lim integer := least(greatest(coalesce(p_limit, 25), 1), 50);
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[]) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if not private.job_is_public(p_job) then raise exception 'Candidate discovery requires a published job of a verified company' using errcode = '55000'; end if;
  perform private.enforce_quota('candidate.search', j.company_id, null, 60, interval '1 hour');
  perform private.audit('candidate.search', 'job', p_job, j.company_id,
    jsonb_build_object('skill', left(p_skill, 60), 'city', left(p_city, 60), 'min_months', p_min_months, 'max_months', p_max_months));
  return query
  select q.user_id, q.headline, q.city, q.locality, q.experience_months, q.salary_min, q.salary_period, q.notice_days, q.skill_names,
         (q.m->>'score')::numeric, q.m
  from (
    select f.*, private.match_score(f.user_id, p_job) as m
    from (
      select cp.user_id, cp.headline, l.city, l.locality, cp.experience_months, cp.salary_min, cp.salary_period, cp.notice_days,
        coalesce((select array_agg(s.name order by s.name) from public.candidate_skills cs join public.skills s on s.id = cs.skill_id
                  where cs.candidate_id = cp.user_id and cs.confirmed), '{}'::text[]) as skill_names
      from public.candidate_profiles cp
      join public.profiles p on p.id = cp.user_id and p.status = 'active' and p.account_kind = 'candidate'
      left join public.locations l on l.id = cp.current_location_id
      where cp.discovery_enabled
        and not exists (select 1 from public.applications a where a.job_id = p_job and a.candidate_id = cp.user_id)
        and not exists (select 1 from public.job_invitations i where i.job_id = p_job and i.candidate_id = cp.user_id)
        and (p_city is null or l.city = p_city)
        and (p_min_months is null or cp.experience_months >= p_min_months)
        and (p_max_months is null or cp.experience_months <= p_max_months)
        and (p_max_salary is null or cp.salary_min is null or private.annual_salary(cp.salary_min, cp.salary_period) <= p_max_salary)
        and (p_skill is null or exists (select 1 from public.candidate_skills cs join public.skills s on s.id = cs.skill_id
              where cs.candidate_id = cp.user_id and cs.confirmed and lower(s.name) = lower(trim(p_skill))))
      order by cp.updated_at desc
      limit 500) f
  ) q
  where (q.m->>'eligible')::boolean
  order by (q.m->>'score')::numeric desc, q.user_id
  limit lim;
end $$;

create or replace function public.invite_candidate(p_job uuid, p_candidate uuid, p_message text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); j public.jobs%rowtype; inv uuid;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[]) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if not private.job_is_public(p_job) then raise exception 'Only published jobs of verified companies can invite candidates' using errcode = '55000'; end if;
  perform private.enforce_quota('invitation.sent', j.company_id, null, 100, interval '1 day');
  if not exists (select 1 from public.candidate_profiles cp join public.profiles p on p.id = cp.user_id
                 where cp.user_id = p_candidate and cp.discovery_enabled and p.status = 'active') then
    raise exception 'Candidate is not available for invitations' using errcode = '55000';
  end if;
  if exists (select 1 from public.applications where job_id = p_job and candidate_id = p_candidate) then
    raise exception 'Candidate has already applied' using errcode = '23505';
  end if;
  insert into public.job_invitations (job_id, candidate_id, sent_by, message)
  values (p_job, p_candidate, uid, left(nullif(trim(p_message), ''), 1000))
  on conflict (job_id, candidate_id) do nothing returning id into inv;
  if inv is null then raise exception 'Candidate has already been invited to this job' using errcode = '23505'; end if;
  perform private.notify(p_candidate, 'invitation.received', 'New employer invitation', 'An employer invited you to apply. Open KaamSetu to respond.');
  perform private.audit('invitation.sent', 'invitation', inv, j.company_id);
  return inv;
end $$;

create or replace function public.report_job(p_job uuid, p_category text, p_details text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); rid uuid; comp uuid;
begin
  if (select count(*) from public.abuse_reports where reporter_id = uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Limit reached. Please try again later.' using errcode = '54000';
  end if;
  select company_id into comp from public.jobs where id = p_job and (private.job_is_public(id) or exists (select 1 from public.applications a where a.job_id = p_job and a.candidate_id = uid));
  if comp is null then raise exception 'Job not found' using errcode = 'P0002'; end if;
  insert into public.abuse_reports (reporter_id, job_id, company_id, category, details)
  values (uid, p_job, comp, p_category, left(nullif(trim(p_details), ''), 1000)) returning id into rid;
  return rid;
end $$;

drop function if exists public.admin_find_user(text);
create function public.admin_find_user(p_query text)
returns table (user_id uuid, display_name text, email text, phone text, account_kind text, status public.account_status, created_at timestamptz, roles text[])
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','support','privacy']); q text := lower(trim(p_query)); e text;
begin
  if char_length(q) < 3 then raise exception 'Enter at least 3 characters' using errcode = '22023'; end if;
  e := private.like_escape(q);
  perform private.audit('admin.user_lookup', 'user', null, null, jsonb_build_object('query_length', char_length(q)));
  return query select p.id, p.display_name, p.email, p.phone, p.account_kind, p.status, p.created_at,
      coalesce((select array_agg(r.role) from private.app_roles r where r.user_id = p.id), '{}'::text[])
    from public.profiles p
    where lower(p.email) like e || '%' escape '\' or p.phone like e || '%' escape '\' or lower(p.display_name) like '%' || e || '%' escape '\'
    order by p.created_at desc limit 20;
end $$;

------------------------------------------------------------------------------
-- 9. Contact disclosure marks unverified phone numbers
------------------------------------------------------------------------------
drop function if exists public.get_applicant_contact(uuid);
create function public.get_applicant_contact(p_application uuid)
returns table (email text, email_verified boolean, phone text, phone_verified boolean) language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); a public.applications%rowtype; comp uuid;
begin
  select a2.* into a from public.applications a2 where a2.id = p_application;
  select company_id into comp from public.jobs where id = a.job_id;
  if a.id is null or comp is null or not private.is_company_member(comp, array['owner','recruiter']::public.company_role[]) then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if not private.company_is_approved(comp) then raise exception 'Company is not verified' using errcode = '55000'; end if;
  if a.stage not in ('shortlisted','interview','offer','hired') then
    raise exception 'Contact details are available after shortlisting' using errcode = '42501';
  end if;
  if not private.latest_consent(a.candidate_id, 'contact_sharing') then
    raise exception 'The candidate has not agreed to share contact details' using errcode = '42501';
  end if;
  insert into public.contact_disclosures (application_id, candidate_id, company_id, disclosed_to, fields)
  values (a.id, a.candidate_id, comp, uid, array['email','phone']);
  perform private.audit('contact.disclosed', 'application', a.id, comp);
  return query select p.email, p.email_verified_at is not null, p.phone, p.phone_verified_at is not null from public.profiles p where p.id = a.candidate_id;
end $$;

------------------------------------------------------------------------------
-- 10. Account deletion that can actually finish on real Supabase
--     SQL anonymises; the trusted worker then scrubs the auth identity (frees email/phone, bans sign-in)
--     and purges storage by folder prefix, and reports back here.
------------------------------------------------------------------------------
-- A suspended company may lose its last owner (needed to delete abusive or test employer accounts).
-- Any other company must always keep at least one active owner.
create or replace function private.guard_last_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active)
     and not exists (
       select 1 from public.company_members cm
       where cm.company_id = old.company_id and cm.role = 'owner' and cm.active and cm.user_id <> old.user_id)
     and exists (select 1 from public.companies c where c.id = old.company_id and c.verification_status <> 'suspended') then
    raise exception 'A company must keep at least one active owner' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.admin_process_deletion(p_request uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','privacy']); v_reason text := private.require_reason(p_reason);
  pr public.privacy_requests%rowtype; v_email text;
begin
  select * into pr from public.privacy_requests where id = p_request and kind = 'deletion' and status = 'requested' for update;
  if pr.id is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if exists (select 1 from private.app_roles where user_id = pr.user_id) then
    raise exception 'Remove administrator roles before deleting this account' using errcode = '55000';
  end if;
  if exists (select 1 from public.company_members m join public.companies c on c.id = m.company_id
             where m.user_id = pr.user_id and m.active and m.role = 'owner' and c.verification_status <> 'suspended'
             and not exists (select 1 from public.company_members o where o.company_id = m.company_id and o.active and o.role = 'owner' and o.user_id <> pr.user_id)) then
    raise exception 'The user is the only owner of an active company. Transfer ownership, or suspend the company first.' using errcode = '55000';
  end if;
  select email into v_email from public.profiles where id = pr.user_id;
  update public.resumes set deleted_at = coalesce(deleted_at, now()), active = false where candidate_id = pr.user_id;
  delete from public.candidate_skills where candidate_id = pr.user_id;
  delete from public.candidate_locations where candidate_id = pr.user_id;
  delete from public.candidate_education where candidate_id = pr.user_id;
  delete from public.candidate_experience where candidate_id = pr.user_id;
  delete from public.candidate_certifications where candidate_id = pr.user_id;
  delete from public.candidate_languages where candidate_id = pr.user_id;
  delete from public.saved_jobs where candidate_id = pr.user_id;
  delete from public.resume_extractions where candidate_id = pr.user_id;
  delete from public.notifications where recipient_id = pr.user_id;
  delete from private.email_outbox where recipient_id = pr.user_id;
  update public.candidate_profiles set headline = null, salary_min = null, current_salary = null, current_location_id = null,
    notice_days = null, discovery_enabled = false, photo_path = null, employment_status = null, profile_complete = false, updated_at = now()
   where user_id = pr.user_id;
  update public.applications set stage = 'withdrawn', updated_at = now() where candidate_id = pr.user_id and stage not in ('hired','rejected','withdrawn');
  update public.applications set note = null, match_snapshot = null where candidate_id = pr.user_id;
  update public.job_invitations set status = 'cancelled', message = null, updated_at = now() where candidate_id = pr.user_id and status = 'pending';
  update public.company_members set active = false where user_id = pr.user_id;
  update public.profiles set display_name = 'Deleted user', email = null, phone = null, email_verified_at = null,
    phone_verified_at = null, status = 'deleted', updated_at = now() where id = pr.user_id;
  update public.privacy_requests set status = 'completed', completed_at = now(), handled_by = uid, note = v_reason,
    result = jsonb_build_object('auth_scrub', 'pending', 'storage_purge', 'pending', 'storage_prefix', pr.user_id::text) where id = p_request;
  if v_email is not null then
    insert into private.email_outbox (recipient_id, kind, subject, category, address)
    values (pr.user_id, 'privacy.deletion_completed', 'Your KaamSetu account has been deleted', 'security', v_email);
  end if;
  perform private.audit('privacy.deletion_completed', 'user', pr.user_id, null, jsonb_build_object('request', p_request, 'reason', v_reason));
  return jsonb_build_object('auth_scrub', 'pending', 'storage_purge', 'pending');
end $$;

create or replace function public.privacy_deletions_pending()
returns table (request_id uuid, user_id uuid) language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  return query select r.id, r.user_id from public.privacy_requests r
    where r.kind = 'deletion' and r.status = 'completed' and (r.result->>'auth_scrub' = 'pending' or r.result->>'storage_purge' = 'pending');
end $$;

create or replace function public.privacy_mark_processed(p_request uuid, p_step text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_step not in ('auth_scrub', 'storage_purge') then raise exception 'Unknown step' using errcode = '22023'; end if;
  update public.privacy_requests set result = coalesce(result, '{}'::jsonb) || jsonb_build_object(p_step, 'done', p_step || '_at', now())
   where id = p_request and kind = 'deletion' and status = 'completed';
  insert into private.audit_events (actor_id, action, target_type, target_id) values (null, 'privacy.' || p_step || '_done', 'privacy_request', p_request);
end $$;

create or replace function public.run_retention_jobs()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d1 int; d2 int; d3 int; d4 int; n1 int; n2 int; n3 int; n4 int;
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  select days into d1 from public.retention_policies where key = 'read_notifications';
  select days into d2 from public.retention_policies where key = 'email_outbox';
  select days into d3 from public.retention_policies where key = 'stale_invitations';
  select days into d4 from public.retention_policies where key = 'deleted_account_requests';
  delete from public.notifications where read_at is not null and read_at < now() - make_interval(days => d1); get diagnostics n1 = row_count;
  delete from private.email_outbox where status in ('sent','failed','suppressed') and created_at < now() - make_interval(days => d2); get diagnostics n2 = row_count;
  delete from public.job_invitations where status in ('expired','declined','cancelled') and updated_at < now() - make_interval(days => d3); get diagnostics n3 = row_count;
  delete from public.privacy_requests where status in ('completed','rejected','cancelled') and coalesce(completed_at, created_at) < now() - make_interval(days => d4)
     and (kind <> 'deletion' or (result->>'auth_scrub' = 'done' and result->>'storage_purge' = 'done')); get diagnostics n4 = row_count;
  return jsonb_build_object('notifications', n1, 'email_outbox', n2, 'invitations', n3, 'privacy_requests', n4);
end $$;

------------------------------------------------------------------------------
-- 11. Admin visibility for the new pipelines
------------------------------------------------------------------------------
create or replace function public.admin_dashboard()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','moderator','support','privacy']);
begin
  return jsonb_build_object(
    'companies_pending', (select count(*) from public.companies where verification_status = 'pending'),
    'jobs_pending', (select count(*) from public.jobs where status = 'pending_review'),
    'reports_open', (select count(*) from public.abuse_reports where status in ('open','reviewing')),
    'privacy_open', (select count(*) from public.privacy_requests where status = 'requested'),
    'privacy_cleanup_pending', (select count(*) from public.privacy_requests where kind = 'deletion' and status = 'completed' and (result->>'auth_scrub' = 'pending' or result->>'storage_purge' = 'pending')),
    'email_failures', (select count(*) from private.email_outbox where status = 'failed'),
    'email_pending', (select count(*) from private.email_outbox where status in ('pending','sending')),
    'email_oldest_pending_minutes', (select round(extract(epoch from now() - min(created_at)) / 60) from private.email_outbox where status = 'pending'),
    'resumes_quarantined', (select count(*) from public.resumes where deleted_at is null and scan_status = 'pending'),
    'resumes_blocked', (select count(*) from public.resumes where deleted_at is null and scan_status in ('infected','failed')),
    'candidates', (select count(*) from public.profiles where account_kind = 'candidate' and status = 'active'),
    'employers', (select count(*) from public.profiles where account_kind = 'employer' and status = 'active'),
    'published_jobs', (select count(*) from public.jobs where status = 'published'),
    'applications', (select count(*) from public.applications),
    'audit_events_24h', (select count(*) from private.audit_events where created_at > now() - interval '24 hours'),
    'roles', coalesce((select jsonb_agg(role) from private.app_roles where user_id = uid), '[]'::jsonb));
end $$;

create or replace function public.admin_resume_queue()
returns table (resume_id uuid, scan_status text, scan_detail text, scan_attempts integer, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','support']);
begin
  return query select r.id, r.scan_status, r.scan_detail, r.scan_attempts, r.created_at from public.resumes r
    where r.deleted_at is null and r.scan_status in ('pending','failed','infected') order by r.created_at limit 200;
end $$;

create or replace function public.admin_retry_resume_scan(p_resume uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','support']); v_reason text := private.require_reason(p_reason);
begin
  update public.resumes set scan_status = 'pending', scan_attempts = 0, scan_next_attempt_at = now(), scan_detail = null, lease_until = null
   where id = p_resume and deleted_at is null and scan_status = 'failed';
  if not found then raise exception 'Only failed scans can be retried' using errcode = '55000'; end if;
  perform private.audit('resume.scan_retry', 'resume', p_resume, null, jsonb_build_object('reason', v_reason));
end $$;

------------------------------------------------------------------------------
-- 12. Function privileges (explicit; service-role entry points granted only to service_role)
------------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      -- Never touch event-trigger functions (e.g. Supabase's rls_auto_enable): revoking PUBLIC EXECUTE breaks DDL by other roles.
      and p.prorettype <> 'event_trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;
grant execute on function private.is_company_member(uuid, public.company_role[]) to authenticated;
grant execute on function private.is_admin(text[]) to authenticated;
grant execute on function private.company_is_approved(uuid) to authenticated, anon;
grant execute on function private.job_is_public(uuid) to authenticated, anon;
grant execute on function private.job_is_editable(uuid) to authenticated;
grant execute on function private.user_is_active() to authenticated;
grant execute on function private.owner_can_read_resume(text) to authenticated;
grant execute on function private.employer_can_read_resume(text) to authenticated;
grant execute on function public.schema_version() to anon;

do $$
declare f text;
begin
  foreach f in array array['public.expire_stale_invitations()', 'public.run_retention_jobs()', 'public.outbox_claim(integer)',
    'public.outbox_report(uuid, boolean, text)', 'public.unsubscribe_by_token(uuid)', 'public.resume_work_claim(integer)',
    'public.resume_scan_report(uuid, text, text, text)', 'public.resume_parse_report(uuid, text, jsonb)', 'public.resume_mark_purged(uuid)',
    'public.privacy_deletions_pending()', 'public.privacy_mark_processed(uuid, text)'] loop
    execute format('revoke execute on function %s from authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on all tables in schema private from anon, authenticated;
