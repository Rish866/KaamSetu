-- KaamSetu product features (WP2-WP6 data layer).
-- Candidate profile sections, saved jobs, job feed, privacy requests, abuse reports,
-- team invitations, notification delivery outbox, retention, admin queues.

------------------------------------------------------------------------------
-- 1. Candidate profile sections
------------------------------------------------------------------------------
alter table public.candidate_profiles
  add column if not exists employment_status text check (employment_status in ('employed','unemployed','student','freelancing','notice_period')),
  add column if not exists photo_path text,
  add constraint candidate_photo_owner check (photo_path is null or photo_path like user_id::text || '/%');

create table public.candidate_education (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(user_id) on delete cascade,
  institution text not null check (char_length(institution) between 2 and 150),
  qualification text not null check (char_length(qualification) between 2 and 150),
  field_of_study text check (char_length(field_of_study) <= 150),
  start_year smallint check (start_year between 1960 and 2100),
  end_year smallint check (end_year between 1960 and 2100),
  check (end_year is null or start_year is null or end_year >= start_year),
  created_at timestamptz not null default now()
);
create table public.candidate_experience (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(user_id) on delete cascade,
  company_name text not null check (char_length(company_name) between 2 and 150),
  title text not null check (char_length(title) between 2 and 150),
  start_date date not null,
  end_date date,
  description text check (char_length(description) <= 2000),
  check (end_date is null or end_date >= start_date),
  created_at timestamptz not null default now()
);
create table public.candidate_certifications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(user_id) on delete cascade,
  name text not null check (char_length(name) between 2 and 150),
  issuer text check (char_length(issuer) <= 150),
  year smallint check (year between 1960 and 2100),
  created_at timestamptz not null default now()
);
create table public.candidate_languages (
  candidate_id uuid not null references public.candidate_profiles(user_id) on delete cascade,
  language text not null check (char_length(language) between 2 and 50),
  proficiency text not null check (proficiency in ('basic','conversational','fluent','native')),
  primary key (candidate_id, language)
);
create table public.saved_jobs (
  candidate_id uuid not null references public.candidate_profiles(user_id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (candidate_id, job_id)
);
create index candidate_education_idx on public.candidate_education (candidate_id);
create index candidate_experience_idx on public.candidate_experience (candidate_id);
create index candidate_certifications_idx on public.candidate_certifications (candidate_id);

create table public.resume_extractions (
  resume_id uuid primary key references public.resumes(id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles(user_id) on delete cascade,
  data jsonb not null,
  status text not null default 'pending_review' check (status in ('pending_review','accepted','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.candidate_education enable row level security;
alter table public.candidate_experience enable row level security;
alter table public.candidate_certifications enable row level security;
alter table public.candidate_languages enable row level security;
alter table public.saved_jobs enable row level security;
alter table public.resume_extractions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['candidate_education','candidate_experience','candidate_certifications','candidate_languages'] loop
    execute format('create policy %I on public.%I for all to authenticated using (candidate_id = (select auth.uid())) with check (candidate_id = (select auth.uid()))', t || '_own', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
create policy saved_jobs_own_read on public.saved_jobs for select to authenticated using (candidate_id = (select auth.uid()));
create policy extractions_own_read on public.resume_extractions for select to authenticated using (candidate_id = (select auth.uid()));
grant select on public.saved_jobs, public.resume_extractions to authenticated;
grant update (employment_status, photo_path) on public.candidate_profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
create policy photo_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and lower(name) ~ '\.(png|jpe?g|webp)$');
create policy photo_object_read on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy photo_object_delete on storage.objects for delete to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create or replace function public.my_profile_completion()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); cp public.candidate_profiles%rowtype; missing text[] := '{}'; total int := 8; pct int;
begin
  select * into cp from public.candidate_profiles where user_id = uid;
  if cp.user_id is null then return jsonb_build_object('percent', 0, 'missing', '[]'::jsonb); end if;
  if coalesce(cp.headline, '') = '' then missing := array_append(missing, 'headline'); end if;
  if cp.current_location_id is null then missing := array_append(missing, 'current location'); end if;
  if cp.salary_min is null then missing := array_append(missing, 'expected salary'); end if;
  if cp.employment_status is null then missing := array_append(missing, 'employment status'); end if;
  if (select count(*) from public.candidate_skills where candidate_id = uid and confirmed) < 3 then missing := array_append(missing, 'at least 3 skills'); end if;
  if not exists (select 1 from public.candidate_education where candidate_id = uid) then missing := array_append(missing, 'education'); end if;
  if cp.experience_months = 0 and not exists (select 1 from public.candidate_experience where candidate_id = uid) then missing := array_append(missing, 'work experience'); end if;
  if not exists (select 1 from public.resumes where candidate_id = uid and active and deleted_at is null) then missing := array_append(missing, 'resume'); end if;
  pct := round(100.0 * (total - cardinality(missing)) / total);
  update public.candidate_profiles set profile_complete = (cardinality(missing) = 0) where user_id = uid;
  return jsonb_build_object('percent', pct, 'missing', to_jsonb(missing));
end $$;

-- Resume extraction review: parsed values reach the profile only when the candidate accepts them.
create or replace function public.accept_resume_extraction(p_resume uuid, p_skills text[], p_headline text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); ex public.resume_extractions%rowtype; nm text; sid uuid;
begin
  if not private.latest_consent(uid, 'resume_parsing') then raise exception 'Resume parsing consent is required' using errcode = '42501'; end if;
  select * into ex from public.resume_extractions where resume_id = p_resume and candidate_id = uid and status = 'pending_review' for update;
  if ex.resume_id is null then raise exception 'Nothing to review' using errcode = 'P0002'; end if;
  foreach nm in array coalesce(p_skills, '{}') loop
    sid := null;
    select id into sid from public.skills where lower(name) = lower(nm) and active;
    if sid is not null then
      insert into public.candidate_skills (candidate_id, skill_id, confirmed) values (uid, sid, true)
      on conflict (candidate_id, skill_id) do update set confirmed = true;
    end if;
  end loop;
  if p_headline is not null and trim(p_headline) <> '' then
    update public.candidate_profiles set headline = left(trim(p_headline), 150), updated_at = now() where user_id = uid;
  end if;
  update public.resume_extractions set status = 'accepted', reviewed_at = now() where resume_id = p_resume;
  update public.resumes set parse_status = 'complete' where id = p_resume;
  perform private.audit('resume.extraction_accepted', 'resume', p_resume);
end $$;

create or replace function public.reject_resume_extraction(p_resume uuid)
returns void language sql security definer set search_path = '' as $$
  update public.resume_extractions set status = 'rejected', reviewed_at = now()
   where resume_id = p_resume and candidate_id = (select auth.uid()) and status = 'pending_review';
$$;

create or replace function public.toggle_saved_job(p_job uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if exists (select 1 from public.saved_jobs where candidate_id = uid and job_id = p_job) then
    delete from public.saved_jobs where candidate_id = uid and job_id = p_job; return false;
  end if;
  if not private.job_is_public(p_job) then raise exception 'This job is not available' using errcode = '55000'; end if;
  insert into public.saved_jobs (candidate_id, job_id) values (uid, p_job);
  return true;
end $$;

------------------------------------------------------------------------------
-- 2. Job feed, detail, candidate-side views
------------------------------------------------------------------------------
create or replace function public.job_feed(
  p_query text default null, p_city text default null, p_locality text default null,
  p_min_salary integer default null, p_max_exp_months integer default null, p_work_mode text default null,
  p_category uuid default null, p_employment_type text default null, p_sort text default 'match',
  p_saved_only boolean default false, p_limit integer default 30, p_offset integer default 0)
returns table (job_id uuid, title text, company_id uuid, company_name text, company_verified boolean, city text, locality text,
  work_mode text, employment_type text, salary_min integer, salary_max integer, salary_period text, annual_max numeric,
  experience_min_months integer, published_at timestamptz, skills text[], saved boolean, applied boolean,
  score numeric, eligible boolean, match jsonb)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); q text := nullif(trim(coalesce(p_query, '')), '');
begin
  return query
  select * from (
    select j.id as job_id, j.title as title, c.id as company_id, c.display_name as company_name,
      (c.verification_status = 'approved') as company_verified, l.city as city, l.locality as locality,
      j.work_mode as work_mode, j.employment_type as employment_type, j.salary_min as salary_min, j.salary_max as salary_max,
      j.salary_period as salary_period, private.annual_salary(j.salary_max, j.salary_period) as annual_max,
      j.experience_min_months as experience_min_months, j.published_at as published_at,
      coalesce((select array_agg(s.name order by s.name) from public.job_skills js join public.skills s on s.id = js.skill_id where js.job_id = j.id), '{}'::text[]) as skills,
      exists (select 1 from public.saved_jobs sj where sj.job_id = j.id and sj.candidate_id = uid) as saved,
      exists (select 1 from public.applications a where a.job_id = j.id and a.candidate_id = uid) as applied,
      (m.v->>'score')::numeric as score, (m.v->>'eligible')::boolean as eligible, m.v as match
    from public.jobs j
    join public.companies c on c.id = j.company_id
    left join public.locations l on l.id = j.location_id
    cross join lateral (select private.match_score(uid, j.id) as v) m
    where private.job_is_public(j.id)
      and (q is null or j.title ilike '%' || q || '%' or c.display_name ilike '%' || q || '%'
           or exists (select 1 from public.job_skills js join public.skills s on s.id = js.skill_id where js.job_id = j.id and s.name ilike '%' || q || '%'))
      and (p_city is null or l.city = p_city or j.work_mode = 'remote')
      and (p_locality is null or l.locality = p_locality)
      and (p_min_salary is null or private.annual_salary(j.salary_max, j.salary_period) >= p_min_salary)
      and (p_max_exp_months is null or j.experience_min_months <= p_max_exp_months)
      and (p_work_mode is null or j.work_mode = p_work_mode)
      and (p_category is null or j.category_id = p_category)
      and (p_employment_type is null or j.employment_type = p_employment_type)
  ) f
  where (not p_saved_only or f.saved)
  order by
    case when p_sort = 'match' then f.eligible::int end desc nulls last,
    case when p_sort = 'match' then f.score end desc nulls last,
    case when p_sort = 'salary' then f.annual_max end desc nulls last,
    f.published_at desc, f.job_id
  limit least(greatest(coalesce(p_limit, 30), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
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
    'salary_min', j.salary_min, 'salary_max', j.salary_max, 'salary_period', j.salary_period,
    'experience_min_months', j.experience_min_months, 'experience_max_months', j.experience_max_months,
    'vacancies', j.vacancies, 'published_at', j.published_at, 'closes_at', j.closes_at, 'status', j.status,
    'skills', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'required', js.required) order by s.name) from public.job_skills js join public.skills s on s.id = js.skill_id where js.job_id = j.id), '[]'::jsonb),
    'saved', exists (select 1 from public.saved_jobs sj where sj.job_id = j.id and sj.candidate_id = uid),
    'application_id', (select a.id from public.applications a where a.job_id = j.id and a.candidate_id = uid),
    'match', private.match_score(uid, j.id))
  into r from public.jobs j join public.companies c on c.id = j.company_id left join public.locations l on l.id = j.location_id where j.id = p_job;
  return r;
end $$;

create or replace function public.my_applications()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  return coalesce((select jsonb_agg(x order by x->>'updated_at' desc) from (
    select jsonb_build_object(
      'id', a.id, 'job_id', j.id, 'title', j.title, 'company', c.display_name, 'stage', a.stage, 'applied_at', a.applied_at,
      'updated_at', a.updated_at, 'score', a.match_snapshot->'score', 'source', a.source,
      'timeline', coalesce((select jsonb_agg(jsonb_build_object('stage', e.to_stage, 'at', e.created_at, 'reason', e.reason, 'details', e.details) order by e.created_at, e.id)
                            from public.application_events e where e.application_id = a.id), '[]'::jsonb),
      'interview', (select jsonb_build_object('id', i.id, 'proposed_at', i.proposed_at, 'mode', i.mode, 'details', i.meeting_details, 'status', i.status)
                    from public.interviews i where i.application_id = a.id and i.status <> 'cancelled' order by i.created_at desc limit 1)) as x
    from public.applications a join public.jobs j on j.id = a.job_id join public.companies c on c.id = j.company_id
    where a.candidate_id = uid) t), '[]'::jsonb);
end $$;

create or replace function public.my_invitations()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'job_id', j.id, 'title', j.title, 'company', c.display_name,
      'message', i.message, 'status', i.status, 'expires_at', i.expires_at, 'salary_min', j.salary_min, 'salary_max', j.salary_max,
      'salary_period', j.salary_period, 'created_at', i.created_at) order by i.created_at desc)
    from public.job_invitations i join public.jobs j on j.id = i.job_id join public.companies c on c.id = j.company_id
    where i.candidate_id = uid), '[]'::jsonb);
end $$;

create or replace function public.report_job(p_job uuid, p_category text, p_details text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); rid uuid; comp uuid;
begin
  select company_id into comp from public.jobs where id = p_job;
  if comp is null then raise exception 'Job not found' using errcode = 'P0002'; end if;
  insert into public.abuse_reports (reporter_id, job_id, company_id, category, details)
  values (uid, p_job, comp, p_category, left(nullif(trim(p_details), ''), 1000)) returning id into rid;
  return rid;
end $$;

------------------------------------------------------------------------------
-- 3. Abuse reports, privacy requests, retention
------------------------------------------------------------------------------
create table public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  category text not null check (category in ('fraud','fee_requested','misleading','discrimination','offensive','other')),
  details text,
  status text not null default 'open' check (status in ('open','reviewing','actioned','dismissed')),
  handled_by uuid references public.profiles(id),
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (reporter_id, job_id)
);
alter table public.abuse_reports enable row level security;
create policy abuse_reports_own on public.abuse_reports for select to authenticated using (reporter_id = (select auth.uid()));
grant select on public.abuse_reports to authenticated;

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('export','deletion')),
  status text not null default 'requested' check (status in ('requested','completed','rejected','cancelled')),
  note text,
  handled_by uuid references public.profiles(id),
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index privacy_one_open on public.privacy_requests (user_id, kind) where status = 'requested';
alter table public.privacy_requests enable row level security;
create policy privacy_requests_own on public.privacy_requests for select to authenticated using (user_id = (select auth.uid()));
grant select (id, user_id, kind, status, note, created_at, completed_at) on public.privacy_requests to authenticated;

create table public.retention_policies (
  key text primary key,
  days integer not null check (days > 0),
  description text not null
);
alter table public.retention_policies enable row level security;
create policy retention_read on public.retention_policies for select to authenticated using (private.is_admin(array['admin','privacy']));
grant select on public.retention_policies to authenticated;
insert into public.retention_policies values
  ('read_notifications', 180, 'Delete read in-app notifications after this many days'),
  ('email_outbox', 90, 'Delete delivered or failed email records after this many days'),
  ('stale_invitations', 365, 'Delete expired, declined or cancelled invitations after this many days'),
  ('deleted_account_requests', 1095, 'Keep completed privacy request records (without personal data) for this many days');

create or replace function public.request_data_export()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); out jsonb; rid uuid;
begin
  out := jsonb_build_object(
    'generated_at', now(),
    'account', (select to_jsonb(p) - 'status' from (select id, display_name, email, phone, account_kind, created_at from public.profiles where id = uid) p),
    'candidate_profile', (select to_jsonb(cp) - 'user_id' - 'photo_path' from public.candidate_profiles cp where user_id = uid),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('skill', s.name, 'confirmed', cs.confirmed, 'experience_months', cs.experience_months)) from public.candidate_skills cs join public.skills s on s.id = cs.skill_id where cs.candidate_id = uid), '[]'),
    'preferred_locations', coalesce((select jsonb_agg(jsonb_build_object('city', l.city, 'locality', l.locality, 'rank', cl.preference_rank)) from public.candidate_locations cl join public.locations l on l.id = cl.location_id where cl.candidate_id = uid), '[]'),
    'education', coalesce((select jsonb_agg(to_jsonb(e) - 'candidate_id' - 'id') from public.candidate_education e where candidate_id = uid), '[]'),
    'experience', coalesce((select jsonb_agg(to_jsonb(e) - 'candidate_id' - 'id') from public.candidate_experience e where candidate_id = uid), '[]'),
    'certifications', coalesce((select jsonb_agg(to_jsonb(e) - 'candidate_id' - 'id') from public.candidate_certifications e where candidate_id = uid), '[]'),
    'languages', coalesce((select jsonb_agg(to_jsonb(e) - 'candidate_id') from public.candidate_languages e where candidate_id = uid), '[]'),
    'resumes', coalesce((select jsonb_agg(jsonb_build_object('file_name', r.original_name, 'uploaded_at', r.created_at, 'size_bytes', r.byte_size, 'scan_status', r.scan_status, 'deleted_at', r.deleted_at)) from public.resumes r where candidate_id = uid), '[]'),
    'applications', coalesce((select jsonb_agg(jsonb_build_object('job', j.title, 'company', c.display_name, 'stage', a.stage, 'applied_at', a.applied_at, 'note', a.note,
        'history', (select coalesce(jsonb_agg(jsonb_build_object('stage', e.to_stage, 'at', e.created_at, 'reason', e.reason)), '[]') from public.application_events e where e.application_id = a.id)))
        from public.applications a join public.jobs j on j.id = a.job_id join public.companies c on c.id = j.company_id where a.candidate_id = uid), '[]'),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('job', j.title, 'company', c.display_name, 'status', i.status, 'sent_at', i.created_at)) from public.job_invitations i join public.jobs j on j.id = i.job_id join public.companies c on c.id = j.company_id where i.candidate_id = uid), '[]'),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('purpose', purpose, 'action', action, 'notice_version', notice_version, 'at', created_at) order by created_at) from public.consent_records where user_id = uid), '[]'),
    'contact_disclosures', coalesce((select jsonb_agg(jsonb_build_object('company', c.display_name, 'fields', d.fields, 'at', d.created_at)) from public.contact_disclosures d join public.companies c on c.id = d.company_id where d.candidate_id = uid), '[]'),
    'saved_jobs', coalesce((select jsonb_agg(j.title) from public.saved_jobs sj join public.jobs j on j.id = sj.job_id where sj.candidate_id = uid), '[]'),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'title', title, 'at', created_at)) from public.notifications where recipient_id = uid), '[]'));
  insert into public.privacy_requests (user_id, kind, status, completed_at, handled_by, note)
  values (uid, 'export', 'completed', now(), null, 'Generated automatically for the account holder') returning id into rid;
  perform private.audit('privacy.export_generated', 'privacy_request', rid);
  return out;
end $$;

create or replace function public.request_account_deletion()
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); rid uuid;
begin
  insert into public.privacy_requests (user_id, kind) values (uid, 'deletion')
  on conflict (user_id, kind) where status = 'requested' do nothing returning id into rid;
  if rid is null then select id into rid from public.privacy_requests where user_id = uid and kind = 'deletion' and status = 'requested'; end if;
  perform private.audit('privacy.deletion_requested', 'privacy_request', rid);
  return rid;
end $$;

create or replace function public.cancel_privacy_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  update public.privacy_requests set status = 'cancelled', completed_at = now() where id = p_request and user_id = uid and status = 'requested';
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  perform private.audit('privacy.request_cancelled', 'privacy_request', p_request);
end $$;

create or replace function public.admin_process_deletion(p_request uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','privacy']); v_reason text := private.require_reason(p_reason);
  pr public.privacy_requests%rowtype; paths text[];
begin
  select * into pr from public.privacy_requests where id = p_request and kind = 'deletion' and status = 'requested' for update;
  if pr.id is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if exists (select 1 from private.app_roles where user_id = pr.user_id) then
    raise exception 'Remove administrator roles before deleting this account' using errcode = '55000';
  end if;
  if exists (select 1 from public.company_members m where m.user_id = pr.user_id and m.active and m.role = 'owner'
             and not exists (select 1 from public.company_members o where o.company_id = m.company_id and o.active and o.role = 'owner' and o.user_id <> pr.user_id)) then
    raise exception 'The user is the only owner of a company. Transfer ownership first.' using errcode = '55000';
  end if;
  select coalesce(array_agg(storage_path), '{}') into paths from public.resumes where candidate_id = pr.user_id;
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
  update public.applications set stage = 'withdrawn', note = null, updated_at = now() where candidate_id = pr.user_id and stage not in ('hired','rejected','withdrawn');
  update public.applications set note = null where candidate_id = pr.user_id;
  update public.job_invitations set status = 'cancelled', message = null, updated_at = now() where candidate_id = pr.user_id and status = 'pending';
  update public.company_members set active = false where user_id = pr.user_id;
  update public.profiles set display_name = 'Deleted user', email = null, phone = null, email_verified_at = null,
    phone_verified_at = null, status = 'deleted', updated_at = now() where id = pr.user_id;
  update public.privacy_requests set status = 'completed', completed_at = now(), handled_by = uid, note = v_reason,
    result = jsonb_build_object('storage_paths_to_purge', to_jsonb(paths), 'auth_user_removal', 'pending_service_role') where id = p_request;
  perform private.audit('privacy.deletion_completed', 'user', pr.user_id, null, jsonb_build_object('request', p_request, 'reason', v_reason));
  return jsonb_build_object('storage_paths_to_purge', to_jsonb(paths));
end $$;

create or replace function public.admin_reject_privacy_request(p_request uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','privacy']); v_reason text := private.require_reason(p_reason);
begin
  update public.privacy_requests set status = 'rejected', handled_by = uid, note = v_reason, completed_at = now() where id = p_request and status = 'requested';
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  perform private.audit('privacy.request_rejected', 'privacy_request', p_request, null, jsonb_build_object('reason', v_reason));
end $$;

-- Retention: run daily by the scheduler (service role).
create or replace function public.run_retention_jobs()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d1 int; d2 int; d3 int; n1 int; n2 int; n3 int;
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  select days into d1 from public.retention_policies where key = 'read_notifications';
  select days into d2 from public.retention_policies where key = 'email_outbox';
  select days into d3 from public.retention_policies where key = 'stale_invitations';
  delete from public.notifications where read_at is not null and read_at < now() - make_interval(days => d1); get diagnostics n1 = row_count;
  delete from private.email_outbox where status in ('sent','failed','suppressed') and created_at < now() - make_interval(days => d2); get diagnostics n2 = row_count;
  delete from public.job_invitations where status in ('expired','declined','cancelled') and updated_at < now() - make_interval(days => d3); get diagnostics n3 = row_count;
  return jsonb_build_object('notifications', n1, 'email_outbox', n2, 'invitations', n3);
end $$;

------------------------------------------------------------------------------
-- 4. Notification delivery: preferences, outbox, security events
------------------------------------------------------------------------------
create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email_updates boolean not null default true,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
create policy notification_prefs_own on public.notification_preferences for select to authenticated using (user_id = (select auth.uid()));
grant select (user_id, email_updates, updated_at) on public.notification_preferences to authenticated;

create table private.email_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  subject text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','suppressed')),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_due_idx on private.email_outbox (next_attempt_at) where status = 'pending';

create or replace function public.set_notification_preferences(p_email_updates boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  insert into public.notification_preferences (user_id, email_updates) values (uid, p_email_updates)
  on conflict (user_id) do update set email_updates = excluded.email_updates, updated_at = now();
  perform private.audit('notification.preferences_changed', 'user', uid, null, jsonb_build_object('email_updates', p_email_updates));
end $$;

create or replace function public.unsubscribe_by_token(p_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.notification_preferences set email_updates = false, updated_at = now() where unsubscribe_token = p_token;
  return found;
end $$;

-- Replaces the WP1 notify(): in-app record plus a queued email for the same event.
-- Optional kinds respect the user's email preference; everything else is essential.
create or replace function private.notify(p_recipient uuid, p_kind text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare optional boolean := p_kind in ('application.viewed','application.received','invitation.accepted','invitation.declined','interview.confirmed','interview.reschedule_requested');
        wants boolean; has_email boolean;
begin
  insert into public.notifications (recipient_id, kind, title, body) values (p_recipient, p_kind, p_title, p_body);
  select email is not null into has_email from public.profiles where id = p_recipient and status = 'active';
  if coalesce(has_email, false) then
    select coalesce((select email_updates from public.notification_preferences where user_id = p_recipient), true) into wants;
    insert into private.email_outbox (recipient_id, kind, subject, status)
    values (p_recipient, p_kind, p_title, case when optional and not wants then 'suppressed' else 'pending' end);
  end if;
end $$;
revoke all on function private.notify(uuid, text, text, text) from public, anon, authenticated;

create or replace function private.on_profile_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.id, 'account.registered', 'Welcome to KaamSetu', 'Your account is ready. Open KaamSetu to complete your profile.');
  return new;
end $$;
create trigger profiles_welcome after insert on public.profiles for each row execute function private.on_profile_created();

create or replace function private.on_auth_security_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    perform private.notify(new.id, 'security.password_changed', 'Your password was changed', 'If this was not you, reset your password immediately and contact support.');
  end if;
  if new.email is distinct from old.email or new.phone is distinct from old.phone then
    perform private.notify(new.id, 'security.contact_changed', 'Your sign-in details were changed', 'If this was not you, contact support immediately.');
  end if;
  return new;
end $$;
create trigger auth_users_security_change after update of encrypted_password, email, phone on auth.users
  for each row execute function private.on_auth_security_change();

-- Worker interface for the trusted email sender (service role only).
create or replace function public.outbox_claim(p_limit integer default 20)
returns table (id uuid, recipient_email text, kind text, subject text, unsubscribe_token uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  return query
  with due as (
    select o.id from private.email_outbox o where o.status = 'pending' and o.next_attempt_at <= now()
    order by o.created_at limit least(p_limit, 100) for update skip locked)
  select o.id, p.email, o.kind, o.subject, coalesce(np.unsubscribe_token, '00000000-0000-0000-0000-000000000000'::uuid)
  from private.email_outbox o join due on due.id = o.id join public.profiles p on p.id = o.recipient_id
  left join public.notification_preferences np on np.user_id = o.recipient_id;
end $$;

create or replace function public.outbox_report(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_ok then
    update private.email_outbox set status = 'sent', sent_at = now(), attempts = attempts + 1 where id = p_id;
  else
    update private.email_outbox set attempts = attempts + 1, last_error = left(p_error, 300),
      status = case when attempts + 1 >= 5 then 'failed' else 'pending' end,
      next_attempt_at = now() + make_interval(mins => (power(2, attempts + 1))::int) where id = p_id;
  end if;
end $$;

------------------------------------------------------------------------------
-- 5. Employer: company profile, team, dashboard, lists
------------------------------------------------------------------------------
alter table public.companies
  add column if not exists industry text check (char_length(industry) <= 100),
  add column if not exists company_size text check (company_size in ('1-10','11-50','51-200','201-1000','1000+')),
  add column if not exists registered_address text check (char_length(registered_address) <= 500),
  add column if not exists operating_locations text[] not null default '{}',
  add constraint companies_description_len check (char_length(description) <= 3000);
grant update (industry, company_size, registered_address, operating_locations) on public.companies to authenticated;

create table public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.company_role not null check (role <> 'owner'),
  invited_by uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);
create unique index company_invitations_open on public.company_invitations (company_id, email) where status = 'pending';
alter table public.company_invitations enable row level security;
create policy company_invitations_owner_read on public.company_invitations for select to authenticated
  using (private.is_company_member(company_id, array['owner']::public.company_role[]));
grant select on public.company_invitations to authenticated;

create or replace function public.invite_company_member(p_company uuid, p_email text, p_role public.company_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); e text := lower(trim(p_email)); iid uuid;
begin
  if not private.is_company_member(p_company, array['owner']::public.company_role[]) then raise exception 'Only owners can invite members' using errcode = '42501'; end if;
  if p_role = 'owner' then raise exception 'Invite as recruiter or viewer, then change the role' using errcode = '22023'; end if;
  if exists (select 1 from public.company_members cm join public.profiles p on p.id = cm.user_id where cm.company_id = p_company and cm.active and p.email = e) then
    raise exception 'This person is already on your team' using errcode = '55000';
  end if;
  update public.company_invitations set status = 'expired' where company_id = p_company and status = 'pending' and expires_at <= now();
  insert into public.company_invitations (company_id, email, role, invited_by) values (p_company, e, p_role, uid) returning id into iid;
  perform private.audit('member.invited', 'company_invitation', iid, p_company, jsonb_build_object('role', p_role));
  return iid;
exception when unique_violation then
  raise exception 'An invitation to this email is already pending' using errcode = '23505';
end $$;

create or replace function public.revoke_company_invitation(p_invitation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); comp uuid;
begin
  select company_id into comp from public.company_invitations where id = p_invitation;
  if comp is null or not private.is_company_member(comp, array['owner']::public.company_role[]) then raise exception 'Invitation not found' using errcode = 'P0002'; end if;
  update public.company_invitations set status = 'revoked' where id = p_invitation and status = 'pending';
  perform private.audit('member.invitation_revoked', 'company_invitation', p_invitation, comp);
end $$;

-- Invitations are matched to the caller's VERIFIED email only.
create or replace function public.my_company_invitations()
returns table (id uuid, company_name text, role public.company_role, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  return query select i.id, c.display_name, i.role, i.expires_at
    from public.company_invitations i join public.companies c on c.id = i.company_id join public.profiles p on p.id = uid
    where i.status = 'pending' and i.expires_at > now() and p.email_verified_at is not null and p.email = i.email and p.account_kind = 'employer';
end $$;

create or replace function public.accept_company_invitation(p_invitation uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); inv public.company_invitations%rowtype; p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = uid;
  select * into inv from public.company_invitations where id = p_invitation and status = 'pending' for update;
  if inv.id is null or inv.expires_at <= now() or p.email_verified_at is null or p.email is distinct from inv.email or p.account_kind <> 'employer' then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.company_members where user_id = uid and active) then raise exception 'This account already belongs to a company' using errcode = '23505'; end if;
  insert into public.company_members (company_id, user_id, role) values (inv.company_id, uid, inv.role)
  on conflict (company_id, user_id) do update set active = true, role = excluded.role;
  update public.company_invitations set status = 'accepted' where id = inv.id;
  perform private.audit('member.joined', 'company_member', uid, inv.company_id, jsonb_build_object('role', inv.role));
  return inv.company_id;
end $$;

create or replace function public.company_team(p_company uuid)
returns table (user_id uuid, display_name text, email text, role public.company_role, active boolean, joined_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); owner_view boolean;
begin
  if not private.is_company_member(p_company) then raise exception 'Company not found' using errcode = 'P0002'; end if;
  owner_view := private.is_company_member(p_company, array['owner']::public.company_role[]);
  return query select cm.user_id, p.display_name, case when owner_view then p.email end, cm.role, cm.active, cm.joined_at
    from public.company_members cm join public.profiles p on p.id = cm.user_id where cm.company_id = p_company order by cm.active desc, cm.joined_at;
end $$;

create or replace function public.company_jobs(p_company uuid)
returns table (job_id uuid, title text, status public.job_status, work_mode text, city text, salary_min integer, salary_max integer,
  salary_period text, applicants integer, new_applicants integer, published_at timestamptz, created_at timestamptz, closes_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not private.is_company_member(p_company) then raise exception 'Company not found' using errcode = 'P0002'; end if;
  return query select j.id, j.title, j.status, j.work_mode, l.city, j.salary_min, j.salary_max, j.salary_period,
    (select count(*)::int from public.applications a where a.job_id = j.id and a.stage <> 'withdrawn'),
    (select count(*)::int from public.applications a where a.job_id = j.id and a.stage = 'applied'),
    j.published_at, j.created_at, j.closes_at
    from public.jobs j left join public.locations l on l.id = j.location_id where j.company_id = p_company order by j.created_at desc;
end $$;

create or replace function public.employer_dashboard(p_company uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not private.is_company_member(p_company) then raise exception 'Company not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'jobs', coalesce((select jsonb_object_agg(status::text, n) from (select status, count(*) n from public.jobs where company_id = p_company group by status) s), '{}'::jsonb),
    'pipeline', coalesce((select jsonb_object_agg(stage::text, n) from (select a.stage, count(*) n from public.applications a join public.jobs j on j.id = a.job_id where j.company_id = p_company group by a.stage) s), '{}'::jsonb),
    'upcoming_interviews', (select count(*) from public.interviews i join public.applications a on a.id = i.application_id join public.jobs j on j.id = a.job_id
                             where j.company_id = p_company and i.status in ('proposed','confirmed') and i.proposed_at > now()),
    'pending_invitations', (select count(*) from public.job_invitations i join public.jobs j on j.id = i.job_id where j.company_id = p_company and i.status = 'pending'));
end $$;

create or replace function public.company_interviews(p_company uuid)
returns table (interview_id uuid, application_id uuid, job_title text, candidate_name text, proposed_at timestamptz, mode text, meeting_details text, status text, response_note text)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not private.is_company_member(p_company) then raise exception 'Company not found' using errcode = 'P0002'; end if;
  return query select i.id, a.id, j.title, p.display_name, i.proposed_at, i.mode, i.meeting_details, i.status, i.response_note
    from public.interviews i join public.applications a on a.id = i.application_id join public.jobs j on j.id = a.job_id
    join public.profiles p on p.id = a.candidate_id where j.company_id = p_company and i.status <> 'cancelled' order by i.proposed_at desc;
end $$;

------------------------------------------------------------------------------
-- 6. Administrator operations
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
    'email_failures', (select count(*) from private.email_outbox where status = 'failed'),
    'candidates', (select count(*) from public.profiles where account_kind = 'candidate' and status = 'active'),
    'employers', (select count(*) from public.profiles where account_kind = 'employer' and status = 'active'),
    'published_jobs', (select count(*) from public.jobs where status = 'published'),
    'applications', (select count(*) from public.applications),
    'audit_events_24h', (select count(*) from private.audit_events where created_at > now() - interval '24 hours'),
    'roles', coalesce((select jsonb_agg(role) from private.app_roles where user_id = uid), '[]'::jsonb));
end $$;

create or replace function public.admin_company_queue(p_status public.verification_status default 'pending')
returns table (company_id uuid, legal_name text, display_name text, city text, website text, industry text, company_size text,
  registered_address text, status public.verification_status, identifier_type text, identifier_value text, evidence_path text,
  submitted_at timestamptz, owner_name text, owner_email text, reason text)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','moderator']);
begin
  return query select c.id, c.legal_name, c.display_name, c.city, c.website, c.industry, c.company_size, c.registered_address, c.verification_status,
    v.identifier_type, v.identifier_value, v.evidence_path, v.created_at, o.display_name, o.email, c.verification_reason
  from public.companies c
  left join lateral (select * from private.company_verifications cv where cv.company_id = c.id order by cv.created_at desc limit 1) v on true
  left join lateral (select p.display_name, p.email from public.company_members m join public.profiles p on p.id = m.user_id
                     where m.company_id = c.id and m.role = 'owner' and m.active order by m.joined_at limit 1) o on true
  where c.verification_status = p_status order by coalesce(v.created_at, c.created_at);
end $$;

create or replace function public.admin_job_queue(p_status public.job_status default 'pending_review')
returns table (job_id uuid, title text, description text, company_id uuid, company_name text, company_status public.verification_status,
  salary_min integer, salary_max integer, salary_period text, work_mode text, city text, skills text[], submitted_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','moderator']);
begin
  return query select j.id, j.title, j.description, c.id, c.display_name, c.verification_status, j.salary_min, j.salary_max, j.salary_period, j.work_mode, l.city,
    coalesce((select array_agg(s.name order by s.name) from public.job_skills js join public.skills s on s.id = js.skill_id where js.job_id = j.id), '{}'::text[]),
    (select max(e.created_at) from public.job_events e where e.job_id = j.id)
  from public.jobs j join public.companies c on c.id = j.company_id left join public.locations l on l.id = j.location_id
  where j.status = p_status order by 13;
end $$;

create or replace function public.admin_reports(p_status text default 'open')
returns table (report_id uuid, category text, details text, status text, job_id uuid, job_title text, company_id uuid, company_name text, created_at timestamptz, resolution text)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','moderator','support']);
begin
  return query select r.id, r.category, r.details, r.status, r.job_id, j.title, r.company_id, c.display_name, r.created_at, r.resolution
    from public.abuse_reports r left join public.jobs j on j.id = r.job_id left join public.companies c on c.id = r.company_id
    where r.status = p_status order by r.created_at;
end $$;

create or replace function public.admin_resolve_report(p_report uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','moderator']); v_reason text := private.require_reason(p_reason);
begin
  if p_status not in ('reviewing','actioned','dismissed') then raise exception 'Invalid status' using errcode = '22023'; end if;
  update public.abuse_reports set status = p_status, handled_by = uid, resolution = v_reason,
    resolved_at = case when p_status = 'reviewing' then null else now() end where id = p_report;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  perform private.audit('report.' || p_status, 'abuse_report', p_report, null, jsonb_build_object('reason', v_reason));
end $$;

create or replace function public.admin_find_user(p_query text)
returns table (user_id uuid, display_name text, email text, phone text, account_kind text, status public.account_status, created_at timestamptz, roles text[])
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','support','privacy']); q text := lower(trim(p_query));
begin
  if char_length(q) < 3 then raise exception 'Enter at least 3 characters' using errcode = '22023'; end if;
  perform private.audit('admin.user_lookup', 'user', null, null, jsonb_build_object('query_length', char_length(q)));
  return query select p.id, p.display_name, p.email, p.phone, p.account_kind, p.status, p.created_at,
      coalesce((select array_agg(r.role) from private.app_roles r where r.user_id = p.id), '{}'::text[])
    from public.profiles p where lower(p.email) like q || '%' or p.phone like q || '%' or lower(p.display_name) like '%' || q || '%' order by p.created_at desc limit 20;
end $$;

create or replace function public.admin_privacy_queue(p_status text default 'requested')
returns table (request_id uuid, user_id uuid, display_name text, kind text, status text, created_at timestamptz, note text)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','privacy']);
begin
  return query select r.id, r.user_id, p.display_name, r.kind, r.status, r.created_at, r.note
    from public.privacy_requests r join public.profiles p on p.id = r.user_id where r.status = p_status and (p_status <> 'requested' or r.kind = 'deletion') order by r.created_at;
end $$;

create or replace function public.admin_email_failures()
returns table (id uuid, kind text, subject text, attempts integer, last_error text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','support']);
begin
  return query select o.id, o.kind, o.subject, o.attempts, o.last_error, o.created_at from private.email_outbox o where o.status = 'failed' order by o.created_at desc limit 100;
end $$;

create or replace function public.admin_search_audit(p_action text default null, p_actor uuid default null, p_target_type text default null,
  p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 50)
returns table (id uuid, actor_id uuid, actor_name text, action text, target_type text, target_id uuid, company_id uuid, metadata jsonb, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','privacy']);
begin
  return query select a.id, a.actor_id, p.display_name, a.action, a.target_type, a.target_id, a.company_id, a.metadata, a.created_at
    from private.audit_events a left join public.profiles p on p.id = a.actor_id
    where (p_action is null or a.action like p_action || '%') and (p_actor is null or a.actor_id = p_actor)
      and (p_target_type is null or a.target_type = p_target_type) and (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at <= p_to)
    order by a.created_at desc, a.id limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

create or replace function public.admin_list_roles()
returns table (user_id uuid, display_name text, email text, role text, granted_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin']);
begin
  return query select r.user_id, p.display_name, p.email, r.role, r.granted_at from private.app_roles r join public.profiles p on p.id = r.user_id order by r.granted_at;
end $$;

create or replace function public.admin_matching_versions()
returns setof public.matching_versions language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin','moderator']);
begin return query select * from public.matching_versions order by version desc; end $$;

------------------------------------------------------------------------------
-- 7. Privileges for everything added here
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
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;
grant execute on function private.is_company_member(uuid, public.company_role[]) to authenticated;
grant execute on function private.is_admin(text[]) to authenticated;
grant execute on function private.company_is_approved(uuid) to authenticated, anon;
grant execute on function private.job_is_public(uuid) to authenticated, anon;
grant execute on function private.job_is_editable(uuid) to authenticated;
-- Service-role-only entry points.
revoke execute on function public.expire_stale_invitations() from authenticated;
revoke execute on function public.run_retention_jobs() from authenticated;
revoke execute on function public.outbox_claim(integer) from authenticated;
revoke execute on function public.outbox_report(uuid, boolean, text) from authenticated;
revoke execute on function public.unsubscribe_by_token(uuid) from authenticated;
revoke all on all tables in schema private from anon, authenticated;
