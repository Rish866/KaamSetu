-- 202611270001 Fair outcome tags, pre-apply readiness questions, employer review commitment, trust details.
-- * Every rejection, withdrawal, declined/withdrawn offer, no-show and early exit can carry ONE reason from a fixed,
--   neutral catalogue (no free-text labels about people). Employers must choose one when rejecting or withdrawing an
--   offer, and when reporting an early exit; candidates may choose one. Tags are attributed and timestamped with the event.
-- * Employers may add up to 2 short readiness questions per job (yes/no or short answer, e.g. shift or notice period).
--   Required questions must be answered to apply; answers are visible only to the candidate and that company.
-- * Companies can publish a review commitment ("we reply within N days"); the scorecard shows how often it was met.
-- * Scorecards add the verification method (GSTIN, CIN, domain, document; never the number), how outcomes were confirmed
--   (both sides / automatic / decided by KaamSetu) and a breakdown of non-completion reasons.

create table public.outcome_reasons (
  code text primary key check (code ~ '^[a-z_]+$'),
  label text not null,
  actor text not null check (actor in ('employer', 'candidate', 'either')),
  category text not null check (category in ('business_change', 'fit', 'logistics', 'conduct', 'ended_by_employer', 'ended_by_candidate')),
  contexts text[] not null
);
insert into public.outcome_reasons (code, label, actor, category, contexts) values
  ('employer_role_on_hold', 'Role put on hold', 'employer', 'business_change', '{rejected,offer_withdrawn}'),
  ('employer_position_filled', 'Position already filled', 'employer', 'business_change', '{rejected,offer_withdrawn}'),
  ('budget_or_headcount_change', 'Budget or headcount changed', 'employer', 'business_change', '{rejected,offer_withdrawn}'),
  ('skills_or_experience_gap', 'Skills or experience do not match the role', 'employer', 'fit', '{rejected}'),
  ('compensation_mismatch', 'Salary expectations do not match', 'either', 'fit', '{rejected,withdrawn,offer_declined,offer_withdrawn,left_before_day_30}'),
  ('location_or_work_mode_mismatch', 'Location or work mode does not fit', 'either', 'logistics', '{rejected,withdrawn,offer_declined}'),
  ('candidate_unresponsive', 'Candidate stopped responding', 'employer', 'conduct', '{rejected,offer_withdrawn}'),
  ('candidate_accepted_other_offer', 'Accepted another offer', 'candidate', 'fit', '{withdrawn,offer_declined,left_before_day_30}'),
  ('relocation_or_commute_change', 'Relocation or commute changed', 'candidate', 'logistics', '{withdrawn,offer_declined,left_before_day_30}'),
  ('personal_reasons', 'Personal reasons', 'candidate', 'logistics', '{withdrawn,offer_declined,left_before_day_30}'),
  ('employer_unresponsive', 'Employer stopped responding', 'candidate', 'conduct', '{withdrawn}'),
  ('role_different_from_listing', 'Role differs from the job listing', 'candidate', 'conduct', '{withdrawn,offer_declined,left_before_day_30}'),
  ('candidate_no_show', 'Did not join on the agreed day', 'employer', 'conduct', '{candidate_no_show}'),
  ('early_exit_resigned', 'Left: resigned', 'either', 'ended_by_candidate', '{left_before_day_30}'),
  ('early_exit_let_go', 'Left: employment ended by the employer', 'either', 'ended_by_employer', '{left_before_day_30}');
alter table public.outcome_reasons enable row level security;
create policy outcome_reasons_read on public.outcome_reasons for select to anon, authenticated using (true);
revoke all on public.outcome_reasons from anon, authenticated, service_role;
grant select on public.outcome_reasons to anon, authenticated;

alter table public.application_events add column outcome_tag text references public.outcome_reasons(code);
alter table public.hiring_milestones add column outcome_tag text references public.outcome_reasons(code);

create or replace function private.check_outcome_tag(p_tag text, p_context text, p_role text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare r public.outcome_reasons;
begin
  if p_tag is null then raise exception 'Choose a reason' using errcode = '22023'; end if;
  select * into r from public.outcome_reasons where code = p_tag;
  if r.code is null or not (p_context = any(r.contexts)) or not (r.actor in ('either', p_role)) then
    raise exception 'That reason does not apply here' using errcode = '22023';
  end if;
end $$;

-- Readiness questions
create table public.job_questions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  position smallint not null check (position in (1, 2)),
  kind text not null check (kind in ('yes_no', 'short_text')),
  prompt text not null check (char_length(prompt) between 5 and 200),
  required boolean not null default true,
  unique (job_id, position)
);
create table public.application_answers (
  application_id uuid not null references public.applications(id) on delete cascade,
  question_id uuid not null references public.job_questions(id) on delete cascade,
  answer_bool boolean,
  answer_text text check (char_length(answer_text) <= 300),
  created_at timestamptz not null default now(),
  primary key (application_id, question_id),
  check ((answer_bool is null) <> (answer_text is null))
);
alter table public.job_questions enable row level security;
alter table public.application_answers enable row level security;
create policy job_questions_read on public.job_questions for select to authenticated
  using (private.job_is_public(job_id) or exists (select 1 from public.jobs j where j.id = job_id and private.is_company_member(j.company_id)));
create policy application_answers_read on public.application_answers for select to authenticated
  using (exists (select 1 from public.applications a join public.jobs j on j.id = a.job_id where a.id = application_id
                 and (a.candidate_id = (select auth.uid()) or private.is_company_member(j.company_id))));
revoke all on public.job_questions, public.application_answers from anon, authenticated, service_role;
grant select on public.job_questions, public.application_answers to authenticated;

create or replace function public.set_job_questions(p_job uuid, p_questions jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare j public.jobs; q jsonb; i integer := 0;
begin
  perform private.require_user();
  select * into j from public.jobs where id = p_job for update;
  if j.id is null or not private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[]) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.applications where job_id = p_job) then
    raise exception 'Questions cannot change once candidates have applied' using errcode = '55000';
  end if;
  if jsonb_typeof(coalesce(p_questions, '[]')) <> 'array' or jsonb_array_length(coalesce(p_questions, '[]')) > 2 then
    raise exception 'Add at most 2 questions' using errcode = '22023';
  end if;
  delete from public.job_questions where job_id = p_job;
  for q in select * from jsonb_array_elements(coalesce(p_questions, '[]')) loop
    i := i + 1;
    insert into public.job_questions (job_id, position, kind, prompt, required)
    values (p_job, i, q->>'kind', trim(q->>'prompt'), coalesce((q->>'required')::boolean, true));
  end loop;
  perform private.audit('job.questions_set', 'job', p_job, j.company_id, jsonb_build_object('count', i));
end $$;

-- Applying to a job with required questions must go through apply_with_answers.
create or replace function private.require_answers() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source = 'candidate' and exists (select 1 from public.job_questions where job_id = new.job_id and required)
     and coalesce(current_setting('kaamsetu.answers_checked', true), '') <> 'yes' then
    raise exception 'Answer this job''s questions to apply' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger applications_require_answers before insert on public.applications for each row execute function private.require_answers();

create or replace function public.apply_with_answers(p_job uuid, p_note text default null, p_answers jsonb default '[]')
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); app_id uuid; q public.job_questions; a jsonb;
begin
  for q in select * from public.job_questions where job_id = p_job order by position loop
    select x into a from jsonb_array_elements(coalesce(p_answers, '[]')) x where x->>'question_id' = q.id::text limit 1;
    if q.required and (a is null or (q.kind = 'yes_no' and jsonb_typeof(a->'answer') <> 'boolean')
                       or (q.kind = 'short_text' and char_length(trim(coalesce(a->>'answer', ''))) < 1)) then
      raise exception 'Answer: %', q.prompt using errcode = '22023';
    end if;
    if q.kind = 'short_text' and char_length(coalesce(a->>'answer', '')) > 300 then raise exception 'Answers can be at most 300 characters' using errcode = '22023'; end if;
  end loop;
  perform set_config('kaamsetu.answers_checked', 'yes', true);
  app_id := public.apply_to_job(p_job, p_note);
  perform set_config('kaamsetu.answers_checked', '', true);
  insert into public.application_answers (application_id, question_id, answer_bool, answer_text)
  select app_id, q2.id, case when q2.kind = 'yes_no' then (x->>'answer')::boolean end, case when q2.kind = 'short_text' then left(trim(x->>'answer'), 300) end
    from public.job_questions q2 join jsonb_array_elements(coalesce(p_answers, '[]')) x on x->>'question_id' = q2.id::text
   where q2.job_id = p_job and (q2.kind = 'yes_no' or char_length(trim(coalesce(x->>'answer', ''))) > 0);
  return app_id;
end $$;

create or replace function public.job_application_answers(p_job uuid)
returns table (application_id uuid, question_id uuid, prompt text, kind text, answer_bool boolean, answer_text text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not exists (select 1 from public.jobs j where j.id = p_job and private.is_company_member(j.company_id)) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  return query select aa.application_id, q.id, q.prompt, q.kind, aa.answer_bool, aa.answer_text
    from public.application_answers aa join public.job_questions q on q.id = aa.question_id
    join public.applications a on a.id = aa.application_id where a.job_id = p_job and a.stage <> 'withdrawn' order by q.position;
end $$;

-- Review commitment and office days
alter table public.companies add column review_commitment_days smallint check (review_commitment_days between 1 and 14);
grant select (review_commitment_days) on public.companies to anon, authenticated;
alter table public.jobs add column office_days smallint check (office_days between 1 and 6);
grant select (office_days) on public.jobs to anon, authenticated;
grant insert (office_days), update (office_days) on public.jobs to authenticated;

create or replace function public.set_review_commitment(p_company uuid, p_days integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.is_company_member(p_company, array['owner']::public.company_role[]) then raise exception 'Only the company owner can change this' using errcode = '42501'; end if;
  if p_days is not null and (p_days < 1 or p_days > 14) then raise exception 'Choose between 1 and 14 days' using errcode = '22023'; end if;
  update public.companies set review_commitment_days = p_days, updated_at = now() where id = p_company;
  perform private.audit('company.review_commitment', 'company', p_company, p_company, jsonb_build_object('days', p_days));
end $$;

drop function public.transition_application(uuid, public.application_stage, text, text);
drop function public.withdraw_application(uuid);
drop function public.respond_to_offer(uuid, boolean, text);
drop function public.withdraw_offer(uuid, text);
drop function public.report_hiring_milestone(uuid, text, date, text);

create or replace function public.transition_application(p_application uuid, p_to public.application_stage, p_reason text default null, p_details text default null, p_outcome_tag text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); a public.applications%rowtype; comp uuid; title text; v_reason text;
begin
  select a2.* into a from public.applications a2 where a2.id = p_application for update;
  select company_id into comp from public.jobs where id = a.job_id;
  if a.id is null or comp is null or not private.is_company_member(comp, array['owner','recruiter']::public.company_role[]) then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if not private.company_is_approved(comp) then raise exception 'Company is not verified' using errcode = '55000'; end if;
  if p_to in ('withdrawn','applied') or not private.stage_allowed(a.stage, p_to) then
    raise exception 'Cannot move an application from % to %', a.stage, p_to using errcode = '55000';
  end if;
  if p_to = 'interview' and not exists (select 1 from public.interviews where application_id = a.id and status <> 'cancelled') then
    raise exception 'Propose an interview to move a candidate to the interview stage' using errcode = '55000';
  end if;
  if p_to = 'rejected' then v_reason := private.require_reason(p_reason, 3); perform private.check_outcome_tag(p_outcome_tag, 'rejected', 'employer');
  else v_reason := left(p_reason, 1000); if p_outcome_tag is not null then raise exception 'Reason tags are only used when rejecting' using errcode = '22023'; end if; end if;
  update public.applications set stage = p_to, updated_at = now() where id = a.id;
  insert into public.application_events (application_id, from_stage, to_stage, actor_id, reason, details, outcome_tag)
  values (a.id, a.stage, p_to, uid, v_reason, left(p_details, 2000), p_outcome_tag);
  if p_to = 'rejected' then
    update public.interviews set status = 'cancelled', updated_at = now() where application_id = a.id and status in ('proposed','confirmed','reschedule_requested');
  end if;
  title := case p_to when 'viewed' then 'Your application was viewed' when 'shortlisted' then 'You were shortlisted'
    when 'interview' then 'Interview update' when 'offer' then 'You have an offer' when 'hired' then 'Hiring update'
    else 'Application update' end;
  perform private.notify(a.candidate_id, 'application.' || p_to, title, 'Open KaamSetu to see the details.');
  perform private.audit('application.' || p_to, 'application', a.id, comp);
end $$;

create or replace function public.withdraw_application(p_application uuid, p_outcome_tag text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); a public.applications%rowtype;
begin
  select * into a from public.applications where id = p_application and candidate_id = uid for update;
  if a.id is null then raise exception 'Application not found' using errcode = 'P0002'; end if;
  if a.stage in ('hired','rejected','withdrawn') then raise exception 'This application is already closed' using errcode = '55000'; end if;
  if p_outcome_tag is not null then perform private.check_outcome_tag(p_outcome_tag, 'withdrawn', 'candidate'); end if;
  update public.applications set stage = 'withdrawn', updated_at = now() where id = a.id;
  update public.interviews set status = 'cancelled', updated_at = now() where application_id = a.id and status in ('proposed','confirmed','reschedule_requested');
  insert into public.application_events (application_id, from_stage, to_stage, actor_id, outcome_tag) values (a.id, a.stage, 'withdrawn', uid, p_outcome_tag);
end $$;

create or replace function public.respond_to_offer(p_application uuid, p_accept boolean, p_reason text default null, p_outcome_tag text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s record; uid uuid := private.require_user();
begin
  select * into s from private.hiring_side(p_application);
  if s.o_side <> 'candidate' then raise exception 'Only the candidate can answer an offer' using errcode = '42501'; end if;
  if s.o_stage <> 'offer' or (private.active_milestone(p_application, 'offer_issued')).id is null then
    raise exception 'There is no open offer to answer' using errcode = '55000';
  end if;
  if not p_accept and p_outcome_tag is not null then perform private.check_outcome_tag(p_outcome_tag, 'offer_declined', 'candidate'); end if;
  if p_accept then
    perform private.add_milestone(p_application, s.o_company, s.o_candidate, 'offer_accepted', 'candidate', true, current_date, null);
    perform set_config('kaamsetu.offer_accepted', 'yes', true);
    update public.applications set stage = 'hired', updated_at = now() where id = p_application;
    perform set_config('kaamsetu.offer_accepted', '', true);
    insert into public.application_events (application_id, from_stage, to_stage, actor_id, reason) values (p_application, 'offer', 'hired', uid, 'Offer accepted by the candidate');
    perform private.notify_other_side('candidate', s.o_candidate, s.o_company, 'hiring.offer_accepted', 'Your offer was accepted');
  else
    perform private.add_milestone(p_application, s.o_company, s.o_candidate, 'offer_declined', 'candidate', true, current_date, p_reason);
    update public.hiring_milestones set outcome_tag = p_outcome_tag where application_id = p_application and kind = 'offer_declined' and status <> 'rejected';
    update public.applications set stage = 'withdrawn', updated_at = now() where id = p_application;
    insert into public.application_events (application_id, from_stage, to_stage, actor_id, outcome_tag, reason)
    values (p_application, 'offer', 'withdrawn', uid, p_outcome_tag, left(coalesce('Offer declined: ' || nullif(trim(p_reason), ''), 'Offer declined'), 1000));
    perform private.notify_other_side('candidate', s.o_candidate, s.o_company, 'hiring.offer_declined', 'Your offer was declined');
  end if;
end $$;

create or replace function public.withdraw_offer(p_application uuid, p_reason text, p_outcome_tag text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s record; uid uuid := private.require_user(); v_reason text := private.require_reason(p_reason, 5);
begin
  select * into s from private.hiring_side(p_application);
  if s.o_side <> 'employer' then raise exception 'Only the employer can withdraw an offer' using errcode = '42501'; end if;
  perform private.check_outcome_tag(p_outcome_tag, 'offer_withdrawn', 'employer');
  if s.o_stage not in ('offer', 'hired') then raise exception 'There is no offer to withdraw' using errcode = '55000'; end if;
  if (private.active_milestone(p_application, 'joined_day_1')).id is not null then
    raise exception 'The candidate has already joined; record "left before day 30" instead' using errcode = '55000';
  end if;
  perform private.add_milestone(p_application, s.o_company, s.o_candidate, 'offer_withdrawn', 'employer', true, current_date, v_reason);
  update public.hiring_milestones set outcome_tag = p_outcome_tag where application_id = p_application and kind = 'offer_withdrawn' and status <> 'rejected';
  update public.applications set stage = 'rejected', updated_at = now() where id = p_application;
  insert into public.application_events (application_id, from_stage, to_stage, actor_id, reason, outcome_tag) values (p_application, s.o_stage, 'rejected', uid, 'Offer withdrawn: ' || v_reason, p_outcome_tag);
  perform private.notify_other_side('employer', s.o_candidate, s.o_company, 'hiring.offer_withdrawn', 'An offer was withdrawn');
end $$;

create or replace function public.report_hiring_milestone(p_application uuid, p_kind text, p_on date default null, p_note text default null, p_outcome_tag text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s record; on_day date := coalesce(p_on, current_date); joined public.hiring_milestones; mid uuid;
begin
  select * into s from private.hiring_side(p_application);
  if p_kind not in ('joined_day_1', 'candidate_no_show', 'retained_day_15', 'retained_day_30', 'left_before_day_30') then
    raise exception 'Unknown milestone' using errcode = '22023';
  end if;
  if s.o_stage <> 'hired' then raise exception 'Joining can be recorded only after the candidate accepts the offer' using errcode = '55000'; end if;
  if on_day > current_date or on_day < current_date - 90 then raise exception 'Choose a date in the last 90 days' using errcode = '22023'; end if;
  joined := private.active_milestone(p_application, 'joined_day_1');
  if p_kind in ('joined_day_1', 'candidate_no_show') then
    if joined.id is not null or (private.active_milestone(p_application, 'candidate_no_show')).id is not null then
      raise exception 'Joining is already recorded for this hire' using errcode = '55000';
    end if;
    if p_kind = 'candidate_no_show' and s.o_side <> 'employer' then raise exception 'Only the employer records a no-show' using errcode = '42501'; end if;
    if s.o_joining is not null and on_day < s.o_joining then raise exception 'That is before the agreed joining date' using errcode = '22023'; end if;
  else
    if joined.id is null or joined.status not in ('pending', 'confirmed') then
      raise exception 'Record the joining day first' using errcode = '55000';
    end if;
    if p_kind = 'retained_day_15' and current_date < joined.occurred_on + 15 then raise exception 'Day 15 has not been reached yet' using errcode = '55000'; end if;
    if p_kind = 'retained_day_30' and current_date < joined.occurred_on + 30 then raise exception 'Day 30 has not been reached yet' using errcode = '55000'; end if;
    if p_kind in ('retained_day_15', 'retained_day_30') then on_day := joined.occurred_on + case p_kind when 'retained_day_15' then 15 else 30 end; end if;
    if p_kind = 'left_before_day_30' then
      if (private.active_milestone(p_application, 'retained_day_30')).id is not null then raise exception 'Day 30 is already recorded' using errcode = '55000'; end if;
      if on_day < joined.occurred_on or on_day >= joined.occurred_on + 30 then raise exception 'The leaving date must be within the first 30 days' using errcode = '22023'; end if;
    end if;
    if p_kind <> 'left_before_day_30' and (private.active_milestone(p_application, 'left_before_day_30')).id is not null then
      raise exception 'Leaving before day 30 is already recorded' using errcode = '55000';
    end if;
  end if;
  if p_kind = 'left_before_day_30' then perform private.check_outcome_tag(p_outcome_tag, 'left_before_day_30', s.o_side);
  elsif p_kind = 'candidate_no_show' then p_outcome_tag := 'candidate_no_show';
  elsif p_outcome_tag is not null then raise exception 'Reason tags are only used for no-shows and early exits' using errcode = '22023'; end if;
  mid := private.add_milestone(p_application, s.o_company, s.o_candidate, p_kind, s.o_side, false, on_day, p_note);
  update public.hiring_milestones set outcome_tag = p_outcome_tag where id = mid;
  perform private.notify_other_side(s.o_side, s.o_candidate, s.o_company, 'hiring.confirm_needed', 'Please confirm: ' || private.milestone_label(p_kind));
  return mid;
end $$;

create or replace function private.company_scorecard(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  since timestamptz := now() - interval '365 days';
  resp_n integer; resp_median numeric; resp_7d integer;
  offers integer; withdrawn integer; joined integer; no_show integer; kept integer; left_early integer; active integer;
  r jsonb; shown boolean; evidence jsonb; reasons jsonb; commit_days integer; commit_n integer; commit_total integer; method text; verified_on timestamptz;
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
  select review_commitment_days into commit_days from public.companies where id = p_company;
  if commit_days is not null then
    select count(*) filter (where e1 is not null and e1 <= a.applied_at + make_interval(days => commit_days)), count(*) into commit_n, commit_total
      from public.applications a join public.jobs j on j.id = a.job_id
      cross join lateral (select min(e.created_at) e1 from public.application_events e where e.application_id = a.id and e.actor_id is distinct from a.candidate_id and e.to_stage <> 'applied') x
     where j.company_id = p_company and a.applied_at >= since and (x.e1 is not null or a.applied_at < now() - interval '7 days');
  end if;
  -- How outcomes were established, and why offers/hires did not complete (shown only above the same thresholds).
  select jsonb_build_object('both_sides', count(*) filter (where confirmed_via in ('counterparty', 'single_party')),
                            'auto_confirmed', count(*) filter (where confirmed_via = 'auto'), 'decided_by_kaamsetu', count(*) filter (where confirmed_via = 'admin'))
    into evidence from public.hiring_milestones
   where company_id = p_company and status = 'confirmed' and reported_at >= since
     and kind in ('joined_day_1', 'candidate_no_show', 'retained_day_15', 'retained_day_30', 'left_before_day_30');
  select coalesce(jsonb_object_agg(k, jsonb_build_object('label', label, 'category', category, 'count', n)), '{}'::jsonb) into reasons from (
    select m.kind || ':' || m.outcome_tag k, o.label, o.category, count(*) n from public.hiring_milestones m join public.outcome_reasons o on o.code = m.outcome_tag
     where m.company_id = p_company and m.status = 'confirmed' and m.reported_at >= since and m.kind in ('offer_withdrawn', 'left_before_day_30', 'offer_declined')
     group by 1, 2, 3) t;
  select v.identifier_type, v.reviewed_at into method, verified_on from private.company_verifications v
   where v.company_id = p_company and v.decision = 'approved' order by v.reviewed_at desc nulls last limit 1;

  r := jsonb_build_object(
    'company_id', p_company, 'window_days', 365, 'active_jobs', active,
    'verification', jsonb_build_object('method', case method when 'gstin' then 'GSTIN' when 'cin' then 'CIN' when 'llpin' then 'LLPIN' when 'domain' then 'Company domain' when 'other' then 'Official document' end,
                                       'verified_on', verified_on::date),
    'commitment', jsonb_build_object('review_days', commit_days, 'sample', commit_total, 'met_pct', case when commit_days is not null and commit_total >= 5 then round(100.0 * commit_n / commit_total) end),
    'evidence', evidence,
    'outcome_reasons', case when offers >= 3 or (joined + no_show) >= 3 or (kept + left_early) >= 3 then reasons else '{}'::jsonb end,
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
    'last_confirmed_at', j.last_confirmed_at, 'office_days', j.office_days, 'review_commitment_days', c.review_commitment_days,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'required', q.required) order by q.position)
                           from public.job_questions q where q.job_id = j.id), '[]'::jsonb),
    'scorecard', case when c.verification_status = 'approved' then private.company_scorecard(c.id) end,
    'skills', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'required', js.required) order by s.name) from public.job_skills js join public.skills s on s.id = js.skill_id where js.job_id = j.id), '[]'::jsonb),
    'saved', exists (select 1 from public.saved_jobs sj where sj.job_id = j.id and sj.candidate_id = uid),
    'application_id', (select a.id from public.applications a where a.job_id = j.id and a.candidate_id = uid),
    'match', private.match_score(uid, j.id))
  into r from public.jobs j join public.companies c on c.id = j.company_id left join public.locations l on l.id = j.location_id where j.id = p_job;
  return r;
end $$;

create or replace function public.schema_version()
returns text language sql immutable set search_path = '' as $$ select '202611270001'::text $$;
revoke all on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated, service_role;
revoke all on function public.transition_application(uuid, public.application_stage, text, text, text), public.withdraw_application(uuid, text),
  public.respond_to_offer(uuid, boolean, text, text), public.withdraw_offer(uuid, text, text), public.report_hiring_milestone(uuid, text, date, text, text),
  public.set_job_questions(uuid, jsonb), public.apply_with_answers(uuid, text, jsonb), public.job_application_answers(uuid),
  public.set_review_commitment(uuid, integer), public.job_detail(uuid) from public, anon;
grant execute on function public.transition_application(uuid, public.application_stage, text, text, text), public.withdraw_application(uuid, text),
  public.respond_to_offer(uuid, boolean, text, text), public.withdraw_offer(uuid, text, text), public.report_hiring_milestone(uuid, text, date, text, text),
  public.set_job_questions(uuid, jsonb), public.apply_with_answers(uuid, text, jsonb), public.job_application_answers(uuid),
  public.set_review_commitment(uuid, integer), public.job_detail(uuid) to authenticated;
revoke all on function private.check_outcome_tag(text, text, text), private.require_answers(), private.company_scorecard(uuid) from public, anon, authenticated;
