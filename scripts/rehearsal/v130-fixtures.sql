-- Data shaped exactly like what the v1.3.0 app could create in production, written through the v1.3.0 privileges.
-- Used only on a throw-away local Supabase database by scripts/rehearse-upgrade.sh.
\set ON_ERROR_STOP on
insert into auth.users (id, email, phone, raw_user_meta_data, email_confirmed_at, encrypted_password) values
  ('11111111-1111-4111-8111-111111111111', 'legacy.candidate@example.test', '919800000001', '{"display_name":"Legacy Candidate","account_kind":"candidate","accepted_notice_version":"2026-11-19"}', now(), 'x'),
  ('22222222-2222-4222-8222-222222222222', 'legacy.employer@example.test', null, '{"display_name":"Legacy Employer","account_kind":"employer","accepted_notice_version":"2026-11-19"}', null, 'x');

-- v1.3.0 candidate screen upserted its own candidate profile and wrote consent rows directly.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false), set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
set role authenticated;
insert into public.candidate_profiles (user_id) values ('11111111-1111-4111-8111-111111111111') on conflict do nothing;
insert into public.consent_records (user_id, purpose, action, notice_version) values ('11111111-1111-4111-8111-111111111111', 'employer_discovery', 'granted', '2026-11-18');
update public.candidate_profiles set discovery_enabled = true where user_id = '11111111-1111-4111-8111-111111111111';
reset role;

-- v1.3.0 employer created a company (status pending, no verification record) and inserted a job straight into review.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false), set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
set role authenticated;
select public.create_employer_company('Legacy Pvt Ltd', 'Legacy', 'Pune', null);
insert into public.jobs (company_id, title, description, salary_min, salary_max, work_mode, employment_type, vacancies, status, created_by)
select company_id, 'Legacy job', 'Created by the v1.3.0 post-job screen', 400000, 600000, 'hybrid', 'full_time', 1, 'pending_review', user_id
from public.company_members where user_id = '22222222-2222-4222-8222-222222222222';
reset role;

select 'fixtures' as step, (select count(*) from public.profiles) as profiles, (select count(*) from public.companies) as companies,
       (select count(*) from public.jobs) as jobs, (select count(*) from public.consent_records) as consents;
