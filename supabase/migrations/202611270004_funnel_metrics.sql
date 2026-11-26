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

create or replace function public.schema_version()
returns text language sql immutable set search_path = '' as $$ select '202611270004'::text $$;
revoke all on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated, service_role;
revoke all on function public.admin_funnel(integer) from public, anon;
grant execute on function public.admin_funnel(integer) to authenticated;
revoke all on function private.is_test_user(uuid), private.is_test_company(uuid) from public, anon, authenticated;
