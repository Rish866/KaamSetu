-- 202611270002 Candidate consent & recruiter access log; consent audit; stage-aware data minimisation.
-- * discovery_views: every time a verified employer's candidate search returns a candidate's masked profile (written by
--   discover_candidates in 202611270003). Candidates see these; employers cannot.
-- * my_access_log(): per-purpose consent status plus every access by employers (masked profile in search, invitation,
--   resume opened, email/phone revealed, joining records) and by KaamSetu (resume reading), newest first.
-- * set_consent writes a PII-free audit event; withdrawing resume reading also cancels queued parsing.
-- * Resumes are no longer shared once an application is rejected (previously: only when withdrawn).

create table public.discovery_views (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  viewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index discovery_views_candidate_idx on public.discovery_views (candidate_id, created_at desc);
alter table public.discovery_views enable row level security;
create policy discovery_views_own on public.discovery_views for select to authenticated using (candidate_id = (select auth.uid()));
revoke all on public.discovery_views from anon, authenticated, service_role;
grant select (id, candidate_id, company_id, job_id, created_at) on public.discovery_views to authenticated;

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
  -- Auditable, PII-free record of the choice (purpose and notice version only).
  perform private.audit('consent.' || case when p_granted then 'granted' else 'withdrawn' end, 'consent', null, null,
    jsonb_build_object('purpose', p_purpose, 'notice_version', trim(p_notice_version)));
  if p_purpose = 'resume_parsing' and not p_granted then
    update public.resumes set parse_status = 'skipped' where candidate_id = uid and parse_status = 'pending';
  end if;
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
  -- Data minimisation: once an application is closed (withdrawn or rejected) the resume is no longer shared.
  if a.stage in ('withdrawn', 'rejected') then raise exception 'This application is closed, so the resume is no longer shared' using errcode = '55000'; end if;
  select storage_path into path from public.resumes where candidate_id = a.candidate_id and active and deleted_at is null and scan_status = 'clean';
  if path is null then raise exception 'No security-checked resume is available for this candidate' using errcode = 'P0002'; end if;
  insert into public.contact_disclosures (application_id, candidate_id, company_id, disclosed_to, fields) values (a.id, a.candidate_id, comp, uid, array['resume']);
  perform private.audit('resume.disclosed', 'application', a.id, comp);
  return path;
end $$;

create or replace function public.my_access_log(p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user(); lim integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  return jsonb_build_object(
    'consents', (select jsonb_agg(jsonb_build_object('purpose', pu, 'granted', coalesce(c.action = 'granted', false), 'since', c.created_at,
                    'notice_version', c.notice_version) order by ord)
                   from unnest(array['employer_discovery', 'contact_sharing', 'resume_parsing', 'joining_verification', 'marketing']) with ordinality as x(pu, ord)
                   left join lateral (select action, created_at, notice_version from public.consent_records r where r.user_id = uid and r.purpose = x.pu
                                      order by created_at desc, id desc limit 1) c on true),
    'events', coalesce((select jsonb_agg(e order by (e->>'at')::timestamptz desc) from (
      select jsonb_build_object('purpose', 'employer_discovery', 'what', 'Saw your masked profile in candidate search', 'company', co.display_name, 'job', j.title, 'at', v.created_at) e
        from public.discovery_views v join public.companies co on co.id = v.company_id left join public.jobs j on j.id = v.job_id where v.candidate_id = uid
      union all
      select jsonb_build_object('purpose', 'employer_discovery', 'what', 'Invited you to apply', 'company', co.display_name, 'job', j.title, 'at', i.created_at)
        from public.job_invitations i join public.jobs j on j.id = i.job_id join public.companies co on co.id = j.company_id where i.candidate_id = uid
      union all
      select jsonb_build_object('purpose', case when 'resume' = any(d.fields) then 'job_application' else 'contact_sharing' end,
               'what', case when 'resume' = any(d.fields) then 'Opened your resume (shared when you applied)' else 'Viewed your email and phone' end,
               'company', co.display_name, 'job', j.title, 'at', d.created_at)
        from public.contact_disclosures d join public.companies co on co.id = d.company_id join public.applications a on a.id = d.application_id
        join public.jobs j on j.id = a.job_id where d.candidate_id = uid
      union all
      select jsonb_build_object('purpose', 'joining_verification',
               'what', case when m.reported_role = 'employer' then 'Recorded: ' else 'Confirmed your report: ' end || private.milestone_label(m.kind),
               'company', co.display_name, 'job', j.title, 'at', case when m.reported_role = 'employer' then m.reported_at else m.confirmed_at end)
        from public.hiring_milestones m join public.companies co on co.id = m.company_id join public.applications a on a.id = m.application_id
        join public.jobs j on j.id = a.job_id
       where m.candidate_id = uid and m.kind in ('joined_day_1', 'candidate_no_show', 'retained_day_15', 'retained_day_30', 'left_before_day_30')
         and (m.reported_role = 'employer' or (m.confirmed_via = 'counterparty' and m.confirmed_at is not null))
      union all
      select jsonb_build_object('purpose', 'resume_parsing', 'what', 'KaamSetu read your resume to suggest profile details', 'company', null, 'job', null, 'at', x.created_at)
        from public.resume_extractions x where x.candidate_id = uid
      limit lim) t), '[]'::jsonb));
end $$;

create or replace function public.schema_version()
returns text language sql immutable set search_path = '' as $$ select '202611270002'::text $$;
revoke all on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated, service_role;
revoke all on function public.my_access_log(integer), public.set_consent(text, boolean, text), public.get_applicant_resume(uuid) from public, anon;
grant execute on function public.my_access_log(integer), public.set_consent(text, boolean, text), public.get_applicant_resume(uuid) to authenticated;
