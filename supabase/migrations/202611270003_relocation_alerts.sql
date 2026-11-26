-- 202611270003 Relocation, office-day and commute preferences; relocation-aware discovery with access logging;
-- opt-in high-signal job alerts.
-- * candidate_profiles.relocation: no | within_state | preferred_places | anywhere_india. "anywhere_india" lifts a weak
--   location match to 60, "within_state" to 65 for jobs in the home state. max_office_days and commute_note are shown to
--   employers only after the candidate applies.
-- * discover_candidates also matches people willing to relocate, and logs every returned profile in discovery_views.
-- * Job alerts (off by default): at most one digest notification a day for newly published jobs that pass the hard
--   filters and score at least 70. Alert emails are optional mail (respect the email setting) and capped at 50 a day
--   platform-wide to stay within the free email tier; above the cap the alert stays in the app.

alter table public.candidate_profiles
  add column relocation text not null default 'no' check (relocation in ('no', 'within_state', 'preferred_places', 'anywhere_india')),
  add column max_office_days smallint check (max_office_days between 0 and 6),
  add column commute_note text check (char_length(commute_note) <= 200);
grant update (relocation, max_office_days, commute_note) on public.candidate_profiles to authenticated;

create or replace function private.location_fit(p_candidate uuid, p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs%rowtype; jl public.locations%rowtype; r record; base numeric; tier text; reloc text; home_state text;
        best numeric := null; best_tier text := null; best_rank integer := null; s numeric;
begin
  select * into j from public.jobs where id = p_job;
  if j.work_mode = 'remote' then return jsonb_build_object('score', 100, 'tier', 'remote', 'rank', null); end if;
  if j.location_id is null then return jsonb_build_object('score', null, 'tier', null, 'rank', null); end if;
  select * into jl from public.locations where id = j.location_id;
  for r in
    select l.*, 1 as rank from public.candidate_profiles cp
      join public.locations l on l.id = cp.current_location_id where cp.user_id = p_candidate
    union all
    select l.*, cl.preference_rank from public.candidate_locations cl
      join public.locations l on l.id = cl.location_id where cl.candidate_id = p_candidate
  loop
    if r.kind = 'state' and r.state_code = jl.state_code then base := 70; tier := 'state';
    elsif jl.pincode is not null and r.pincode = jl.pincode then base := 100; tier := 'area';
    elsif jl.locality is not null and r.city = jl.city and r.locality is not distinct from jl.locality then base := 100; tier := 'area';
    elsif r.kind <> 'state' and r.city = jl.city and r.state_code = jl.state_code then base := 85; tier := 'city';
    elsif r.kind <> 'state' and r.district_id is not null and r.district_id = jl.district_id then base := 75; tier := 'district';
    else base := 0; tier := 'none';
    end if;
    s := base * greatest(0.7, 1 - 0.03 * (r.rank - 1));
    if best is null or s > best then best := s; best_tier := tier; best_rank := r.rank; end if;
  end loop;
  -- Relocation willingness lifts a weak location match (never above a real area/city/district match).
  select cp.relocation, h.state_code into reloc, home_state from public.candidate_profiles cp
    left join public.locations h on h.id = cp.current_location_id where cp.user_id = p_candidate;
  if reloc = 'anywhere_india' and coalesce(best, 0) < 60 then best := 60; best_tier := 'relocation'; best_rank := null;
  elsif reloc = 'within_state' and home_state = jl.state_code and coalesce(best, 0) < 65 then best := 65; best_tier := 'relocation_state'; best_rank := null;
  end if;
  return jsonb_build_object('score', round(best, 1), 'tier', best_tier, 'rank', best_rank);  -- score null: no location data
end $$;

create or replace function private.match_score(p_candidate uuid, p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  mv public.matching_versions%rowtype; cp public.candidate_profiles%rowtype; j public.jobs%rowtype;
  sk jsonb; s_sk numeric; s_loc numeric; s_sal numeric; s_exp numeric; s_fr numeric;
  w_sk numeric; w_loc numeric; w_sal numeric; w_exp numeric; w_fr numeric;
  total numeric; avail numeric := 0; reasons text[] := '{}'; open_job boolean; loc jsonb;
begin
  select * into mv from public.matching_versions where active;
  select * into cp from public.candidate_profiles where user_id = p_candidate;
  select * into j from public.jobs where id = p_job;
  if cp.user_id is null or j.id is null then return null; end if;

  w_sk := (mv.weights->>'skills')::numeric; w_loc := (mv.weights->>'location')::numeric;
  w_sal := (mv.weights->>'salary')::numeric; w_exp := (mv.weights->>'experience')::numeric;
  w_fr := (mv.weights->>'freshness')::numeric;

  sk := private.score_skills(p_candidate, p_job);
  s_sk := (sk->>'score')::numeric;
  loc := private.location_fit(p_candidate, p_job);
  s_loc := (loc->>'score')::numeric;
  s_sal := private.score_salary(cp.salary_min, cp.salary_period, j.salary_min, j.salary_max, j.salary_period);
  s_exp := private.score_experience(cp.experience_months, j.experience_min_months, j.experience_max_months);
  s_fr := private.score_freshness(j.published_at);

  -- Missing data is scored neutrally (50) and reported, so it neither rewards nor punishes.
  total := coalesce(s_sk, 50) * w_sk + coalesce(s_loc, 50) * w_loc + coalesce(s_sal, 50) * w_sal
         + coalesce(s_exp, 50) * w_exp + coalesce(s_fr, 50) * w_fr;
  total := round(total / 100.0, 0);
  avail := (case when s_sk is null then 0 else w_sk end) + (case when s_loc is null then 0 else w_loc end)
         + (case when s_sal is null then 0 else w_sal end) + (case when s_exp is null then 0 else w_exp end)
         + (case when s_fr is null then 0 else w_fr end);

  -- Hard filters.
  open_job := private.job_is_public(p_job);
  if not open_job then reasons := array_append(reasons, 'job_not_open'); end if;
  if not exists (select 1 from public.profiles where id = p_candidate and status = 'active') then reasons := array_append(reasons, 'account_inactive'); end if;
  if not (j.work_mode = any(cp.work_modes)) then reasons := array_append(reasons, 'work_mode_not_preferred'); end if;
  if not (j.employment_type = any(cp.employment_types)) then reasons := array_append(reasons, 'employment_type_not_preferred'); end if;
  if s_loc is not null and s_loc = 0 then reasons := array_append(reasons, 'location_mismatch'); end if;

  return jsonb_build_object(
    'version', mv.version,
    'score', total,
    'eligible', cardinality(reasons) = 0,
    'ineligible_reasons', to_jsonb(reasons),
    'confidence', avail,
    'components', jsonb_build_object(
      'skills', jsonb_build_object('score', s_sk, 'weight', w_sk, 'missing', s_sk is null,
        'explanation', case
          when s_sk is null and coalesce((sk->>'no_candidate_skills')::boolean, false) then 'Add confirmed skills to your profile to improve this score.'
          when s_sk is null then 'This job lists no required skills, so skills were scored neutrally.'
          else format('Matches %s of %s listed skills%s.', jsonb_array_length(sk->'matched'),
                 jsonb_array_length(sk->'matched') + jsonb_array_length(sk->'missing'),
                 case when jsonb_array_length(sk->'missing') > 0 then ' (missing: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(sk->'missing') x) || ')' else '' end) end,
        'matched', sk->'matched', 'missing_skills', sk->'missing'),
      'location', jsonb_build_object('score', s_loc, 'weight', w_loc, 'missing', s_loc is null,
        'tier', loc->>'tier',
        'explanation', case when j.work_mode = 'remote' then 'This job is remote, open to candidates anywhere in India.'
          when s_loc is null then 'Add a current or preferred location to improve this score.'
          else case loc->>'tier'
            when 'area' then 'The job is in an area you chose.'
            when 'city' then 'The job is in a city you prefer.'
            when 'district' then 'The job is in a district you prefer, outside your chosen city.'
            when 'state' then 'The job is in a state you are open to.'
            when 'relocation' then 'You are willing to relocate anywhere in India.'
            when 'relocation_state' then 'You are willing to relocate within your state.'
            else 'The job is outside the places you prefer.' end
            || case when coalesce((loc->>'rank')::int, 1) > 1 and loc->>'tier' <> 'none' then ' It matches a lower-ranked preference.' else '' end
          end),
      'salary', jsonb_build_object('score', s_sal, 'weight', w_sal, 'missing', s_sal is null,
        'explanation', case when s_sal is null then 'Add your expected salary to improve this score.'
          when s_sal = 100 then 'The salary range meets or exceeds your expectation.'
          when s_sal >= 70 then 'The salary range overlaps your expectation.'
          else 'The salary range is below your expectation.' end),
      'experience', jsonb_build_object('score', s_exp, 'weight', w_exp, 'missing', s_exp is null,
        'explanation', case when s_exp is null then 'Experience requirement is not specified.'
          when s_exp = 100 then 'Your experience fits the requirement.'
          when cp.experience_months < j.experience_min_months then 'You have less experience than the role asks for.'
          else 'You have more experience than the role asks for; this is only a small adjustment.' end),
      'freshness', jsonb_build_object('score', s_fr, 'weight', w_fr, 'missing', s_fr is null,
        'explanation', case when s_fr is null then 'Posting date unavailable.'
          when s_fr = 100 then 'Posted within the last 3 days.' else 'Older postings score lower on freshness.' end)));
end $$;

drop function public.discover_candidates(uuid, text, uuid[], text[], integer, integer, integer, integer);
create function public.discover_candidates(
  p_job uuid, p_skill text default null, p_places uuid[] default null, p_states text[] default null,
  p_min_months integer default null, p_max_months integer default null, p_max_salary integer default null, p_limit integer default 25)
returns table (candidate_id uuid, headline text, city text, locality text, state_name text, location_label text, experience_months integer,
               expected_salary integer, salary_period text, notice_days integer, skills text[], score numeric, match jsonb, relocation text)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); j public.jobs%rowtype; lim integer := least(greatest(coalesce(p_limit, 25), 1), 50);
        places uuid[] := nullif(p_places, '{}'); states text[] := nullif(p_states, '{}');
begin
  perform private.check_location_filters(places, states, null);
  select * into j from public.jobs where id = p_job;
  if j.id is null or not private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[]) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if not private.job_is_public(p_job) then raise exception 'Candidate discovery requires a published job of a verified company' using errcode = '55000'; end if;
  perform private.enforce_quota('candidate.search', j.company_id, null, 60, interval '1 hour');
  perform private.audit('candidate.search', 'job', p_job, j.company_id,
    jsonb_build_object('skill', left(p_skill, 60), 'places', coalesce(cardinality(places), 0), 'states', states,
                       'min_months', p_min_months, 'max_months', p_max_months));
  create temporary table if not exists pg_temp.discover_result (candidate_id uuid, headline text, city text, locality text, state_name text, location_label text,
    experience_months integer, expected_salary integer, salary_period text, notice_days integer, skills text[], score numeric, match jsonb, relocation text) on commit drop;
  delete from pg_temp.discover_result;
  insert into pg_temp.discover_result
  select q.user_id, q.headline, q.city, q.locality, q.state_name, q.label, q.experience_months, q.salary_min, q.salary_period,
         q.notice_days, q.skill_names, (q.m->>'score')::numeric, q.m, q.relocation
  from (
    select f.*, private.match_score(f.user_id, p_job) as m
    from (
      select cp.user_id, cp.headline, l.city, l.locality, l.state as state_name, cp.relocation,
        private.location_label(l.kind, l.city, l.locality, l.district, l.state, l.pincode) as label,
        cp.experience_months, cp.salary_min, cp.salary_period, cp.notice_days,
        coalesce((select array_agg(s.name order by s.name) from public.candidate_skills cs join public.skills s on s.id = cs.skill_id
                  where cs.candidate_id = cp.user_id and cs.confirmed), '{}'::text[]) as skill_names
      from public.candidate_profiles cp
      join public.profiles p on p.id = cp.user_id and p.status = 'active' and p.account_kind = 'candidate'
      left join public.locations l on l.id = cp.current_location_id
      where cp.discovery_enabled
        and not exists (select 1 from public.applications a where a.job_id = p_job and a.candidate_id = cp.user_id)
        and not exists (select 1 from public.job_invitations i where i.job_id = p_job and i.candidate_id = cp.user_id)
        and ((places is null and states is null)
          or cp.relocation = 'anywhere_india'
          or (cp.relocation = 'within_state' and l.state_code is not null
              and ((states is not null and l.state_code = any(states))
                or (places is not null and exists (select 1 from public.locations s2 where s2.id = any(places) and s2.state_code = l.state_code))))
          or exists (
              select 1 from public.locations c
               where (c.id = cp.current_location_id
                      or c.id in (select x.location_id from public.candidate_locations x where x.candidate_id = cp.user_id))
                 and ((states is not null and c.state_code = any(states))
                   or (places is not null and exists (select 1 from public.locations s where s.id = any(places)
                         and (private.place_contains(s, c) or private.place_contains(c, s)))))))
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
  -- Every masked profile shown to an employer is logged for the candidate's access log.
  insert into public.discovery_views (candidate_id, company_id, job_id, viewed_by)
  select r.candidate_id, j.company_id, p_job, uid from pg_temp.discover_result r;
  return query select * from pg_temp.discover_result r order by r.score desc, r.candidate_id;
end $$;

-- Applicant view adds relocation, office days and commute note (only for people who applied).
create or replace function public.job_applicant_preferences(p_job uuid)
returns table (application_id uuid, relocation text, max_office_days smallint, commute_note text, notice_days integer, location_label text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not exists (select 1 from public.jobs j where j.id = p_job and private.is_company_member(j.company_id)) then raise exception 'Job not found' using errcode = 'P0002'; end if;
  return query select a.id, cp.relocation, cp.max_office_days, cp.commute_note, cp.notice_days,
                      private.location_label(l.kind, l.city, l.locality, l.district, l.state, l.pincode)
    from public.applications a join public.candidate_profiles cp on cp.user_id = a.candidate_id
    left join public.locations l on l.id = cp.current_location_id
   where a.job_id = p_job and a.stage <> 'withdrawn';
end $$;

-- Job alerts
alter table public.notification_preferences add column job_alerts boolean not null default false;
grant select (job_alerts) on public.notification_preferences to authenticated;
create table private.job_alert_log (candidate_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade, created_at timestamptz not null default now(), primary key (candidate_id, job_id));
revoke all on private.job_alert_log from public, anon, authenticated, service_role;

create or replace function public.set_job_alerts(p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  insert into public.notification_preferences (user_id, job_alerts) values (uid, coalesce(p_on, false))
  on conflict (user_id) do update set job_alerts = excluded.job_alerts, updated_at = now();
  perform private.audit('settings.job_alerts', 'user', uid, null, jsonb_build_object('on', coalesce(p_on, false)));
end $$;

create or replace function private.email_category(p_kind text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_kind like 'security.%' or p_kind like 'privacy.%' then 'security'
    when p_kind in ('application.viewed','application.received','invitation.accepted','invitation.declined',
                    'interview.confirmed','interview.reschedule_requested','resume.suggestions','account.registered','job.match_alert') then 'optional'
    else 'essential' end;
$$;

create or replace function public.job_alerts_run()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; n_cand integer := 0; n_jobs integer := 0; capped integer := 0;
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  for r in
    with fresh as (
      select j.id, j.location_id, j.work_mode, l.state_code from public.jobs j left join public.locations l on l.id = j.location_id
       where j.published_at > now() - interval '3 days' and private.job_is_public(j.id)),
    cands as (
      select np.user_id from public.notification_preferences np join public.profiles p on p.id = np.user_id
       where np.job_alerts and p.status = 'active' and p.account_kind = 'candidate'
         and not exists (select 1 from public.notifications n where n.recipient_id = np.user_id and n.kind = 'job.match_alert' and n.created_at > now() - interval '20 hours')),
    pairs as (
      -- Cheap filters first: an overlapping confirmed skill, accepted work mode, and a plausible place.
      select c.user_id, f.id job_id from cands c cross join fresh f
        join public.candidate_profiles cp on cp.user_id = c.user_id
       where f.work_mode = any(cp.work_modes)
         and exists (select 1 from public.job_skills js join public.candidate_skills cs on cs.skill_id = js.skill_id and cs.confirmed
                      where js.job_id = f.id and cs.candidate_id = c.user_id)
         and not exists (select 1 from private.job_alert_log g where g.candidate_id = c.user_id and g.job_id = f.id)
         and not exists (select 1 from public.applications a where a.candidate_id = c.user_id and a.job_id = f.id)
         and (f.work_mode = 'remote' or cp.relocation = 'anywhere_india'
              or exists (select 1 from public.locations x where (x.id = cp.current_location_id
                           or x.id in (select cl.location_id from public.candidate_locations cl where cl.candidate_id = c.user_id))
                           and x.state_code = f.state_code))),
    scored as (select p.user_id, p.job_id, private.match_score(p.user_id, p.job_id) m from pairs p)
    select user_id, array_agg(job_id order by (m->>'score')::numeric desc) jobs from scored
     where (m->>'eligible')::boolean and (m->>'score')::numeric >= 70 group by user_id
  loop
    insert into private.job_alert_log (candidate_id, job_id) select r.user_id, x from unnest(r.jobs[1:5]) x on conflict do nothing;
    perform private.notify(r.user_id, 'job.match_alert',
      case when cardinality(r.jobs) = 1 then 'A new job matches your profile' else cardinality(r.jobs) || ' new jobs match your profile' end,
      'Verified employers, visible salaries. Open KaamSetu to see them.');
    n_cand := n_cand + 1; n_jobs := n_jobs + least(cardinality(r.jobs), 5);
  end loop;
  -- Free-tier guard: at most 50 alert emails a day across the platform.
  with ranked as (select id, row_number() over (order by created_at, id) rn from private.email_outbox
                   where kind = 'job.match_alert' and created_at >= date_trunc('day', now()) and status in ('pending', 'sending', 'sent'))
  update private.email_outbox o set status = 'suppressed', last_error = 'daily_alert_cap'
    from ranked where o.id = ranked.id and ranked.rn > 50 and o.status = 'pending';
  get diagnostics capped = row_count;
  return jsonb_build_object('candidates_alerted', n_cand, 'jobs_included', n_jobs, 'emails_capped', capped);
end $$;

create or replace function public.schema_version()
returns text language sql immutable set search_path = '' as $$ select '202611270003'::text $$;
revoke all on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated, service_role;
revoke all on function public.discover_candidates(uuid, text, uuid[], text[], integer, integer, integer, integer), public.job_applicant_preferences(uuid),
  public.set_job_alerts(boolean) from public, anon;
grant execute on function public.discover_candidates(uuid, text, uuid[], text[], integer, integer, integer, integer), public.job_applicant_preferences(uuid),
  public.set_job_alerts(boolean) to authenticated;
revoke all on function public.job_alerts_run() from public, anon, authenticated;
grant execute on function public.job_alerts_run() to service_role;
revoke all on function private.location_fit(uuid, uuid), private.match_score(uuid, uuid) from public, anon, authenticated;
