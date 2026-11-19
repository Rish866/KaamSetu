-- Read-only data checks BEFORE applying 202611200001..0004 to production. Each row is a blocker to fix first.
select 'resumes: more than one active resume per candidate' as blocker, count(*) as n
  from (select candidate_id from public.resumes where active group by 1 having count(*) > 1) x having count(*) > 0
union all
select 'resumes: duplicate sha256 per candidate', count(*) from (select candidate_id, sha256 from public.resumes group by 1, 2 having count(*) > 1) x having count(*) > 0
union all
select 'companies: description longer than 3000 chars', count(*) from public.companies where char_length(description) > 3000 having count(*) > 0
union all
select 'profiles: duplicate empty-string phone', count(*) from public.profiles where phone = '' having count(*) > 1;
-- Information only: current row counts, to compare after migration.
select 'profiles' t, count(*) from public.profiles union all select 'companies', count(*) from public.companies
union all select 'jobs', count(*) from public.jobs union all select 'applications', count(*) from public.applications
union all select 'resumes', count(*) from public.resumes union all select 'consent_records', count(*) from public.consent_records;
