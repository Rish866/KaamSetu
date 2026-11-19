-- KaamSetu security foundation (WP1).
-- Closes privilege-escalation gaps in the MVP schema, moves every state change
-- behind validated, audited, transactional functions, and adds the first
-- deterministic matching engine. Never edit this file after it is applied.

------------------------------------------------------------------------------
-- 1. Explicit grants: remove every implicit privilege, re-grant what is needed.
------------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;
revoke all on schema private from anon, authenticated;
grant usage on schema private to authenticated; -- needed to evaluate RLS helper functions

------------------------------------------------------------------------------
-- 2. Schema additions
------------------------------------------------------------------------------
alter table public.candidate_profiles
  add column if not exists current_salary integer check (current_salary >= 0),
  add column if not exists work_modes text[] not null default array['onsite','hybrid','remote'],
  add column if not exists employment_types text[] not null default array['full_time','part_time','contract','internship'],
  add constraint candidate_work_modes_valid check (work_modes <@ array['onsite','hybrid','remote'] and cardinality(work_modes) > 0),
  add constraint candidate_employment_types_valid check (employment_types <@ array['full_time','part_time','contract','internship'] and cardinality(employment_types) > 0);

alter table public.companies add column if not exists verification_reason text;

alter table public.resumes add column if not exists deleted_at timestamptz;
create unique index if not exists resumes_candidate_sha_active
  on public.resumes (candidate_id, sha256) where deleted_at is null;
create unique index if not exists resumes_one_active
  on public.resumes (candidate_id) where active and deleted_at is null;

alter table public.applications
  add column if not exists note text check (char_length(note) <= 1000),
  add column if not exists match_snapshot jsonb;

alter table public.application_events add column if not exists details text;

alter table public.interviews
  add column if not exists response_note text check (char_length(response_note) <= 500),
  add column if not exists updated_at timestamptz not null default now();

alter table private.company_verifications drop constraint if exists company_verifications_identifier_type_check;
alter table private.company_verifications
  add constraint company_verifications_identifier_type_check
  check (identifier_type in ('cin', 'llpin', 'gstin', 'domain', 'other'));

create table public.job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  from_status public.job_status,
  to_status public.job_status not null,
  actor_id uuid not null references public.profiles(id),
  reason text,
  created_at timestamptz not null default now()
);
create index job_events_job_idx on public.job_events (job_id, created_at desc);

create table public.contact_disclosures (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles(user_id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  disclosed_to uuid not null references public.profiles(id),
  fields text[] not null,
  created_at timestamptz not null default now()
);
create index contact_disclosures_candidate_idx on public.contact_disclosures (candidate_id, created_at desc);

create table public.matching_versions (
  version integer primary key,
  weights jsonb not null,
  active boolean not null default false,
  reason text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint matching_weights_shape check (
    weights ?& array['skills','location','salary','experience','freshness']
    and (weights->>'skills')::numeric >= 0 and (weights->>'location')::numeric >= 0
    and (weights->>'salary')::numeric >= 0 and (weights->>'experience')::numeric >= 0
    and (weights->>'freshness')::numeric >= 0
    and (weights->>'skills')::numeric + (weights->>'location')::numeric + (weights->>'salary')::numeric
      + (weights->>'experience')::numeric + (weights->>'freshness')::numeric = 100
  )
);
create unique index matching_one_active on public.matching_versions (active) where active;
insert into public.matching_versions (version, weights, active, reason)
values (1, '{"skills":35,"location":25,"salary":20,"experience":15,"freshness":5}', true, 'Initial deterministic engine');

create index if not exists company_members_user_idx on public.company_members (user_id) where active;
create index if not exists notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index if not exists interviews_application_idx on public.interviews (application_id, status);
create index if not exists audit_events_actor_idx on private.audit_events (actor_id, created_at desc);
create index if not exists audit_events_target_idx on private.audit_events (target_type, target_id);

alter table public.job_events enable row level security;
alter table public.contact_disclosures enable row level security;
alter table public.matching_versions enable row level security;

------------------------------------------------------------------------------
-- 3. Immutability of audit-like records
------------------------------------------------------------------------------
create or replace function private.deny_modify()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception '% rows are immutable', tg_table_name using errcode = '42501';
end $$;

create trigger audit_events_immutable before update or delete on private.audit_events
  for each row execute function private.deny_modify();
create trigger consent_records_immutable before update on public.consent_records
  for each row execute function private.deny_modify();
create trigger application_events_immutable before update on public.application_events
  for each row execute function private.deny_modify();
create trigger job_events_immutable before update on public.job_events
  for each row execute function private.deny_modify();
create trigger contact_disclosures_immutable before update on public.contact_disclosures
  for each row execute function private.deny_modify();

------------------------------------------------------------------------------
-- 4. Helpers
------------------------------------------------------------------------------
create or replace function private.require_user()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = uid and status = 'active') then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  return uid;
end $$;

create or replace function private.require_admin(allowed text[])
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not exists (select 1 from private.app_roles where user_id = uid and role = any(allowed)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return uid;
end $$;

create or replace function private.require_reason(reason text, min_len int default 5)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if reason is null or char_length(trim(reason)) < min_len then
    raise exception 'A reason of at least % characters is required', min_len using errcode = '22023';
  end if;
  return left(trim(reason), 1000);
end $$;

create or replace function private.audit(
  p_action text, p_target_type text, p_target_id uuid,
  p_company uuid default null, p_metadata jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into private.audit_events (actor_id, action, target_type, target_id, company_id, metadata)
  values ((select auth.uid()), p_action, p_target_type, p_target_id, p_company, coalesce(p_metadata, '{}'::jsonb));
end $$;

-- Notification titles/bodies must never contain candidate-sensitive details.
create or replace function private.notify(p_recipient uuid, p_kind text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (recipient_id, kind, title, body) values (p_recipient, p_kind, p_title, p_body);
end $$;

create or replace function private.notify_company(p_company uuid, p_roles public.company_role[], p_kind text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (recipient_id, kind, title, body)
  select cm.user_id, p_kind, p_title, p_body
  from public.company_members cm
  where cm.company_id = p_company and cm.active and cm.role = any(p_roles);
end $$;

create or replace function private.company_is_approved(p_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.companies where id = p_company and verification_status = 'approved');
$$;

create or replace function private.job_is_public(p_job uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.jobs j join public.companies c on c.id = j.company_id
    where j.id = p_job and j.status = 'published' and c.verification_status = 'approved'
      and (j.closes_at is null or j.closes_at > now()));
$$;

create or replace function private.job_is_editable(p_job uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs where id = p_job and status in ('draft', 'rejected'));
$$;

-- Last active owner of a company can never be removed, demoted or deleted.
create or replace function private.guard_last_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active)
     and not exists (
       select 1 from public.company_members cm
       where cm.company_id = old.company_id and cm.role = 'owner' and cm.active and cm.user_id <> old.user_id)
     and exists (select 1 from public.companies c where c.id = old.company_id) then
    raise exception 'A company must keep at least one active owner' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger company_members_last_owner before update or delete on public.company_members
  for each row execute function private.guard_last_owner();

-- Every new candidate gets a candidate profile row.
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
    lower(new.email), new.email_confirmed_at, new.phone, new.phone_confirmed_at, requested_kind)
  on conflict (id) do nothing;

  if requested_kind = 'candidate' then
    insert into public.candidate_profiles (user_id) values (new.id) on conflict do nothing;
  end if;
  if notice_version is not null then
    insert into public.consent_records (user_id, purpose, action, notice_version, channel)
    values (new.id, 'account', 'granted', notice_version, 'app');
  end if;
  return new;
end $$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

insert into public.candidate_profiles (user_id)
select id from public.profiles where account_kind = 'candidate' on conflict do nothing;

------------------------------------------------------------------------------
-- 5. Matching engine v1 (deterministic, explainable, versioned)
--    Inputs are limited to skills, location, work-mode, salary, experience and
--    job age. No name, contact, photo, age, gender, religion, caste, marital
--    status or disability data is read anywhere in this engine.
------------------------------------------------------------------------------
create or replace function private.annual_salary(amount integer, period text)
returns numeric language sql immutable set search_path = '' as $$
  select case when amount is null then null when period = 'monthly' then amount * 12.0 else amount::numeric end;
$$;

create or replace function private.score_salary(c_min integer, c_period text, j_min integer, j_max integer, j_period text)
returns numeric language plpgsql immutable set search_path = '' as $$
declare cm numeric := private.annual_salary(c_min, c_period); jn numeric := private.annual_salary(j_min, j_period);
        jx numeric := private.annual_salary(j_max, j_period); gap numeric;
begin
  if cm is null or cm <= 0 or jn is null or jx is null then return null; end if;
  if jx >= cm then
    if jn >= cm then return 100; end if;
    return round(70 + 30 * (jx - cm) / greatest(jx - jn, 1), 1);
  end if;
  gap := (cm - jx) / cm;
  return round(greatest(0, 60 - gap * 300), 1);
end $$;

-- Under-experience is penalised proportionally. Over-experience is only mildly
-- discounted and never below 80, so seniority is not unfairly punished.
create or replace function private.score_experience(c_months integer, j_min integer, j_max integer)
returns numeric language plpgsql immutable set search_path = '' as $$
begin
  if c_months is null or j_min is null then return null; end if;
  if c_months < j_min then
    return round(greatest(0, 100 * (1 - (j_min - c_months)::numeric / greatest(j_min, 12))), 1);
  end if;
  if j_max is not null and c_months > j_max then
    return round(100 - least(20, ((c_months - j_max) / 12.0) * 5), 1);
  end if;
  return 100;
end $$;

create or replace function private.score_freshness(published timestamptz, at_time timestamptz default now())
returns numeric language plpgsql immutable set search_path = '' as $$
declare days numeric;
begin
  if published is null then return null; end if;
  days := extract(epoch from (at_time - published)) / 86400.0;
  if days <= 3 then return 100; end if;
  if days >= 60 then return 0; end if;
  return round(100 * (60 - days) / 57.0, 1);
end $$;

-- Location: remote = 100; same locality = 100; same city = 85; otherwise 0.
-- Lower-ranked preferences lose 3 points per rank (floor 70% of value).
create or replace function private.score_location(p_candidate uuid, p_job uuid)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs%rowtype; jl public.locations%rowtype; best numeric := null; r record; base numeric; factor numeric;
begin
  select * into j from public.jobs where id = p_job;
  if j.work_mode = 'remote' then return 100; end if;
  if j.location_id is null then return null; end if;
  select * into jl from public.locations where id = j.location_id;
  for r in
    select l.city, l.locality, 1 as rank from public.candidate_profiles cp
      join public.locations l on l.id = cp.current_location_id where cp.user_id = p_candidate
    union all
    select l.city, l.locality, cl.preference_rank from public.candidate_locations cl
      join public.locations l on l.id = cl.location_id where cl.candidate_id = p_candidate
  loop
    base := case
      when r.city = jl.city and r.locality is not distinct from jl.locality and jl.locality is not null then 100
      when r.city = jl.city then 85
      else 0 end;
    factor := greatest(0.7, 1 - 0.03 * (r.rank - 1));
    best := greatest(coalesce(best, 0), base * factor);
  end loop;
  return round(best, 1);  -- null when the candidate has no location data
end $$;

create or replace function private.score_skills(p_candidate uuid, p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare total numeric; matched numeric; names_ok text[]; names_missing text[];
begin
  select coalesce(sum(case when js.required then js.weight else js.weight * 0.5 end), 0),
         coalesce(sum(case when cs.skill_id is not null then (case when js.required then js.weight else js.weight * 0.5 end) else 0 end), 0),
         coalesce(array_agg(s.name order by s.name) filter (where cs.skill_id is not null), '{}'),
         coalesce(array_agg(s.name order by s.name) filter (where cs.skill_id is null), '{}')
    into total, matched, names_ok, names_missing
  from public.job_skills js
  join public.skills s on s.id = js.skill_id
  left join public.candidate_skills cs on cs.skill_id = js.skill_id and cs.candidate_id = p_candidate and cs.confirmed
  where js.job_id = p_job;
  if total = 0 then return jsonb_build_object('score', null, 'matched', '[]'::jsonb, 'missing', '[]'::jsonb); end if;
  if not exists (select 1 from public.candidate_skills where candidate_id = p_candidate and confirmed) then
    return jsonb_build_object('score', null, 'matched', '[]'::jsonb, 'missing', to_jsonb(names_missing), 'no_candidate_skills', true);
  end if;
  return jsonb_build_object('score', round(100 * matched / total, 1), 'matched', to_jsonb(names_ok), 'missing', to_jsonb(names_missing));
end $$;

create or replace function private.match_score(p_candidate uuid, p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  mv public.matching_versions%rowtype; cp public.candidate_profiles%rowtype; j public.jobs%rowtype;
  sk jsonb; s_sk numeric; s_loc numeric; s_sal numeric; s_exp numeric; s_fr numeric;
  w_sk numeric; w_loc numeric; w_sal numeric; w_exp numeric; w_fr numeric;
  total numeric; avail numeric := 0; reasons text[] := '{}'; open_job boolean;
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
  s_loc := private.score_location(p_candidate, p_job);
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
        'explanation', case when j.work_mode = 'remote' then 'This job is remote.'
          when s_loc is null then 'Add a current or preferred location to improve this score.'
          when s_loc >= 85 then 'The job is in a city or area you prefer.'
          when s_loc = 0 then 'The job is outside your preferred cities.'
          else 'The job is in a lower-ranked preferred location.' end),
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

------------------------------------------------------------------------------
-- 6. Row-level security: replace permissive MVP policies
------------------------------------------------------------------------------
drop policy if exists candidate_profile_own on public.candidate_profiles;
create policy candidate_profile_select on public.candidate_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy candidate_profile_update on public.candidate_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists resumes_own on public.resumes;
create policy resumes_select_own on public.resumes for select to authenticated
  using (candidate_id = (select auth.uid()) and deleted_at is null);

drop policy if exists company_members_owner_manage on public.company_members;

drop policy if exists jobs_public_read on public.jobs;
create policy jobs_public_read on public.jobs for select to anon, authenticated
  using (status = 'published' and (closes_at is null or closes_at > now()) and private.company_is_approved(company_id));
drop policy if exists jobs_recruiter_insert on public.jobs;
create policy jobs_recruiter_insert on public.jobs for insert to authenticated
  with check (private.is_company_member(company_id, array['owner','recruiter']::public.company_role[])
              and created_by = (select auth.uid()) and status = 'draft');
drop policy if exists jobs_recruiter_update on public.jobs;
create policy jobs_recruiter_update on public.jobs for update to authenticated
  using (status in ('draft','rejected') and private.is_company_member(company_id, array['owner','recruiter']::public.company_role[]))
  with check (status in ('draft','rejected') and private.is_company_member(company_id, array['owner','recruiter']::public.company_role[]));
create policy jobs_staff_read on public.jobs for select to authenticated
  using (private.is_admin(array['admin','moderator']));
create policy companies_staff_read on public.companies for select to authenticated
  using (private.is_admin(array['admin','moderator','support']));

drop policy if exists job_skills_public_read on public.job_skills;
create policy job_skills_public_read on public.job_skills for select to anon, authenticated using (private.job_is_public(job_id));
create policy job_skills_member_read on public.job_skills for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and private.is_company_member(j.company_id)));
drop policy if exists job_skills_company_manage on public.job_skills;
create policy job_skills_company_manage on public.job_skills for all to authenticated
  using (private.job_is_editable(job_id) and exists (select 1 from public.jobs j where j.id = job_id and private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[])))
  with check (private.job_is_editable(job_id) and exists (select 1 from public.jobs j where j.id = job_id and private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[])));

drop policy if exists applications_candidate_insert on public.applications;
drop policy if exists invitations_candidate_update on public.job_invitations;
drop policy if exists invitations_company_insert on public.job_invitations;
drop policy if exists interviews_company_insert on public.interviews;
drop policy if exists consent_own_insert on public.consent_records;

create policy job_events_read on public.job_events for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and private.is_company_member(j.company_id))
         or private.is_admin(array['admin','moderator']));
create policy contact_disclosures_candidate_read on public.contact_disclosures for select to authenticated
  using (candidate_id = (select auth.uid()));
create policy matching_versions_read on public.matching_versions for select to authenticated using (true);
create policy application_events_admin_read on public.application_events for select to authenticated
  using (private.is_admin(array['admin']));

------------------------------------------------------------------------------
-- 7. Explicit table grants (least privilege)
------------------------------------------------------------------------------
grant select on public.locations, public.job_categories, public.skills to anon, authenticated;
grant select (id, display_name, website, description, city, verification_status) on public.companies to anon;
grant select on public.companies to authenticated;
grant update (display_name, website, description, city) on public.companies to authenticated;
grant select on public.company_members to authenticated;
grant select on public.jobs to anon, authenticated;
grant insert (company_id, title, category_id, description, salary_min, salary_max, salary_period,
  experience_min_months, experience_max_months, location_id, work_mode, employment_type, vacancies,
  closes_at, created_by) on public.jobs to authenticated;
grant update (title, category_id, description, salary_min, salary_max, salary_period,
  experience_min_months, experience_max_months, location_id, work_mode, employment_type, vacancies,
  closes_at, updated_at) on public.jobs to authenticated;
grant select on public.job_skills to anon, authenticated;
grant insert, update, delete on public.job_skills to authenticated;
grant select on public.job_events to authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.candidate_profiles to authenticated;
grant update (headline, experience_months, current_location_id, salary_min, salary_period, current_salary,
  notice_days, work_modes, employment_types, updated_at) on public.candidate_profiles to authenticated;
grant select, insert, update, delete on public.candidate_skills to authenticated;
grant select, insert, update, delete on public.candidate_locations to authenticated;
grant select on public.resumes to authenticated;
grant select on public.applications, public.application_events, public.job_invitations,
  public.interviews, public.consent_records, public.contact_disclosures, public.matching_versions to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

------------------------------------------------------------------------------
-- 8. Private storage policies
------------------------------------------------------------------------------
drop policy if exists resume_object_insert on storage.objects;
drop policy if exists resume_object_read on storage.objects;
drop policy if exists resume_object_delete on storage.objects;

create policy resume_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text
              and lower(name) ~ '\.(pdf|docx)$');
create policy resume_object_read on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy resume_object_delete on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-evidence', 'company-evidence', false, 10485760,
        array['application/pdf','image/png','image/jpeg'])
on conflict (id) do nothing;

create policy evidence_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'company-evidence'
    and private.is_company_member(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid end, array['owner']::public.company_role[]));
create policy evidence_object_read on storage.objects for select to authenticated
  using (bucket_id = 'company-evidence'
    and (private.is_company_member(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid end, array['owner']::public.company_role[])
         or private.is_admin(array['admin','moderator'])));

------------------------------------------------------------------------------
-- 9. Transactional, audited functions (the only write path for sensitive state)
------------------------------------------------------------------------------

-- Consent: immutable record plus discovery sync in one transaction.
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
  end if;
end $$;

create or replace function private.latest_consent(p_user uuid, p_purpose text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select action = 'granted' from public.consent_records
                   where user_id = p_user and purpose = p_purpose order by created_at desc, id desc limit 1), false);
$$;

-- Employer onboarding: workspace starts as a draft; verification is submitted separately.
create or replace function public.create_employer_company(legal_name text, display_name text, city text default null, website text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); new_company uuid;
begin
  if not exists (select 1 from public.profiles where id = uid and account_kind = 'employer') then
    raise exception 'An active employer account is required' using errcode = '42501';
  end if;
  if char_length(trim(legal_name)) < 2 or char_length(trim(display_name)) < 2 then
    raise exception 'Company name is required' using errcode = '22023';
  end if;
  if website is not null and trim(website) <> '' and trim(website) !~* '^https?://[^\s]+$' then
    raise exception 'Website must start with http:// or https://' using errcode = '22023';
  end if;
  if exists (select 1 from public.company_members where user_id = uid and active) then
    raise exception 'This account already belongs to a company' using errcode = '23505';
  end if;
  insert into public.companies (legal_name, display_name, city, website, verification_status)
  values (trim(legal_name), trim(display_name), nullif(trim(city), ''), nullif(trim(website), ''), 'draft')
  returning id into new_company;
  insert into public.company_members (company_id, user_id, role) values (new_company, uid, 'owner');
  perform private.audit('company.created', 'company', new_company, new_company);
  return new_company;
end $$;

create or replace function public.submit_company_verification(p_company uuid, p_identifier_type text, p_identifier_value text, p_evidence_path text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); v text := upper(trim(p_identifier_value)); st public.verification_status;
begin
  if not private.is_company_member(p_company, array['owner']::public.company_role[]) then
    raise exception 'Only a company owner can submit verification' using errcode = '42501';
  end if;
  select verification_status into st from public.companies where id = p_company for update;
  if st not in ('draft','rejected') then
    raise exception 'Verification cannot be submitted while the company is %', st using errcode = '55000';
  end if;
  if p_identifier_type = 'gstin' and v !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'GSTIN format is invalid' using errcode = '22023';
  elsif p_identifier_type = 'cin' and v !~ '^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$' then
    raise exception 'CIN format is invalid' using errcode = '22023';
  elsif p_identifier_type = 'llpin' and v !~ '^[A-Z]{3}-[0-9]{4}$' then
    raise exception 'LLPIN format is invalid' using errcode = '22023';
  elsif p_identifier_type in ('domain','other') and char_length(v) < 4 then
    raise exception 'Identifier is too short' using errcode = '22023';
  elsif p_identifier_type not in ('gstin','cin','llpin','domain','other') then
    raise exception 'Unknown identifier type' using errcode = '22023';
  end if;
  if p_evidence_path is not null and split_part(p_evidence_path, '/', 1) <> p_company::text then
    raise exception 'Evidence must be stored in your company folder' using errcode = '42501';
  end if;
  insert into private.company_verifications (company_id, identifier_type, identifier_value, evidence_path, decision)
  values (p_company, p_identifier_type, v, p_evidence_path, 'pending');
  update public.companies set verification_status = 'pending', verification_reason = null, updated_at = now() where id = p_company;
  perform private.audit('company.verification_submitted', 'company', p_company, p_company, jsonb_build_object('identifier_type', p_identifier_type));
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
      update public.jobs set status = 'paused', updated_at = now() where id = r.id;
      insert into public.job_events (job_id, from_status, to_status, actor_id, reason) values (r.id, r.status, 'paused', uid, 'Company suspended');
    end loop;
  end if;
  perform private.notify_company(p_company, array['owner','recruiter']::public.company_role[], 'company.' || p_decision,
    'Company verification update', 'Your company verification status changed. Open KaamSetu to read the details.');
  perform private.audit('company.' || p_decision, 'company', p_company, p_company, jsonb_build_object('from', st, 'to', new_st, 'reason', v_reason));
end $$;

-- Jobs
create or replace function private.set_job_status(p_job uuid, p_to public.job_status, p_reason text, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare cur public.job_status;
begin
  select status into cur from public.jobs where id = p_job for update;
  update public.jobs set status = p_to, updated_at = now(),
    published_at = case when p_to = 'published' and published_at is null then now() else published_at end
   where id = p_job;
  insert into public.job_events (job_id, from_status, to_status, actor_id, reason) values (p_job, cur, p_to, p_actor, p_reason);
end $$;

create or replace function public.submit_job_for_review(p_job uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); j public.jobs%rowtype;
begin
  select * into j from public.jobs where id = p_job for update;
  if j.id is null or not private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[]) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if not private.company_is_approved(j.company_id) then
    raise exception 'Only verified companies can submit jobs for review' using errcode = '55000';
  end if;
  if j.status not in ('draft','rejected') then raise exception 'Only draft or rejected jobs can be submitted' using errcode = '55000'; end if;
  if char_length(j.description) < 50 then raise exception 'Description must be at least 50 characters' using errcode = '22023'; end if;
  if j.salary_max <= 0 then raise exception 'Salary range is required' using errcode = '22023'; end if;
  if j.work_mode <> 'remote' and j.location_id is null then raise exception 'Location is required for onsite and hybrid jobs' using errcode = '22023'; end if;
  if not exists (select 1 from public.job_skills where job_id = p_job) then raise exception 'Add at least one skill' using errcode = '22023'; end if;
  perform private.set_job_status(p_job, 'pending_review', null, uid);
  perform private.audit('job.submitted', 'job', p_job, j.company_id);
end $$;

create or replace function public.set_job_status(p_job uuid, p_to public.job_status, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); j public.jobs%rowtype;
begin
  select * into j from public.jobs where id = p_job for update;
  if j.id is null or not private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[]) then
    raise exception 'Job not found' using errcode = 'P0002';
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

create or replace function public.duplicate_job(p_job uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); j public.jobs%rowtype; new_id uuid;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[]) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  insert into public.jobs (company_id, title, category_id, description, salary_min, salary_max, salary_period,
    experience_min_months, experience_max_months, location_id, work_mode, employment_type, vacancies, created_by)
  values (j.company_id, left(j.title || ' (copy)', 120), j.category_id, j.description, j.salary_min, j.salary_max, j.salary_period,
    j.experience_min_months, j.experience_max_months, j.location_id, j.work_mode, j.employment_type, j.vacancies, uid)
  returning id into new_id;
  insert into public.job_skills (job_id, skill_id, required, weight) select new_id, skill_id, required, weight from public.job_skills where job_id = p_job;
  insert into public.job_events (job_id, from_status, to_status, actor_id, reason) values (new_id, null, 'draft', uid, 'Duplicated from another job');
  perform private.audit('job.duplicated', 'job', new_id, j.company_id, jsonb_build_object('source', p_job));
  return new_id;
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
    else null end;
  if new_st is null then raise exception 'Decision "%" is not allowed for a % job', p_decision, j.status using errcode = '55000'; end if;
  if new_st = 'published' and not private.company_is_approved(j.company_id) then
    raise exception 'Company is not verified' using errcode = '55000';
  end if;
  perform private.set_job_status(p_job, new_st, v_reason, uid);
  perform private.notify_company(j.company_id, array['owner','recruiter']::public.company_role[], 'job.' || p_decision,
    'Job review update', 'A job review decision is available in KaamSetu.');
  perform private.audit('job.' || p_decision, 'job', p_job, j.company_id, jsonb_build_object('reason', v_reason));
end $$;

-- Applications
create or replace function private.stage_allowed(p_from public.application_stage, p_to public.application_stage)
returns boolean language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (
    ('applied','viewed'), ('applied','shortlisted'), ('applied','rejected'),
    ('viewed','shortlisted'), ('viewed','rejected'),
    ('shortlisted','interview'), ('shortlisted','rejected'),
    ('interview','offer'), ('interview','rejected'),
    ('offer','hired'), ('offer','rejected'));
$$;

create or replace function private.create_application(p_job uuid, p_candidate uuid, p_source text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare app_id uuid; snap jsonb; comp uuid;
begin
  snap := private.match_score(p_candidate, p_job);
  insert into public.applications (job_id, candidate_id, source, note, match_snapshot)
  values (p_job, p_candidate, p_source, p_note, snap)
  on conflict (job_id, candidate_id) do nothing returning id into app_id;
  if app_id is null then raise exception 'You have already applied to this job' using errcode = '23505'; end if;
  insert into public.application_events (application_id, from_stage, to_stage, actor_id, reason)
  values (app_id, null, 'applied', p_candidate, null);
  select company_id into comp from public.jobs where id = p_job;
  perform private.notify_company(comp, array['owner','recruiter']::public.company_role[], 'application.received',
    'New application received', 'A candidate applied to one of your jobs.');
  return app_id;
end $$;

create or replace function public.apply_to_job(p_job uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); app_id uuid;
begin
  if not exists (select 1 from public.profiles where id = uid and account_kind = 'candidate') then
    raise exception 'Only candidate accounts can apply' using errcode = '42501';
  end if;
  if not private.job_is_public(p_job) then raise exception 'This job is not open for applications' using errcode = '55000'; end if;
  if p_note is not null and char_length(p_note) > 1000 then raise exception 'Note is too long' using errcode = '22023'; end if;
  app_id := private.create_application(p_job, uid, 'candidate', nullif(trim(p_note), ''));
  return app_id;
end $$;

create or replace function public.withdraw_application(p_application uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); a public.applications%rowtype;
begin
  select * into a from public.applications where id = p_application and candidate_id = uid for update;
  if a.id is null then raise exception 'Application not found' using errcode = 'P0002'; end if;
  if a.stage in ('hired','rejected','withdrawn') then raise exception 'This application is already closed' using errcode = '55000'; end if;
  update public.applications set stage = 'withdrawn', updated_at = now() where id = a.id;
  update public.interviews set status = 'cancelled', updated_at = now() where application_id = a.id and status in ('proposed','confirmed','reschedule_requested');
  insert into public.application_events (application_id, from_stage, to_stage, actor_id) values (a.id, a.stage, 'withdrawn', uid);
end $$;

create or replace function public.transition_application(p_application uuid, p_to public.application_stage, p_reason text default null, p_details text default null)
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
  if p_to = 'rejected' then v_reason := private.require_reason(p_reason, 3); else v_reason := left(p_reason, 1000); end if;
  update public.applications set stage = p_to, updated_at = now() where id = a.id;
  insert into public.application_events (application_id, from_stage, to_stage, actor_id, reason, details)
  values (a.id, a.stage, p_to, uid, v_reason, left(p_details, 2000));
  if p_to = 'rejected' then
    update public.interviews set status = 'cancelled', updated_at = now() where application_id = a.id and status in ('proposed','confirmed','reschedule_requested');
  end if;
  title := case p_to when 'viewed' then 'Your application was viewed' when 'shortlisted' then 'You were shortlisted'
    when 'interview' then 'Interview update' when 'offer' then 'You have an offer' when 'hired' then 'Hiring update'
    else 'Application update' end;
  perform private.notify(a.candidate_id, 'application.' || p_to, title, 'Open KaamSetu to see the details.');
  perform private.audit('application.' || p_to, 'application', a.id, comp);
end $$;

-- Interviews
create or replace function public.propose_interview(p_application uuid, p_at timestamptz, p_mode text, p_details text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); a public.applications%rowtype; comp uuid; iv uuid; had_open boolean;
begin
  select a2.* into a from public.applications a2 where a2.id = p_application for update;
  select company_id into comp from public.jobs where id = a.job_id;
  if a.id is null or comp is null or not private.is_company_member(comp, array['owner','recruiter']::public.company_role[]) then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if not private.company_is_approved(comp) then raise exception 'Company is not verified' using errcode = '55000'; end if;
  if a.stage not in ('shortlisted','interview') then raise exception 'Shortlist the candidate before proposing an interview' using errcode = '55000'; end if;
  if p_at <= now() then raise exception 'Interview time must be in the future' using errcode = '22023'; end if;
  if p_mode not in ('phone','video','onsite') then raise exception 'Invalid interview mode' using errcode = '22023'; end if;
  had_open := exists (select 1 from public.interviews where application_id = a.id and status in ('proposed','confirmed','reschedule_requested'));
  update public.interviews set status = 'cancelled', updated_at = now() where application_id = a.id and status in ('proposed','confirmed','reschedule_requested');
  insert into public.interviews (application_id, proposed_at, mode, meeting_details, created_by)
  values (a.id, p_at, p_mode, left(p_details, 1000), uid) returning id into iv;
  if a.stage = 'shortlisted' then
    update public.applications set stage = 'interview', updated_at = now() where id = a.id;
    insert into public.application_events (application_id, from_stage, to_stage, actor_id) values (a.id, 'shortlisted', 'interview', uid);
  end if;
  perform private.notify(a.candidate_id, case when had_open then 'interview.changed' else 'interview.proposed' end,
    case when had_open then 'Interview changed' else 'Interview proposed' end, 'Open KaamSetu to confirm or request a new time.');
  perform private.audit('interview.proposed', 'interview', iv, comp);
  return iv;
end $$;

create or replace function public.cancel_interview(p_interview uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); iv public.interviews%rowtype; a public.applications%rowtype; comp uuid;
begin
  select * into iv from public.interviews where id = p_interview for update;
  select * into a from public.applications where id = iv.application_id;
  select company_id into comp from public.jobs where id = a.job_id;
  if iv.id is null or comp is null or not private.is_company_member(comp, array['owner','recruiter']::public.company_role[]) then
    raise exception 'Interview not found' using errcode = 'P0002';
  end if;
  if iv.status not in ('proposed','confirmed','reschedule_requested') then raise exception 'Interview is already closed' using errcode = '55000'; end if;
  update public.interviews set status = 'cancelled', response_note = left(p_reason, 500), updated_at = now() where id = iv.id;
  perform private.notify(a.candidate_id, 'interview.cancelled', 'Interview cancelled', 'Open KaamSetu for details.');
  perform private.audit('interview.cancelled', 'interview', iv.id, comp);
end $$;

create or replace function public.respond_to_interview(p_interview uuid, p_action text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); iv public.interviews%rowtype; a public.applications%rowtype; comp uuid; new_status text;
begin
  select i.* into iv from public.interviews i join public.applications ap on ap.id = i.application_id
   where i.id = p_interview and ap.candidate_id = uid for update of i;
  if iv.id is null then raise exception 'Interview not found' using errcode = 'P0002'; end if;
  select * into a from public.applications where id = iv.application_id;
  select company_id into comp from public.jobs where id = a.job_id;
  new_status := case
    when p_action = 'confirm' and iv.status = 'proposed' then 'confirmed'
    when p_action = 'decline' and iv.status in ('proposed','confirmed') then 'cancelled'
    when p_action = 'reschedule' and iv.status in ('proposed','confirmed') then 'reschedule_requested'
    else null end;
  if new_status is null then raise exception 'This interview cannot be %', p_action using errcode = '55000'; end if;
  update public.interviews set status = new_status, response_note = left(p_note, 500), updated_at = now(),
    confirmed_at = case when new_status = 'confirmed' then now() else confirmed_at end where id = iv.id;
  perform private.notify_company(comp, array['owner','recruiter']::public.company_role[], 'interview.' || new_status,
    'Interview response received', 'A candidate responded to an interview.');
  perform private.audit('interview.' || new_status, 'interview', iv.id, comp);
end $$;

-- Invitations and discovery
create or replace function public.invite_candidate(p_job uuid, p_candidate uuid, p_message text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); j public.jobs%rowtype; inv uuid;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or not private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[]) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if not private.job_is_public(p_job) then raise exception 'Only published jobs of verified companies can invite candidates' using errcode = '55000'; end if;
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

create or replace function public.respond_to_invitation(p_invitation uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); inv public.job_invitations%rowtype; comp uuid;
begin
  select * into inv from public.job_invitations where id = p_invitation and candidate_id = uid for update;
  if inv.id is null then raise exception 'Invitation not found' using errcode = 'P0002'; end if;
  if inv.status <> 'pending' then raise exception 'Invitation is already %', inv.status using errcode = '55000'; end if;
  if inv.expires_at <= now() then
    update public.job_invitations set status = 'expired', updated_at = now() where id = inv.id;
    raise exception 'Invitation has expired' using errcode = '55000';
  end if;
  select company_id into comp from public.jobs where id = inv.job_id;
  if p_accept then
    if not private.job_is_public(inv.job_id) then raise exception 'This job is no longer open' using errcode = '55000'; end if;
    perform private.create_application(inv.job_id, uid, 'accepted_invitation', null);
  end if;
  update public.job_invitations set status = case when p_accept then 'accepted' else 'declined' end::public.invitation_status, updated_at = now() where id = inv.id;
  perform private.notify_company(comp, array['owner','recruiter']::public.company_role[],
    case when p_accept then 'invitation.accepted' else 'invitation.declined' end, 'Invitation response received', 'A candidate responded to your invitation.');
  perform private.audit(case when p_accept then 'invitation.accepted' else 'invitation.declined' end, 'invitation', inv.id, comp);
end $$;

create or replace function public.expire_stale_invitations()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  update public.job_invitations set status = 'expired', updated_at = now() where status = 'pending' and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.search_candidates(
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
  perform private.audit('candidate.search', 'job', p_job, j.company_id,
    jsonb_build_object('skill', p_skill, 'city', p_city, 'min_months', p_min_months, 'max_months', p_max_months));
  return query
  select * from (
    select cp.user_id, cp.headline, l.city, l.locality, cp.experience_months, cp.salary_min, cp.salary_period, cp.notice_days,
      coalesce((select array_agg(s.name order by s.name) from public.candidate_skills cs join public.skills s on s.id = cs.skill_id
                where cs.candidate_id = cp.user_id and cs.confirmed), '{}'::text[]) as skill_names,
      (private.match_score(cp.user_id, p_job)->>'score')::numeric as sc,
      private.match_score(cp.user_id, p_job) as m
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
            where cs.candidate_id = cp.user_id and cs.confirmed and s.name ilike p_skill))
  ) q
  where (q.m->>'eligible')::boolean
  order by q.sc desc, q.user_id
  limit lim;
end $$;

create or replace function public.list_job_applicants(p_job uuid)
returns table (application_id uuid, candidate_id uuid, display_name text, headline text, experience_months integer,
               stage public.application_stage, applied_at timestamptz, note text, score numeric, match jsonb)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); comp uuid;
begin
  select company_id into comp from public.jobs where id = p_job;
  if comp is null or not private.is_company_member(comp) then raise exception 'Job not found' using errcode = 'P0002'; end if;
  return query
  select a.id, a.candidate_id, p.display_name, cp.headline, cp.experience_months, a.stage, a.applied_at, a.note,
         (a.match_snapshot->>'score')::numeric, a.match_snapshot
  from public.applications a
  join public.profiles p on p.id = a.candidate_id
  join public.candidate_profiles cp on cp.user_id = a.candidate_id
  where a.job_id = p_job and a.stage <> 'withdrawn'
  order by (a.match_snapshot->>'score')::numeric desc nulls last, a.applied_at;
end $$;

-- Contact details are released only after shortlisting AND current contact-sharing consent.
create or replace function public.get_applicant_contact(p_application uuid)
returns table (email text, phone text) language plpgsql security definer set search_path = '' as $$
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
  return query select p.email, p.phone from public.profiles p where p.id = a.candidate_id;
end $$;

-- Matching access
create or replace function public.my_job_match(p_job uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not private.job_is_public(p_job) then return null; end if;
  return private.match_score(uid, p_job);
end $$;

create or replace function public.my_job_matches()
returns table (job_id uuid, score numeric, eligible boolean, match jsonb)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not exists (select 1 from public.candidate_profiles where user_id = uid) then return; end if;
  return query
  select j.id, (m.v->>'score')::numeric, (m.v->>'eligible')::boolean, m.v
  from public.jobs j cross join lateral (select private.match_score(uid, j.id) as v) m
  where private.job_is_public(j.id)
  order by (m.v->>'eligible')::boolean desc, (m.v->>'score')::numeric desc, j.published_at desc;
end $$;

create or replace function public.admin_set_matching_weights(p_weights jsonb, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin']); v_reason text := private.require_reason(p_reason, 10); v integer;
begin
  select coalesce(max(version), 0) + 1 into v from public.matching_versions;
  update public.matching_versions set active = false where active;
  insert into public.matching_versions (version, weights, active, reason, created_by) values (v, p_weights, true, v_reason, uid);
  perform private.audit('matching.weights_changed', 'matching_version', null, null, jsonb_build_object('version', v, 'weights', p_weights, 'reason', v_reason));
  return v;
end $$;

-- Resumes
create or replace function public.register_resume(p_path text, p_name text, p_mime text, p_size integer, p_sha256 text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); rid uuid; actual bigint; obj record;
begin
  if not exists (select 1 from public.candidate_profiles where user_id = uid) then raise exception 'Candidate profile required' using errcode = '42501'; end if;
  if split_part(p_path, '/', 1) <> uid::text or p_path !~* '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}\.(pdf|docx)$' then
    raise exception 'Invalid resume path' using errcode = '42501';
  end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid checksum' using errcode = '22023'; end if;
  select * into obj from storage.objects where bucket_id = 'resumes' and name = p_path;
  if obj.id is null then raise exception 'Upload the file before registering it' using errcode = '55000'; end if;
  actual := nullif(obj.metadata ->> 'size', '')::bigint;
  if actual is not null and actual <> p_size then raise exception 'File size does not match the upload' using errcode = '22023'; end if;
  if exists (select 1 from public.resumes where candidate_id = uid and sha256 = p_sha256 and deleted_at is null) then
    raise exception 'This file is already on your profile' using errcode = '23505';
  end if;
  update public.resumes set active = false where candidate_id = uid and active;
  insert into public.resumes (candidate_id, storage_path, original_name, mime_type, byte_size, sha256, active)
  values (uid, p_path, left(p_name, 200), p_mime, p_size, p_sha256, true) returning id into rid;
  perform private.audit('resume.uploaded', 'resume', rid);
  return rid;
end $$;

create or replace function public.delete_resume(p_resume uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); path text;
begin
  update public.resumes set deleted_at = now(), active = false
   where id = p_resume and candidate_id = uid and deleted_at is null returning storage_path into path;
  if path is null then raise exception 'Resume not found' using errcode = 'P0002'; end if;
  perform private.audit('resume.deleted', 'resume', p_resume);
  return path; -- the client then removes the object from the private bucket
end $$;

-- Team and account administration
create or replace function public.set_member_role(p_company uuid, p_user uuid, p_role public.company_role)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not private.is_company_member(p_company, array['owner']::public.company_role[]) then raise exception 'Only owners can change roles' using errcode = '42501'; end if;
  update public.company_members set role = p_role where company_id = p_company and user_id = p_user and active;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  perform private.audit('member.role_changed', 'company_member', p_user, p_company, jsonb_build_object('role', p_role));
end $$;

create or replace function public.deactivate_member(p_company uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not private.is_company_member(p_company, array['owner']::public.company_role[]) then raise exception 'Only owners can remove members' using errcode = '42501'; end if;
  update public.company_members set active = false where company_id = p_company and user_id = p_user and active;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  perform private.audit('member.deactivated', 'company_member', p_user, p_company);
end $$;

create or replace function public.admin_grant_role(p_user uuid, p_role text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin']); v_reason text := private.require_reason(p_reason);
begin
  if p_role not in ('admin','moderator','support','privacy') then raise exception 'Unknown role' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_user and status = 'active') then raise exception 'User not found' using errcode = 'P0002'; end if;
  insert into private.app_roles (user_id, role, granted_by) values (p_user, p_role, uid) on conflict do nothing;
  perform private.audit('admin.role_granted', 'user', p_user, null, jsonb_build_object('role', p_role, 'reason', v_reason));
end $$;

create or replace function public.admin_revoke_role(p_user uuid, p_role text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin']); v_reason text := private.require_reason(p_reason);
begin
  if p_role = 'admin' and not exists (select 1 from private.app_roles where role = 'admin' and user_id <> p_user) then
    raise exception 'The last administrator cannot be removed' using errcode = '23514';
  end if;
  delete from private.app_roles where user_id = p_user and role = p_role;
  perform private.audit('admin.role_revoked', 'user', p_user, null, jsonb_build_object('role', p_role, 'reason', v_reason));
end $$;

create or replace function public.admin_set_account_status(p_user uuid, p_status public.account_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','support']); v_reason text := private.require_reason(p_reason);
begin
  if p_status = 'deleted' then raise exception 'Use the privacy deletion workflow' using errcode = '22023'; end if;
  if p_user = uid then raise exception 'You cannot change your own status' using errcode = '22023'; end if;
  if exists (select 1 from private.app_roles where user_id = p_user and role = 'admin') and not private.is_admin(array['admin']) then
    raise exception 'Only administrators can change an administrator account' using errcode = '42501';
  end if;
  update public.profiles set status = p_status, updated_at = now() where id = p_user;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  perform private.audit('account.' || p_status, 'user', p_user, null, jsonb_build_object('reason', v_reason));
end $$;

create or replace function public.mark_notifications_read()
returns void language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now() where recipient_id = (select auth.uid()) and read_at is null;
$$;

------------------------------------------------------------------------------
-- 10. Function privileges: callable only by signed-in users; internals hidden.
------------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;
grant execute on function private.is_company_member(uuid, public.company_role[]) to authenticated;
grant execute on function private.is_admin(text[]) to authenticated;
grant execute on function private.company_is_approved(uuid) to authenticated, anon;
grant execute on function private.job_is_public(uuid) to authenticated, anon;
grant execute on function private.job_is_editable(uuid) to authenticated;
-- anon RLS evaluation needs schema usage for the helpers above.
grant usage on schema private to anon;
-- expire_stale_invitations is for the trusted scheduler (service role) only.
revoke execute on function public.expire_stale_invitations() from authenticated;
