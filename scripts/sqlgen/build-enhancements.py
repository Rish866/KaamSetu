#!/usr/bin/env python3
"""Generates migrations 202611270001-0004 (accountability, privacy and Pan-India enhancements).
Functions that change are taken verbatim from their latest migration and patched with exact string replacements, so the
unchanged parts stay identical. Run once before release; migrations are never edited after they are applied.
  python3 scripts/sqlgen/build-enhancements.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from extract import latest

def fn(name, *pairs):
    _, body = latest(name)
    for a, b in pairs:
        if a not in body: raise SystemExit(f'{name}: patch target not found: {a[:80]!r}')
        body = body.replace(a, b, 1)
    return body.replace('create function ', 'create or replace function ', 1)

def write(path, text):
    open('supabase/migrations/' + path, 'w').write(text.strip() + '\n'); print('wrote', path)

VERSION = lambda v: f"""create or replace function public.schema_version()
returns text language sql immutable set search_path = '' as $$ select '{v}'::text $$;
revoke all on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated, service_role;"""

# ============================================================================== 0001
TAG_CHECK = "  if p_outcome_tag is not null or {required} then perform private.check_outcome_tag(p_outcome_tag, {ctx}, {role}); end if;\n"

transition = fn('public.transition_application',
  ("create or replace function public.transition_application(p_application uuid, p_to public.application_stage, p_reason text default null, p_details text default null)",
   "create or replace function public.transition_application(p_application uuid, p_to public.application_stage, p_reason text default null, p_details text default null, p_outcome_tag text default null)"),
  ("  if p_to = 'rejected' then v_reason := private.require_reason(p_reason, 3); else v_reason := left(p_reason, 1000); end if;",
   "  if p_to = 'rejected' then v_reason := private.require_reason(p_reason, 3); perform private.check_outcome_tag(p_outcome_tag, 'rejected', 'employer');\n"
   "  else v_reason := left(p_reason, 1000); if p_outcome_tag is not null then raise exception 'Reason tags are only used when rejecting' using errcode = '22023'; end if; end if;"),
  ("  insert into public.application_events (application_id, from_stage, to_stage, actor_id, reason, details)\n  values (a.id, a.stage, p_to, uid, v_reason, left(p_details, 2000));",
   "  insert into public.application_events (application_id, from_stage, to_stage, actor_id, reason, details, outcome_tag)\n  values (a.id, a.stage, p_to, uid, v_reason, left(p_details, 2000), p_outcome_tag);"),
)
withdraw_app = fn('public.withdraw_application',
  ("create or replace function public.withdraw_application(p_application uuid)", "create or replace function public.withdraw_application(p_application uuid, p_outcome_tag text default null)"),
  ("  if a.stage in ('hired','rejected','withdrawn') then raise exception 'This application is already closed' using errcode = '55000'; end if;",
   "  if a.stage in ('hired','rejected','withdrawn') then raise exception 'This application is already closed' using errcode = '55000'; end if;\n"
   "  if p_outcome_tag is not null then perform private.check_outcome_tag(p_outcome_tag, 'withdrawn', 'candidate'); end if;"),
  ("  insert into public.application_events (application_id, from_stage, to_stage, actor_id) values (a.id, a.stage, 'withdrawn', uid);",
   "  insert into public.application_events (application_id, from_stage, to_stage, actor_id, outcome_tag) values (a.id, a.stage, 'withdrawn', uid, p_outcome_tag);"),
)
respond_offer = fn('public.respond_to_offer',
  ("create or replace function public.respond_to_offer(p_application uuid, p_accept boolean, p_reason text default null)",
   "create or replace function public.respond_to_offer(p_application uuid, p_accept boolean, p_reason text default null, p_outcome_tag text default null)"),
  ("  if p_accept then", "  if not p_accept and p_outcome_tag is not null then perform private.check_outcome_tag(p_outcome_tag, 'offer_declined', 'candidate'); end if;\n  if p_accept then"),
  ("    perform private.add_milestone(p_application, s.o_company, s.o_candidate, 'offer_declined', 'candidate', true, current_date, p_reason);",
   "    perform private.add_milestone(p_application, s.o_company, s.o_candidate, 'offer_declined', 'candidate', true, current_date, p_reason);\n"
   "    update public.hiring_milestones set outcome_tag = p_outcome_tag where application_id = p_application and kind = 'offer_declined' and status <> 'rejected';"),
  ("    insert into public.application_events (application_id, from_stage, to_stage, actor_id, reason)\n    values (p_application, 'offer', 'withdrawn', uid,",
   "    insert into public.application_events (application_id, from_stage, to_stage, actor_id, outcome_tag, reason)\n    values (p_application, 'offer', 'withdrawn', uid, p_outcome_tag,"),
)
withdraw_offer = fn('public.withdraw_offer',
  ("create or replace function public.withdraw_offer(p_application uuid, p_reason text)", "create or replace function public.withdraw_offer(p_application uuid, p_reason text, p_outcome_tag text default null)"),
  ("  if s.o_side <> 'employer' then raise exception 'Only the employer can withdraw an offer' using errcode = '42501'; end if;",
   "  if s.o_side <> 'employer' then raise exception 'Only the employer can withdraw an offer' using errcode = '42501'; end if;\n  perform private.check_outcome_tag(p_outcome_tag, 'offer_withdrawn', 'employer');"),
  ("  perform private.add_milestone(p_application, s.o_company, s.o_candidate, 'offer_withdrawn', 'employer', true, current_date, v_reason);",
   "  perform private.add_milestone(p_application, s.o_company, s.o_candidate, 'offer_withdrawn', 'employer', true, current_date, v_reason);\n"
   "  update public.hiring_milestones set outcome_tag = p_outcome_tag where application_id = p_application and kind = 'offer_withdrawn' and status <> 'rejected';"),
  ("  insert into public.application_events (application_id, from_stage, to_stage, actor_id, reason) values (p_application, s.o_stage, 'rejected', uid, 'Offer withdrawn: ' || v_reason);",
   "  insert into public.application_events (application_id, from_stage, to_stage, actor_id, reason, outcome_tag) values (p_application, s.o_stage, 'rejected', uid, 'Offer withdrawn: ' || v_reason, p_outcome_tag);"),
)
report_ms = fn('public.report_hiring_milestone',
  ("create or replace function public.report_hiring_milestone(p_application uuid, p_kind text, p_on date default null, p_note text default null)",
   "create or replace function public.report_hiring_milestone(p_application uuid, p_kind text, p_on date default null, p_note text default null, p_outcome_tag text default null)"),
  ("  mid := private.add_milestone(p_application, s.o_company, s.o_candidate, p_kind, s.o_side, false, on_day, p_note);",
   "  if p_kind = 'left_before_day_30' then perform private.check_outcome_tag(p_outcome_tag, 'left_before_day_30', s.o_side);\n"
   "  elsif p_kind = 'candidate_no_show' then p_outcome_tag := 'candidate_no_show';\n"
   "  elsif p_outcome_tag is not null then raise exception 'Reason tags are only used for no-shows and early exits' using errcode = '22023'; end if;\n"
   "  mid := private.add_milestone(p_application, s.o_company, s.o_candidate, p_kind, s.o_side, false, on_day, p_note);\n"
   "  update public.hiring_milestones set outcome_tag = p_outcome_tag where id = mid;"),
)
scorecard = fn('private.company_scorecard',
  ("  r jsonb; shown boolean;", "  r jsonb; shown boolean; evidence jsonb; reasons jsonb; commit_days integer; commit_n integer; commit_total integer; method text; verified_on timestamptz;"),
  ("  select count(*) into active from public.jobs j where j.company_id = p_company and private.job_is_public(j.id);",
   """  select count(*) into active from public.jobs j where j.company_id = p_company and private.job_is_public(j.id);
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
   where v.company_id = p_company and v.decision = 'approved' order by v.reviewed_at desc nulls last limit 1;"""),
  ("    'company_id', p_company, 'window_days', 365, 'active_jobs', active,",
   """    'company_id', p_company, 'window_days', 365, 'active_jobs', active,
    'verification', jsonb_build_object('method', case method when 'gstin' then 'GSTIN' when 'cin' then 'CIN' when 'llpin' then 'LLPIN' when 'domain' then 'Company domain' when 'other' then 'Official document' end,
                                       'verified_on', verified_on::date),
    'commitment', jsonb_build_object('review_days', commit_days, 'sample', commit_total, 'met_pct', case when commit_days is not null and commit_total >= 5 then round(100.0 * commit_n / commit_total) end),
    'evidence', evidence,
    'outcome_reasons', case when offers >= 3 or (joined + no_show) >= 3 or (kept + left_early) >= 3 then reasons else '{}'::jsonb end,"""),
)
job_detail = fn('public.job_detail',
  ("    'last_confirmed_at', j.last_confirmed_at,",
   """    'last_confirmed_at', j.last_confirmed_at, 'office_days', j.office_days, 'review_commitment_days', c.review_commitment_days,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'required', q.required) order by q.position)
                           from public.job_questions q where q.job_id = j.id), '[]'::jsonb),"""),
)

M1 = f"""
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
  ('employer_role_on_hold', 'Role put on hold', 'employer', 'business_change', '{{rejected,offer_withdrawn}}'),
  ('employer_position_filled', 'Position already filled', 'employer', 'business_change', '{{rejected,offer_withdrawn}}'),
  ('budget_or_headcount_change', 'Budget or headcount changed', 'employer', 'business_change', '{{rejected,offer_withdrawn}}'),
  ('skills_or_experience_gap', 'Skills or experience do not match the role', 'employer', 'fit', '{{rejected}}'),
  ('compensation_mismatch', 'Salary expectations do not match', 'either', 'fit', '{{rejected,withdrawn,offer_declined,offer_withdrawn,left_before_day_30}}'),
  ('location_or_work_mode_mismatch', 'Location or work mode does not fit', 'either', 'logistics', '{{rejected,withdrawn,offer_declined}}'),
  ('candidate_unresponsive', 'Candidate stopped responding', 'employer', 'conduct', '{{rejected,offer_withdrawn}}'),
  ('candidate_accepted_other_offer', 'Accepted another offer', 'candidate', 'fit', '{{withdrawn,offer_declined,left_before_day_30}}'),
  ('relocation_or_commute_change', 'Relocation or commute changed', 'candidate', 'logistics', '{{withdrawn,offer_declined,left_before_day_30}}'),
  ('personal_reasons', 'Personal reasons', 'candidate', 'logistics', '{{withdrawn,offer_declined,left_before_day_30}}'),
  ('employer_unresponsive', 'Employer stopped responding', 'candidate', 'conduct', '{{withdrawn}}'),
  ('role_different_from_listing', 'Role differs from the job listing', 'candidate', 'conduct', '{{withdrawn,offer_declined,left_before_day_30}}'),
  ('candidate_no_show', 'Did not join on the agreed day', 'employer', 'conduct', '{{candidate_no_show}}'),
  ('early_exit_resigned', 'Left: resigned', 'either', 'ended_by_candidate', '{{left_before_day_30}}'),
  ('early_exit_let_go', 'Left: employment ended by the employer', 'either', 'ended_by_employer', '{{left_before_day_30}}');
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

{transition}

{withdraw_app}

{respond_offer}

{withdraw_offer}

{report_ms}

{scorecard}

{job_detail}

{VERSION('202611270001')}
revoke all on function public.transition_application(uuid, public.application_stage, text, text, text), public.withdraw_application(uuid, text),
  public.respond_to_offer(uuid, boolean, text, text), public.withdraw_offer(uuid, text, text), public.report_hiring_milestone(uuid, text, date, text, text),
  public.set_job_questions(uuid, jsonb), public.apply_with_answers(uuid, text, jsonb), public.job_application_answers(uuid),
  public.set_review_commitment(uuid, integer), public.job_detail(uuid) from public, anon;
grant execute on function public.transition_application(uuid, public.application_stage, text, text, text), public.withdraw_application(uuid, text),
  public.respond_to_offer(uuid, boolean, text, text), public.withdraw_offer(uuid, text, text), public.report_hiring_milestone(uuid, text, date, text, text),
  public.set_job_questions(uuid, jsonb), public.apply_with_answers(uuid, text, jsonb), public.job_application_answers(uuid),
  public.set_review_commitment(uuid, integer), public.job_detail(uuid) to authenticated;
revoke all on function private.check_outcome_tag(text, text, text), private.require_answers(), private.company_scorecard(uuid) from public, anon, authenticated;
"""


# ============================================================================== 0002
set_consent = fn('public.set_consent',
  ("  if p_purpose = 'employer_discovery' then",
   "  -- Auditable, PII-free record of the choice (purpose and notice version only).\n"
   "  perform private.audit('consent.' || case when p_granted then 'granted' else 'withdrawn' end, 'consent', null, null,\n"
   "    jsonb_build_object('purpose', p_purpose, 'notice_version', trim(p_notice_version)));\n"
   "  if p_purpose = 'resume_parsing' and not p_granted then\n"
   "    update public.resumes set parse_status = 'skipped' where candidate_id = uid and parse_status = 'pending';\n"
   "  end if;\n"
   "  if p_purpose = 'employer_discovery' then"),
)
resume = fn('public.get_applicant_resume',
  ("  if a.stage = 'withdrawn' then raise exception 'This application was withdrawn' using errcode = '55000'; end if;",
   "  -- Data minimisation: once an application is closed (withdrawn or rejected) the resume is no longer shared.\n"
   "  if a.stage in ('withdrawn', 'rejected') then raise exception 'This application is closed, so the resume is no longer shared' using errcode = '55000'; end if;"),
)
M2 = f"""
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

{set_consent}

{resume}

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
    'events', coalesce((select jsonb_agg(t.e order by (t.e->>'at')::timestamptz desc) from (select u.e from (
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
      ) u order by (u.e->>'at')::timestamptz desc limit lim) t), '[]'::jsonb));
end $$;

{VERSION('202611270002')}
revoke all on function public.my_access_log(integer), public.set_consent(text, boolean, text), public.get_applicant_resume(uuid) from public, anon;
grant execute on function public.my_access_log(integer), public.set_consent(text, boolean, text), public.get_applicant_resume(uuid) to authenticated;
"""

# ============================================================================== 0003
loc_fit = fn('private.location_fit',
  ("declare j public.jobs%rowtype; jl public.locations%rowtype; r record; base numeric; tier text;",
   "declare j public.jobs%rowtype; jl public.locations%rowtype; r record; base numeric; tier text; reloc text; home_state text;"),
  ("  return jsonb_build_object('score', round(best, 1), 'tier', best_tier, 'rank', best_rank);",
   "  -- Relocation willingness lifts a weak location match (never above a real area/city/district match).\n"
   "  select cp.relocation, h.state_code into reloc, home_state from public.candidate_profiles cp\n"
   "    left join public.locations h on h.id = cp.current_location_id where cp.user_id = p_candidate;\n"
   "  if reloc = 'anywhere_india' and coalesce(best, 0) < 60 then best := 60; best_tier := 'relocation'; best_rank := null;\n"
   "  elsif reloc = 'within_state' and home_state = jl.state_code and coalesce(best, 0) < 65 then best := 65; best_tier := 'relocation_state'; best_rank := null;\n"
   "  end if;\n"
   "  return jsonb_build_object('score', round(best, 1), 'tier', best_tier, 'rank', best_rank);"),
)
match = fn('private.match_score',
  ("            when 'state' then 'The job is in a state you are open to.'",
   "            when 'state' then 'The job is in a state you are open to.'\n"
   "            when 'relocation' then 'You are willing to relocate anywhere in India.'\n"
   "            when 'relocation_state' then 'You are willing to relocate within your state.'"),
)
email_cat = fn('private.email_category',
  ("'interview.confirmed','interview.reschedule_requested','resume.suggestions','account.registered') then 'optional'",
   "'interview.confirmed','interview.reschedule_requested','resume.suggestions','account.registered','job.match_alert') then 'optional'"),
)
M3 = f"""
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

{loc_fit}

{match}

drop function public.discover_candidates(uuid, text, uuid[], text[], integer, integer, integer, integer);
create function public.discover_candidates(
  p_job uuid, p_skill text default null, p_places uuid[] default null, p_states text[] default null,
  p_min_months integer default null, p_max_months integer default null, p_max_salary integer default null, p_limit integer default 25)
returns table (candidate_id uuid, headline text, city text, locality text, state_name text, location_label text, experience_months integer,
               expected_salary integer, salary_period text, notice_days integer, skills text[], score numeric, match jsonb, relocation text)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); j public.jobs%rowtype; lim integer := least(greatest(coalesce(p_limit, 25), 1), 50);
        places uuid[] := nullif(p_places, '{{}}'); states text[] := nullif(p_states, '{{}}');
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
                  where cs.candidate_id = cp.user_id and cs.confirmed), '{{}}'::text[]) as skill_names
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

{email_cat}

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

{VERSION('202611270003')}
revoke all on function public.discover_candidates(uuid, text, uuid[], text[], integer, integer, integer, integer), public.job_applicant_preferences(uuid),
  public.set_job_alerts(boolean) from public, anon;
grant execute on function public.discover_candidates(uuid, text, uuid[], text[], integer, integer, integer, integer), public.job_applicant_preferences(uuid),
  public.set_job_alerts(boolean) to authenticated;
revoke all on function public.job_alerts_run() from public, anon, authenticated;
grant execute on function public.job_alerts_run() to service_role;
revoke all on function private.location_fit(uuid, uuid), private.match_score(uuid, uuid) from public, anon, authenticated;
"""

# ============================================================================== 0004
M4 = f"""
-- 202611270004 Privacy-safe funnel and trust metrics for administrators (aggregates only, no names or contact data).
-- Stages: job_published -> application_submitted -> employer_first_action -> offer_issued -> offer_accepted ->
-- joined_day_1 -> retained_day_15 -> retained_day_30. QA test identities (qa+...@getkaamsetu.in, +91 1000xxxxxx) and
-- their companies are excluded, so automated production tests never distort pilot numbers.

create or replace function private.is_test_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_user
                  and (p.email like 'qa+%@getkaamsetu.in' or ltrim(coalesce(p.phone, ''), '+') like '911000%')) $$;
create or replace function private.is_test_company(p_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.companies c where c.id = p_company and (c.display_name like 'QA Test Co %' or c.legal_name like 'QA Test Co %'))
      or exists (select 1 from public.company_members m where m.company_id = p_company and m.role = 'owner' and private.is_test_user(m.user_id)) $$;

create or replace function public.admin_funnel(p_days integer default 90)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 90), 7), 730)); r jsonb;
begin
  perform private.require_admin(array['admin', 'support']);
  with apps as (
    select a.id, a.applied_at, a.candidate_id, j.company_id,
      (select min(e.created_at) from public.application_events e where e.application_id = a.id and e.actor_id is distinct from a.candidate_id and e.to_stage <> 'applied') first_action
      from public.applications a join public.jobs j on j.id = a.job_id
     where a.applied_at >= since and not private.is_test_user(a.candidate_id) and not private.is_test_company(j.company_id)),
  ms as (
    select m.* from public.hiring_milestones m join apps a on a.id = m.application_id where m.status <> 'rejected'),
  stages as (
    select jsonb_build_array(
      jsonb_build_object('stage', 'job_published', 'count', (select count(distinct je.job_id) from public.job_events je join public.jobs j on j.id = je.job_id
                                                              where je.to_status = 'published' and je.created_at >= since and not private.is_test_company(j.company_id))),
      jsonb_build_object('stage', 'application_submitted', 'count', (select count(*) from apps)),
      jsonb_build_object('stage', 'employer_first_action', 'count', (select count(*) from apps where first_action is not null)),
      jsonb_build_object('stage', 'offer_issued', 'count', (select count(*) from ms where kind = 'offer_issued')),
      jsonb_build_object('stage', 'offer_accepted', 'count', (select count(*) from ms where kind = 'offer_accepted')),
      jsonb_build_object('stage', 'joined_day_1', 'count', (select count(*) from ms where kind = 'joined_day_1' and status = 'confirmed')),
      jsonb_build_object('stage', 'retained_day_15', 'count', (select count(*) from ms where kind = 'retained_day_15' and status = 'confirmed')),
      jsonb_build_object('stage', 'retained_day_30', 'count', (select count(*) from ms where kind = 'retained_day_30' and status = 'confirmed'))) s)
  select jsonb_build_object(
    'window_days', extract(day from now() - since)::int, 'generated_at', now(),
    'stages', (select s from stages),
    'timing', jsonb_build_object(
      'median_hours_to_first_action', (select round((percentile_cont(0.5) within group (order by extract(epoch from first_action - applied_at) / 3600))::numeric, 1) from apps where first_action is not null),
      'answered_within_7_days_pct', (select case when count(*) filter (where first_action is not null or applied_at < now() - interval '7 days') > 0 then
          round(100.0 * count(*) filter (where first_action <= applied_at + interval '7 days') / count(*) filter (where first_action is not null or applied_at < now() - interval '7 days')) end from apps)),
    'trust', jsonb_build_object(
      'milestones_auto_confirmed', (select count(*) from ms where confirmed_via = 'auto'),
      'milestones_confirmed_by_both', (select count(*) from ms where confirmed_via = 'counterparty'),
      'disputes_open', (select count(*) from ms where status = 'disputed'),
      'disputes_decided', (select count(*) from ms where confirmed_via = 'admin' or resolved_by is not null),
      'job_reports', (select count(*) from public.abuse_reports ar where ar.created_at >= since),
      'jobs_auto_paused', (select count(*) from public.job_events je join public.jobs j on j.id = je.job_id
                            where je.actor_id is null and je.to_status = 'paused' and je.created_at >= since and not private.is_test_company(j.company_id)),
      'companies_verified', (select count(*) from public.companies c where c.verification_status = 'approved' and not private.is_test_company(c.id))),
    'outcome_reasons', coalesce((select jsonb_agg(jsonb_build_object('reason', o.label, 'category', o.category, 'count', t.n) order by t.n desc)
        from (select tag, count(*) n from (
                select e.outcome_tag tag from public.application_events e join apps a on a.id = e.application_id where e.outcome_tag is not null
                union all select outcome_tag from ms where outcome_tag is not null and kind in ('candidate_no_show', 'left_before_day_30')) u group by tag) t
        join public.outcome_reasons o on o.code = t.tag), '[]'::jsonb),
    'weekly', coalesce((select jsonb_agg(jsonb_build_object('week', w, 'applications', na, 'first_actions', nf) order by w)
        from (select date_trunc('week', applied_at)::date w, count(*) na, count(first_action) nf from apps group by 1) x), '[]'::jsonb)
  ) into r;
  return r;
end $$;

{VERSION('202611270004')}
revoke all on function public.admin_funnel(integer) from public, anon;
grant execute on function public.admin_funnel(integer) to authenticated;
revoke all on function private.is_test_user(uuid), private.is_test_company(uuid) from public, anon, authenticated;
"""

if __name__ == '__main__':
    write('202611270001_outcomes_readiness_trust.sql', M1)
    write('202611270002_access_log_minimisation.sql', M2)
    write('202611270003_relocation_alerts.sql', M3)
    write('202611270004_funnel_metrics.sql', M4)
