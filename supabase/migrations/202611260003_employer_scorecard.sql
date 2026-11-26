-- 202611260003 Employer accountability scorecard and stale-job auto-pause.
-- Scorecard (last 365 days, computed live from the hiring record, never typed in by anyone):
--   response   median hours from application to the employer's first action; % answered within 7 days   (shown from 5 applications)
--   offers     % of offers made that were not withdrawn by the employer                                (shown from 3 offers)
--   joining    % of accepted offers where the candidate joined (confirmed joined vs confirmed no-show)   (shown from 3 outcomes)
--   retention  % still working at day 30 (confirmed day-30 vs confirmed left-early)                      (shown from 3 outcomes)
-- Below a threshold the metric is reported as "not enough data" and the company as a new employer. No invented numbers.
-- Stale jobs: a published job must be re-confirmed every 30 days. Reminder after 25 days, automatic pause after 30
-- (worker task, recorded as a system event). Publishing or resuming counts as confirmation.

alter table public.jobs
  add column last_confirmed_at timestamptz,
  add column stale_reminder_at timestamptz;
update public.jobs set last_confirmed_at = coalesce(published_at, updated_at, created_at) where status = 'published';
grant select (last_confirmed_at) on public.jobs to anon, authenticated;

-- System actions (automatic pause) have no human actor.
alter table public.job_events alter column actor_id drop not null;

create or replace function private.set_job_status(p_job uuid, p_to public.job_status, p_reason text, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare cur public.job_status;
begin
  select status into cur from public.jobs where id = p_job for update;
  update public.jobs set status = p_to, updated_at = now(),
    published_at = case when p_to = 'published' and published_at is null then now() else published_at end,
    last_confirmed_at = case when p_to = 'published' then now() else last_confirmed_at end,
    stale_reminder_at = case when p_to = 'published' then null else stale_reminder_at end
   where id = p_job;
  insert into public.job_events (job_id, from_status, to_status, actor_id, reason) values (p_job, cur, p_to, p_actor, p_reason);
end $$;

create or replace function public.confirm_job_active(p_job uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); j public.jobs%rowtype; t timestamptz := now();
begin
  select * into j from public.jobs where id = p_job for update;
  if j.id is null or not private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[]) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if j.status <> 'published' then raise exception 'Only a published job can be confirmed as still open' using errcode = '55000'; end if;
  update public.jobs set last_confirmed_at = t, stale_reminder_at = null where id = p_job;
  perform private.audit('job.confirmed_active', 'job', p_job, j.company_id);
  return t;
end $$;

create or replace function public.jobs_stale_sweep()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; reminded integer := 0; paused integer := 0;
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  for r in select id, company_id, title from public.jobs
            where status = 'published' and last_confirmed_at < now() - interval '30 days' for update loop
    perform private.set_job_status(r.id, 'paused', 'Paused automatically: not confirmed as still open for 30 days', null);
    perform private.notify_company(r.company_id, array['owner','recruiter']::public.company_role[], 'job.auto_paused',
      'A job was paused automatically', 'Open KaamSetu and resume it if the position is still open.');
    perform private.audit('job.auto_paused', 'job', r.id, r.company_id);
    paused := paused + 1;
  end loop;
  for r in update public.jobs set stale_reminder_at = now()
            where status = 'published' and stale_reminder_at is null and last_confirmed_at < now() - interval '25 days'
            returning id, company_id loop
    perform private.notify_company(r.company_id, array['owner','recruiter']::public.company_role[], 'job.confirm_needed',
      'Is this job still open?', 'Confirm it in KaamSetu within 5 days, or it will be paused automatically.');
    reminded := reminded + 1;
  end loop;
  return jsonb_build_object('reminded', reminded, 'paused', paused);
end $$;

------------------------------------------------------------------------------
-- Scorecard
------------------------------------------------------------------------------
create or replace function private.company_scorecard(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  since timestamptz := now() - interval '365 days';
  resp_n integer; resp_median numeric; resp_7d integer;
  offers integer; withdrawn integer; joined integer; no_show integer; kept integer; left_early integer; active integer;
  r jsonb; shown boolean;
begin
  with apps as (
    select a.id, a.applied_at, a.candidate_id,
      (select min(e.created_at) from public.application_events e
        where e.application_id = a.id and e.actor_id is distinct from a.candidate_id and e.to_stage <> 'applied') as responded_at,
      (select min(e.created_at) from public.application_events e
        where e.application_id = a.id and e.actor_id = a.candidate_id and e.to_stage = 'withdrawn') as withdrawn_at
    from public.applications a join public.jobs j on j.id = a.job_id
    where j.company_id = p_company and a.applied_at >= since
  ), counted as (
    -- An application counts once the employer answered, or once 7 days passed unanswered;
    -- applications the candidate withdrew before any answer are left out.
    select * from apps
     where (responded_at is not null or applied_at < now() - interval '7 days')
       and not (withdrawn_at is not null and (responded_at is null or withdrawn_at < responded_at))
  )
  select count(*), percentile_cont(0.5) within group (order by extract(epoch from (responded_at - applied_at)) / 3600.0) filter (where responded_at is not null),
         count(*) filter (where responded_at is not null and responded_at <= applied_at + interval '7 days')
    into resp_n, resp_median, resp_7d from counted;

  select count(*) filter (where kind = 'offer_issued'), count(*) filter (where kind = 'offer_withdrawn'),
         count(*) filter (where kind = 'joined_day_1'), count(*) filter (where kind = 'candidate_no_show'),
         count(*) filter (where kind = 'retained_day_30'), count(*) filter (where kind = 'left_before_day_30')
    into offers, withdrawn, joined, no_show, kept, left_early
    from public.hiring_milestones where company_id = p_company and status = 'confirmed' and reported_at >= since;

  select count(*) into active from public.jobs j where j.company_id = p_company and private.job_is_public(j.id);

  r := jsonb_build_object(
    'company_id', p_company, 'window_days', 365, 'active_jobs', active,
    'response', jsonb_build_object('sample', resp_n, 'shown', resp_n >= 5,
       'median_hours', case when resp_n >= 5 and resp_median is not null then round(resp_median, 1) end,
       'within_7_days_pct', case when resp_n >= 5 then round(100.0 * resp_7d / resp_n) end),
    'offers', jsonb_build_object('sample', offers, 'shown', offers >= 3, 'withdrawn', case when offers >= 3 then withdrawn end,
       'honoured_pct', case when offers >= 3 then round(100.0 * (offers - withdrawn) / offers) end),
    'joining', jsonb_build_object('sample', joined + no_show, 'shown', joined + no_show >= 3,
       'joined_pct', case when joined + no_show >= 3 then round(100.0 * joined / (joined + no_show)) end),
    'retention', jsonb_build_object('sample', kept + left_early, 'shown', kept + left_early >= 3,
       'day_30_pct', case when kept + left_early >= 3 then round(100.0 * kept / (kept + left_early)) end));
  shown := (r->'response'->>'shown')::boolean or (r->'offers'->>'shown')::boolean or (r->'joining'->>'shown')::boolean or (r->'retention'->>'shown')::boolean;
  return r || jsonb_build_object('new_employer', not shown);
end $$;

-- Verified companies' scorecards are visible to every signed-in user; a company always sees its own.
create or replace function public.company_scorecards(p_companies uuid[])
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select private.company_scorecard(c.id) from public.companies c
   where c.id = any(p_companies[1:100]) and (select auth.uid()) is not null
     and (c.verification_status = 'approved' or private.is_company_member(c.id)) $$;

------------------------------------------------------------------------------
-- Job detail: location label, freshness and scorecard
------------------------------------------------------------------------------
create or replace function public.job_detail(p_job uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); r jsonb;
begin
  if not private.job_is_public(p_job) then
    -- candidates may still open jobs they applied to
    if not exists (select 1 from public.applications where job_id = p_job and candidate_id = uid) then return null; end if;
  end if;
  select jsonb_build_object(
    'id', j.id, 'title', j.title, 'description', j.description, 'company', jsonb_build_object('id', c.id, 'name', c.display_name,
      'verified', c.verification_status = 'approved', 'website', c.website, 'description', c.description, 'city', c.city),
    'city', l.city, 'locality', l.locality, 'work_mode', j.work_mode, 'employment_type', j.employment_type,
    'location_label', case when j.work_mode = 'remote' then 'Remote (anywhere in India)'
                           when l.id is not null then private.location_label(l.kind, l.city, l.locality, l.district, l.state, l.pincode) end,
    'salary_min', j.salary_min, 'salary_max', j.salary_max, 'salary_period', j.salary_period,
    'experience_min_months', j.experience_min_months, 'experience_max_months', j.experience_max_months,
    'vacancies', j.vacancies, 'published_at', j.published_at, 'closes_at', j.closes_at, 'status', j.status,
    'last_confirmed_at', j.last_confirmed_at,
    'scorecard', case when c.verification_status = 'approved' then private.company_scorecard(c.id) end,
    'skills', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'required', js.required) order by s.name) from public.job_skills js join public.skills s on s.id = js.skill_id where js.job_id = j.id), '[]'::jsonb),
    'saved', exists (select 1 from public.saved_jobs sj where sj.job_id = j.id and sj.candidate_id = uid),
    'application_id', (select a.id from public.applications a where a.job_id = j.id and a.candidate_id = uid),
    'match', private.match_score(uid, j.id))
  into r from public.jobs j join public.companies c on c.id = j.company_id left join public.locations l on l.id = j.location_id where j.id = p_job;
  return r;
end $$;

------------------------------------------------------------------------------
-- Privileges and version
------------------------------------------------------------------------------
create or replace function public.schema_version()
returns text language sql immutable set search_path = '' as $$ select '202611260003'::text $$;

revoke all on function public.confirm_job_active(uuid) from public, anon;
grant execute on function public.confirm_job_active(uuid) to authenticated;
revoke all on function public.company_scorecards(uuid[]) from public, anon;
grant execute on function public.company_scorecards(uuid[]) to authenticated;
revoke all on function public.jobs_stale_sweep() from public, anon, authenticated;
grant execute on function public.jobs_stale_sweep() to service_role;
revoke all on function private.company_scorecard(uuid) from public, anon, authenticated;
revoke all on function public.job_detail(uuid) from public, anon;
grant execute on function public.job_detail(uuid) to authenticated;
revoke all on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated, service_role;
