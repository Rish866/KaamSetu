
------------------------------------------------------------------------------
-- 3. Link existing rows, then add state, district, city and PIN places
------------------------------------------------------------------------------
-- The original pilot catalogue exists in production; create it on fresh databases too, so every environment matches.
insert into public.locations (city, locality, state)
select m.city, m.locality, 'Maharashtra'
  from (values ('Mumbai', null::text), ('Mumbai', 'Andheri'), ('Mumbai', 'Powai'), ('Navi Mumbai', null), ('Navi Mumbai', 'Vashi'),
               ('Navi Mumbai', 'Airoli'), ('Thane', null), ('Pune', null), ('Pune', 'Hinjawadi'), ('Pune', 'Kharadi')) as m(city, locality)
 where not exists (select 1 from public.locations l where l.city = m.city and l.locality is not distinct from m.locality);

update public.locations l set state_code = s.code from public.states s where s.name = l.state;
do $$ begin
  if exists (select 1 from public.locations where state_code is null) then
    raise exception 'Existing locations with an unknown state: %',
      (select string_agg(distinct state, ', ') from public.locations where state_code is null);
  end if;
end $$;

-- The original pilot catalogue, linked to official districts and PIN codes.
update public.locations l
   set district_id = d.id, district = d.name, pincode = coalesce(l.pincode, m.pin),
       kind = case when l.locality is not null then 'locality' when l.city = d.name then 'district' else 'city' end
  from (values ('Mumbai', null, 'Mumbai', null), ('Mumbai', 'Andheri', 'Mumbai Suburban', null),
               ('Mumbai', 'Powai', 'Mumbai Suburban', '400076'), ('Navi Mumbai', null, 'Thane', null),
               ('Navi Mumbai', 'Vashi', 'Thane', '400703'), ('Navi Mumbai', 'Airoli', 'Thane', '400708'),
               ('Thane', null, 'Thane', null), ('Pune', null, 'Pune', null),
               ('Pune', 'Hinjawadi', 'Pune', '411057'), ('Pune', 'Kharadi', 'Pune', '411014')) as m(city, locality, district, pin)
  join public.districts d on d.state_code = 'MH' and d.name = m.district
 where l.state_code = 'MH' and l.city = m.city and l.locality is not distinct from m.locality;

insert into public.locations (city, state, kind, state_code)
select s.name, s.name, 'state', s.code from public.states s;

insert into public.locations (city, state, kind, state_code, district_id, district)
select d.name, s.name, 'district', d.state_code, d.id, d.name
  from public.districts d join public.states s on s.code = d.state_code
 where not exists (select 1 from public.locations l where l.district_id = d.id and l.kind = 'district');

-- Cities people search for by a name that is not a district name.
insert into public.locations (city, state, kind, state_code, district_id, district)
select v.city, s.name, 'city', v.st, d.id, d.name
  from (values ('Delhi', 'DL', null::text), ('Bengaluru', 'KA', 'Bengaluru Urban'),
               ('Noida', 'UP', 'Gautam Buddha Nagar'), ('Ahmedabad', 'GJ', 'Ahmadabad')) as v(city, st, district)
  join public.states s on s.code = v.st
  left join public.districts d on d.state_code = v.st and d.name = v.district
 where not exists (select 1 from public.locations l where l.state_code = v.st and l.city = v.city and l.locality is null and l.kind <> 'state');

insert into public.locations (city, locality, state, kind, state_code, district_id, district, pincode, aliases)
select p.city, p.locality, s.name, 'pin', p.state_code, d.id, d.name, p.pincode, p.aliases
  from private.pin_import p
  join public.states s on s.code = p.state_code
  join public.districts d on d.state_code = p.state_code and d.name = p.district;

do $$ begin
  if (select count(*) from public.locations where kind = 'pin') <> (select count(*) from private.pin_import) then
    raise exception 'PIN import incomplete: % of % rows', (select count(*) from public.locations where kind = 'pin'), (select count(*) from private.pin_import);
  end if;
end $$;
drop table private.pin_import;

alter table public.locations alter column state_code set not null;
alter table public.locations alter column state drop default;
create unique index locations_pin_key on public.locations (pincode) where kind = 'pin';
create unique index locations_place_key on public.locations (state_code, kind, city, coalesce(locality, '')) where kind <> 'pin';
create index locations_district_idx on public.locations (district_id);
create index locations_pincode_prefix_idx on public.locations (pincode text_pattern_ops);
create index locations_state_city_idx on public.locations (state_code, city);

-- A job, and where a candidate lives, must be a real place, not a whole state.
create or replace function private.require_specific_location() returns trigger
language plpgsql set search_path = '' as $$
declare loc uuid := (to_jsonb(new) ->> case when tg_table_name = 'jobs' then 'location_id' else 'current_location_id' end)::uuid;
begin
  if loc is not null and exists (select 1 from public.locations where id = loc and kind = 'state') then
    raise exception 'Choose a city, area or PIN code, not a whole state' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger jobs_specific_location before insert or update of location_id on public.jobs
  for each row execute function private.require_specific_location();
create trigger candidate_specific_location before insert or update of current_location_id on public.candidate_profiles
  for each row execute function private.require_specific_location();

------------------------------------------------------------------------------
-- 4. Labels, containment and type-ahead search
------------------------------------------------------------------------------
create or replace function private.location_label(p_kind text, p_city text, p_locality text, p_district text, p_state text, p_pincode text)
returns text language sql immutable set search_path = '' as $$
  select case p_kind
    when 'state' then p_state || ' (entire state)'
    when 'pin' then p_pincode || ' · ' || coalesce(p_locality || ', ', '') || p_city || ', ' || p_state
    when 'locality' then p_locality || ', ' || p_city || ', ' || p_state
    else p_city || case when p_district is not null and p_district <> p_city then ' (' || p_district || ')' else '' end || ', ' || p_state
  end $$;

-- Does place s (what someone searched for or prefers) contain location l?
create or replace function private.place_contains(s public.locations, l public.locations)
returns boolean language sql immutable set search_path = '' as $$
  select s.id = l.id
      or (s.kind = 'state' and l.state_code = s.state_code)
      or (s.kind = 'district' and (l.district_id = s.district_id or (l.city = s.city and l.state_code = s.state_code)))
      or (s.kind = 'city' and l.city = s.city and l.state_code = s.state_code)
      or (s.kind in ('locality', 'pin') and s.pincode is not null and l.pincode = s.pincode) $$;

create or replace function public.search_locations(p_query text, p_kinds text[] default null, p_limit integer default 20)
returns table (id uuid, kind text, label text, city text, locality text, district text, state_code text, state_name text, pincode text)
language plpgsql stable security definer set search_path = '' as $$
declare
  q text := lower(trim(coalesce(p_query, '')));
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  pat text;
begin
  perform private.require_user();
  if q ~ '^[0-9]+$' then
    if length(q) < 3 then return; end if;
  elsif length(q) < 2 then return;
  end if;
  pat := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  return query
  select l.id, l.kind, private.location_label(l.kind, l.city, l.locality, l.district, l.state, l.pincode),
         l.city, l.locality, l.district, l.state_code, l.state, l.pincode
    from public.locations l
   where l.active
     and (p_kinds is null or l.kind = any(p_kinds))
     and case when q ~ '^[0-9]+$' then l.pincode like pat || '%'
              else l.search_text like pat || '%' or l.search_text like '% ' || pat || '%' end
   order by
     case when lower(l.city) = q or lower(coalesce(l.locality, '')) = q then 0 else 1 end,
     case l.kind when 'district' then 0 when 'city' then 0 when 'state' then 1 when 'locality' then 2 else 3 end,
     case when lower(l.city) like pat || '%' or lower(coalesce(l.locality, '')) like pat || '%' then 0 else 1 end,
     l.pincode nulls first, l.city, l.locality
   limit lim;
end $$;

------------------------------------------------------------------------------
-- 5. Hierarchical location score (candidate preference vs. job location)
------------------------------------------------------------------------------
create or replace function private.location_fit(p_candidate uuid, p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs%rowtype; jl public.locations%rowtype; r record; base numeric; tier text;
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
  return jsonb_build_object('score', round(best, 1), 'tier', best_tier, 'rank', best_rank);  -- score null: no location data
end $$;

create or replace function private.score_location(p_candidate uuid, p_job uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select (private.location_fit(p_candidate, p_job)->>'score')::numeric $$;

-- @@MATCH_SCORE@@

------------------------------------------------------------------------------
-- 6. Job search and candidate discovery with India-wide location filters
------------------------------------------------------------------------------
create or replace function private.check_location_filters(p_places uuid[], p_states text[], p_pin_prefix text)
returns void language plpgsql stable set search_path = '' as $$
begin
  if cardinality(coalesce(p_places, '{}')) > 20 then raise exception 'Choose at most 20 places' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_states, '{}')) x where x not in (select code from public.states)) then
    raise exception 'Unknown state' using errcode = '22023';
  end if;
  if p_pin_prefix is not null and p_pin_prefix !~ '^[1-9][0-9]{0,5}$' then
    raise exception 'A PIN code has 6 digits and does not start with 0' using errcode = '22023';
  end if;
end $$;

create or replace function public.job_search(
  p_query text default null, p_places uuid[] default null, p_states text[] default null, p_pin_prefix text default null,
  p_include_remote boolean default true, p_min_salary integer default null, p_max_exp_months integer default null,
  p_work_mode text default null, p_category uuid default null, p_employment_type text default null,
  p_sort text default 'match', p_saved_only boolean default false, p_limit integer default 30, p_offset integer default 0)
returns table (job_id uuid, title text, company_id uuid, company_name text, company_verified boolean, city text, locality text,
  district text, state_code text, state_name text, pincode text, location_label text,
  work_mode text, employment_type text, salary_min integer, salary_max integer, salary_period text, annual_max numeric,
  experience_min_months integer, published_at timestamptz, skills text[], saved boolean, applied boolean,
  score numeric, eligible boolean, match jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  q text := nullif(trim(coalesce(p_query, '')), '');
  places uuid[] := nullif(p_places, '{}');
  states text[] := nullif(p_states, '{}');
  pin text := nullif(trim(coalesce(p_pin_prefix, '')), '');
  loc_filter boolean;
begin
  perform private.check_location_filters(places, states, pin);
  loc_filter := places is not null or states is not null or pin is not null;
  return query
  select f.job_id, f.title, f.company_id, f.company_name, f.company_verified, f.city, f.locality, f.district, f.state_code,
         f.state_name, f.pincode, f.location_label, f.work_mode, f.employment_type, f.salary_min, f.salary_max, f.salary_period,
         f.annual_max, f.experience_min_months, f.published_at, f.skills, f.saved, f.applied,
         (m.v->>'score')::numeric, (m.v->>'eligible')::boolean, m.v
  from (
    select j.id as job_id, j.title as title, c.id as company_id, c.display_name as company_name,
      (c.verification_status = 'approved') as company_verified, l.city as city, l.locality as locality, l.district as district,
      l.state_code as state_code, l.state as state_name, l.pincode as pincode,
      case when j.work_mode = 'remote' then 'Remote (anywhere in India)'
           else private.location_label(l.kind, l.city, l.locality, l.district, l.state, l.pincode) end as location_label,
      j.work_mode as work_mode, j.employment_type as employment_type, j.salary_min as salary_min, j.salary_max as salary_max,
      j.salary_period as salary_period, private.annual_salary(j.salary_max, j.salary_period) as annual_max,
      j.experience_min_months as experience_min_months, j.published_at as published_at,
      coalesce((select array_agg(s.name order by s.name) from public.job_skills js join public.skills s on s.id = js.skill_id where js.job_id = j.id), '{}'::text[]) as skills,
      exists (select 1 from public.saved_jobs sj where sj.job_id = j.id and sj.candidate_id = uid) as saved,
      exists (select 1 from public.applications a where a.job_id = j.id and a.candidate_id = uid) as applied
    from public.jobs j
    join public.companies c on c.id = j.company_id
    left join public.locations l on l.id = j.location_id
    where private.job_is_public(j.id)
      -- Location filters are applied before any match score is computed, so national search stays fast.
      and (p_include_remote or j.work_mode <> 'remote')
      and (not loc_filter
           or (j.work_mode = 'remote' and p_include_remote)
           or (l.id is not null and (
                 (places is not null and exists (select 1 from public.locations s where s.id = any(places) and private.place_contains(s, l)))
              or (states is not null and l.state_code = any(states))
              or (pin is not null and l.pincode like pin || '%'))))
      and (q is null or j.title ilike '%' || q || '%' or c.display_name ilike '%' || q || '%'
           or exists (select 1 from public.job_skills js join public.skills s on s.id = js.skill_id where js.job_id = j.id and s.name ilike '%' || q || '%'))
      and (p_min_salary is null or private.annual_salary(j.salary_max, j.salary_period) >= p_min_salary)
      and (p_max_exp_months is null or j.experience_min_months <= p_max_exp_months)
      and (p_work_mode is null or j.work_mode = p_work_mode)
      and (p_category is null or j.category_id = p_category)
      and (p_employment_type is null or j.employment_type = p_employment_type)
  ) f
  cross join lateral (select private.match_score(uid, f.job_id) as v) m
  where (not p_saved_only or f.saved)
  order by
    case when p_sort = 'match' then (m.v->>'eligible')::boolean::int end desc nulls last,
    case when p_sort = 'match' then (m.v->>'score')::numeric end desc nulls last,
    case when p_sort = 'salary' then f.annual_max end desc nulls last,
    f.published_at desc, f.job_id
  limit least(greatest(coalesce(p_limit, 30), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create or replace function public.discover_candidates(
  p_job uuid, p_skill text default null, p_places uuid[] default null, p_states text[] default null,
  p_min_months integer default null, p_max_months integer default null, p_max_salary integer default null, p_limit integer default 25)
returns table (candidate_id uuid, headline text, city text, locality text, state_name text, location_label text, experience_months integer,
               expected_salary integer, salary_period text, notice_days integer, skills text[], score numeric, match jsonb)
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
  return query
  select q.user_id, q.headline, q.city, q.locality, q.state_name, q.label, q.experience_months, q.salary_min, q.salary_period,
         q.notice_days, q.skill_names, (q.m->>'score')::numeric, q.m
  from (
    select f.*, private.match_score(f.user_id, p_job) as m
    from (
      select cp.user_id, cp.headline, l.city, l.locality, l.state as state_name,
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
        -- A candidate matches if one of their places (current or preferred) overlaps one of the searched places.
        and ((places is null and states is null) or exists (
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
end $$;

------------------------------------------------------------------------------
-- 7. Privileges and version
------------------------------------------------------------------------------
create or replace function public.schema_version()
returns text language sql immutable set search_path = '' as $$ select '202611260001'::text $$;

revoke all on function public.search_locations(text, text[], integer) from public, anon;
grant execute on function public.search_locations(text, text[], integer) to authenticated;
revoke all on function public.job_search(text, uuid[], text[], text, boolean, integer, integer, text, uuid, text, text, boolean, integer, integer) from public, anon;
grant execute on function public.job_search(text, uuid[], text[], text, boolean, integer, integer, text, uuid, text, text, boolean, integer, integer) to authenticated;
revoke all on function public.discover_candidates(uuid, text, uuid[], text[], integer, integer, integer, integer) from public, anon;
grant execute on function public.discover_candidates(uuid, text, uuid[], text[], integer, integer, integer, integer) to authenticated;
revoke all on function private.location_label(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function private.place_contains(public.locations, public.locations) from public, anon, authenticated;
revoke all on function private.location_fit(uuid, uuid) from public, anon, authenticated;
revoke all on function private.check_location_filters(uuid[], text[], text) from public, anon, authenticated;
revoke all on function private.require_specific_location() from public, anon, authenticated;
revoke all on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated, service_role;
