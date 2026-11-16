-- KaamSetu MVP foundation. Run through Supabase migrations, never by copying
-- individual statements into production.

create extension if not exists pgcrypto;
create schema if not exists private;

create type public.account_status as enum ('active', 'suspended', 'deleted');
create type public.company_role as enum ('owner', 'recruiter', 'viewer');
create type public.verification_status as enum ('draft', 'pending', 'approved', 'rejected', 'suspended');
create type public.job_status as enum ('draft', 'pending_review', 'published', 'paused', 'closed', 'rejected');
create type public.application_stage as enum ('applied', 'viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn');
create type public.invitation_status as enum ('pending', 'accepted', 'declined', 'expired', 'cancelled');
create type public.consent_action as enum ('granted', 'withdrawn');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 100),
  phone text,
  phone_verified_at timestamptz,
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.app_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'moderator', 'support', 'privacy')),
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  locality text,
  state text not null default 'Maharashtra',
  latitude numeric(9,6),
  longitude numeric(9,6),
  active boolean not null default true,
  unique (city, locality)
);

create table public.job_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);

create table public.candidate_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  headline text,
  experience_months integer not null default 0 check (experience_months between 0 and 720),
  current_location_id uuid references public.locations(id),
  salary_min integer check (salary_min >= 0),
  salary_period text not null default 'annual' check (salary_period in ('monthly', 'annual')),
  notice_days integer check (notice_days between 0 and 365),
  discovery_enabled boolean not null default false,
  profile_complete boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.candidate_skills (
  candidate_id uuid not null references public.candidate_profiles(user_id) on delete cascade,
  skill_id uuid not null references public.skills(id),
  experience_months integer check (experience_months between 0 and 720),
  confirmed boolean not null default false,
  primary key (candidate_id, skill_id)
);

create table public.candidate_locations (
  candidate_id uuid not null references public.candidate_profiles(user_id) on delete cascade,
  location_id uuid not null references public.locations(id),
  preference_rank smallint not null default 1 check (preference_rank between 1 and 10),
  primary key (candidate_id, location_id)
);

create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(user_id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  sha256 text not null,
  scan_status text not null default 'pending' check (scan_status in ('pending', 'clean', 'infected', 'failed')),
  parse_status text not null default 'pending' check (parse_status in ('pending', 'processing', 'complete', 'failed')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  display_name text not null,
  website text,
  description text,
  city text,
  verification_status public.verification_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.company_role not null default 'viewer',
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table private.company_verifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  identifier_type text not null check (identifier_type in ('cin', 'gstin', 'domain', 'other')),
  identifier_value text not null,
  evidence_path text,
  decision public.verification_status not null default 'pending',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  reason text,
  created_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 120),
  category_id uuid references public.job_categories(id),
  description text not null,
  salary_min integer not null check (salary_min >= 0),
  salary_max integer not null check (salary_max >= salary_min),
  salary_period text not null default 'annual' check (salary_period in ('monthly', 'annual')),
  experience_min_months integer not null default 0 check (experience_min_months between 0 and 720),
  experience_max_months integer check (experience_max_months >= experience_min_months),
  location_id uuid references public.locations(id),
  work_mode text not null check (work_mode in ('onsite', 'hybrid', 'remote')),
  employment_type text not null check (employment_type in ('full_time', 'part_time', 'contract', 'internship')),
  vacancies integer not null default 1 check (vacancies between 1 and 1000),
  status public.job_status not null default 'draft',
  closes_at timestamptz,
  published_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_skills (
  job_id uuid not null references public.jobs(id) on delete cascade,
  skill_id uuid not null references public.skills(id),
  required boolean not null default true,
  weight smallint not null default 1 check (weight between 1 and 10),
  primary key (job_id, skill_id)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles(user_id) on delete cascade,
  source text not null default 'candidate' check (source in ('candidate', 'accepted_invitation')),
  stage public.application_stage not null default 'applied',
  applied_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, candidate_id)
);

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  from_stage public.application_stage,
  to_stage public.application_stage not null,
  actor_id uuid not null references public.profiles(id),
  reason text,
  created_at timestamptz not null default now()
);

create table public.job_invitations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles(user_id) on delete cascade,
  sent_by uuid not null references public.profiles(id),
  message text,
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, candidate_id)
);

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  proposed_at timestamptz not null,
  confirmed_at timestamptz,
  mode text not null check (mode in ('phone', 'video', 'onsite')),
  meeting_details text,
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'reschedule_requested', 'completed', 'cancelled')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in ('account', 'resume_parsing', 'matching', 'employer_discovery', 'contact_sharing', 'essential_notifications', 'marketing', 'ai_coaching')),
  action public.consent_action not null,
  notice_version text not null,
  channel text not null default 'app',
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table private.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id uuid,
  company_id uuid references public.companies(id),
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index jobs_published_idx on public.jobs (published_at desc) where status = 'published';
create index jobs_company_idx on public.jobs (company_id, status);
create index applications_candidate_idx on public.applications (candidate_id, updated_at desc);
create index applications_job_idx on public.applications (job_id, updated_at desc);
create index invitations_candidate_idx on public.job_invitations (candidate_id, status);
create index consent_user_idx on public.consent_records (user_id, purpose, created_at desc);

create or replace function private.is_company_member(target_company uuid, allowed_roles public.company_role[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_members cm
    where cm.company_id = target_company and cm.user_id = (select auth.uid()) and cm.active
      and (allowed_roles is null or cm.role = any(allowed_roles))
  );
$$;

create or replace function private.is_admin(allowed_roles text[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.app_roles ar
    where ar.user_id = (select auth.uid()) and (allowed_roles is null or ar.role = any(allowed_roles))
  );
$$;

revoke all on function private.is_company_member(uuid, public.company_role[]) from public;
revoke all on function private.is_admin(text[]) from public;
grant execute on function private.is_company_member(uuid, public.company_role[]) to authenticated;
grant execute on function private.is_admin(text[]) to authenticated;

alter table public.profiles enable row level security;
alter table public.candidate_profiles enable row level security;
alter table public.candidate_skills enable row level security;
alter table public.candidate_locations enable row level security;
alter table public.resumes enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.jobs enable row level security;
alter table public.job_skills enable row level security;
alter table public.applications enable row level security;
alter table public.application_events enable row level security;
alter table public.job_invitations enable row level security;
alter table public.interviews enable row level security;
alter table public.consent_records enable row level security;
alter table public.notifications enable row level security;

create policy profiles_own on public.profiles for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy candidate_profile_own on public.candidate_profiles for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy candidate_skills_own on public.candidate_skills for all to authenticated using (candidate_id = (select auth.uid())) with check (candidate_id = (select auth.uid()));
create policy candidate_locations_own on public.candidate_locations for all to authenticated using (candidate_id = (select auth.uid())) with check (candidate_id = (select auth.uid()));
create policy resumes_own on public.resumes for all to authenticated using (candidate_id = (select auth.uid())) with check (candidate_id = (select auth.uid()));

create policy companies_public_read on public.companies for select to anon, authenticated using (verification_status = 'approved');
create policy companies_member_read on public.companies for select to authenticated using (private.is_company_member(id));
create policy companies_owner_update on public.companies for update to authenticated using (private.is_company_member(id, array['owner']::public.company_role[])) with check (private.is_company_member(id, array['owner']::public.company_role[]));
create policy company_members_self_read on public.company_members for select to authenticated using (user_id = (select auth.uid()) or private.is_company_member(company_id));
create policy company_members_owner_manage on public.company_members for all to authenticated using (private.is_company_member(company_id, array['owner']::public.company_role[])) with check (private.is_company_member(company_id, array['owner']::public.company_role[]));

create policy jobs_public_read on public.jobs for select to anon, authenticated using (status = 'published' and (closes_at is null or closes_at > now()));
create policy jobs_member_read on public.jobs for select to authenticated using (private.is_company_member(company_id));
create policy jobs_recruiter_insert on public.jobs for insert to authenticated with check (private.is_company_member(company_id, array['owner','recruiter']::public.company_role[]) and created_by = (select auth.uid()));
create policy jobs_recruiter_update on public.jobs for update to authenticated using (private.is_company_member(company_id, array['owner','recruiter']::public.company_role[])) with check (private.is_company_member(company_id, array['owner','recruiter']::public.company_role[]));
create policy job_skills_public_read on public.job_skills for select to anon, authenticated using (exists (select 1 from public.jobs j where j.id = job_id and j.status = 'published'));
create policy job_skills_company_manage on public.job_skills for all to authenticated using (exists (select 1 from public.jobs j where j.id = job_id and private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[]))) with check (exists (select 1 from public.jobs j where j.id = job_id and private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[])));

create policy applications_candidate_read on public.applications for select to authenticated using (candidate_id = (select auth.uid()));
create policy applications_candidate_insert on public.applications for insert to authenticated with check (candidate_id = (select auth.uid()) and stage = 'applied' and exists (select 1 from public.jobs j where j.id = job_id and j.status = 'published'));
create policy applications_company_read on public.applications for select to authenticated using (exists (select 1 from public.jobs j where j.id = job_id and private.is_company_member(j.company_id)));
create policy application_events_party_read on public.application_events for select to authenticated using (exists (select 1 from public.applications a join public.jobs j on j.id = a.job_id where a.id = application_id and (a.candidate_id = (select auth.uid()) or private.is_company_member(j.company_id))));

create policy invitations_candidate_read on public.job_invitations for select to authenticated using (candidate_id = (select auth.uid()));
create policy invitations_candidate_update on public.job_invitations for update to authenticated using (candidate_id = (select auth.uid())) with check (candidate_id = (select auth.uid()));
create policy invitations_company_read on public.job_invitations for select to authenticated using (exists (select 1 from public.jobs j where j.id = job_id and private.is_company_member(j.company_id)));
create policy invitations_company_insert on public.job_invitations for insert to authenticated with check (sent_by = (select auth.uid()) and exists (select 1 from public.jobs j where j.id = job_id and j.status = 'published' and private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[])) and exists (select 1 from public.candidate_profiles cp where cp.user_id = candidate_id and cp.discovery_enabled));

create policy interviews_party_read on public.interviews for select to authenticated using (exists (select 1 from public.applications a join public.jobs j on j.id = a.job_id where a.id = application_id and (a.candidate_id = (select auth.uid()) or private.is_company_member(j.company_id))));
create policy interviews_company_insert on public.interviews for insert to authenticated with check (created_by = (select auth.uid()) and exists (select 1 from public.applications a join public.jobs j on j.id = a.job_id where a.id = application_id and private.is_company_member(j.company_id, array['owner','recruiter']::public.company_role[])));
create policy consent_own_read on public.consent_records for select to authenticated using (user_id = (select auth.uid()));
create policy consent_own_insert on public.consent_records for insert to authenticated with check (user_id = (select auth.uid()));
create policy notifications_own_read on public.notifications for select to authenticated using (recipient_id = (select auth.uid()));
create policy notifications_own_update on public.notifications for update to authenticated using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));

-- Public taxonomy tables are read-only to clients.
alter table public.locations enable row level security;
alter table public.job_categories enable row level security;
alter table public.skills enable row level security;
create policy locations_read on public.locations for select to anon, authenticated using (active);
create policy categories_read on public.job_categories for select to anon, authenticated using (active);
create policy skills_read on public.skills for select to anon, authenticated using (active);

-- Private resume bucket. Object paths must start with the authenticated user ID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 5242880, array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy resume_object_insert on storage.objects for insert to authenticated
with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy resume_object_read on storage.objects for select to authenticated
using (bucket_id = 'resumes' and owner_id = (select auth.uid())::text);
create policy resume_object_delete on storage.objects for delete to authenticated
using (bucket_id = 'resumes' and owner_id = (select auth.uid())::text);
