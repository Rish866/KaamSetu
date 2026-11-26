-- 202611260002 Offer and joining milestones: two-sided, timestamped, auditable.
-- offer_issued      employer makes an offer (recorded automatically by "Make offer")
-- offer_accepted    the candidate accepts in KaamSetu -> application becomes "hired" (employers can no longer mark hired)
-- offer_declined    the candidate declines -> application "withdrawn"
-- offer_withdrawn   the employer withdraws the offer with a reason (not possible once joining is recorded)
-- joined_day_1 / candidate_no_show / retained_day_15 / retained_day_30 / left_before_day_30
--                   reported by one side, then confirmed or disputed by the other. Unanswered reports confirm
--                   automatically after 7 days. Disputes are decided by an administrator with a written reason.
-- Every action notifies the other side and is written to the audit log. Feeds Part 3 (scorecards) and Part 4 (ledger).

create table public.hiring_milestones (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  candidate_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('offer_issued', 'offer_accepted', 'offer_declined', 'offer_withdrawn', 'joined_day_1',
                                     'candidate_no_show', 'retained_day_15', 'retained_day_30', 'left_before_day_30')),
  occurred_on date not null default current_date,
  status text not null check (status in ('pending', 'confirmed', 'disputed', 'rejected')),
  reported_by uuid not null references public.profiles(id),
  reported_role text not null check (reported_role in ('employer', 'candidate')),
  reported_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  confirmed_via text check (confirmed_via in ('single_party', 'counterparty', 'auto', 'admin')),
  disputed_at timestamptz,
  disputed_by uuid references public.profiles(id),
  dispute_reason text check (char_length(dispute_reason) <= 1000),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution_reason text check (char_length(resolution_reason) <= 1000),
  note text check (char_length(note) <= 1000)
);
create unique index hiring_milestones_one_active on public.hiring_milestones (application_id, kind) where status <> 'rejected';
create index hiring_milestones_company_idx on public.hiring_milestones (company_id, kind, status);
create index hiring_milestones_pending_idx on public.hiring_milestones (reported_at) where status = 'pending';
create index hiring_milestones_candidate_idx on public.hiring_milestones (candidate_id);
alter table public.hiring_milestones enable row level security;
create policy hiring_milestones_read on public.hiring_milestones for select to authenticated
  using (candidate_id = (select auth.uid()) or private.is_company_member(company_id) or private.is_admin(array['admin', 'moderator']));
revoke all on public.hiring_milestones from anon, authenticated, service_role;
grant select on public.hiring_milestones to authenticated;

alter table public.applications add column if not exists joining_date date;

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------
create or replace function private.milestone_label(p_kind text) returns text language sql immutable set search_path = '' as $$
  select case p_kind
    when 'offer_issued' then 'Offer made' when 'offer_accepted' then 'Offer accepted' when 'offer_declined' then 'Offer declined'
    when 'offer_withdrawn' then 'Offer withdrawn' when 'joined_day_1' then 'Joined (day 1)' when 'candidate_no_show' then 'Did not join'
    when 'retained_day_15' then 'Still working at day 15' when 'retained_day_30' then 'Still working at day 30'
    when 'left_before_day_30' then 'Left before day 30' else p_kind end $$;

-- Locks the application and tells the caller which side they are on. Anyone else gets "not found".
create or replace function private.hiring_side(p_application uuid, out o_candidate uuid, out o_company uuid,
  out o_stage public.application_stage, out o_side text, out o_joining date)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  select a.candidate_id, j.company_id, a.stage, a.joining_date into o_candidate, o_company, o_stage, o_joining
    from public.applications a join public.jobs j on j.id = a.job_id where a.id = p_application for update of a;
  if o_candidate is null then raise exception 'Application not found' using errcode = 'P0002'; end if;
  if o_candidate = uid then o_side := 'candidate';
  elsif private.is_company_member(o_company, array['owner', 'recruiter']::public.company_role[]) then o_side := 'employer';
  else raise exception 'Application not found' using errcode = 'P0002';
  end if;
end $$;

create or replace function private.active_milestone(p_application uuid, p_kind text) returns public.hiring_milestones
language sql stable security definer set search_path = '' as $$
  select * from public.hiring_milestones where application_id = p_application and kind = p_kind and status <> 'rejected' $$;

create or replace function private.add_milestone(p_application uuid, p_company uuid, p_candidate uuid, p_kind text, p_role text,
  p_single_party boolean, p_on date, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); mid uuid;
begin
  if (private.active_milestone(p_application, p_kind)).id is not null then
    raise exception '% is already recorded for this application', private.milestone_label(p_kind) using errcode = '23505';
  end if;
  insert into public.hiring_milestones (application_id, company_id, candidate_id, kind, occurred_on, status, reported_by, reported_role,
    confirmed_at, confirmed_by, confirmed_via, note)
  values (p_application, p_company, p_candidate, p_kind, coalesce(p_on, current_date), case when p_single_party then 'confirmed' else 'pending' end,
    uid, p_role, case when p_single_party then now() end, case when p_single_party then uid end,
    case when p_single_party then 'single_party' end, nullif(left(trim(coalesce(p_note, '')), 1000), ''))
  returning id into mid;
  perform private.audit('hiring.' || p_kind || '.reported', 'application', p_application, p_company,
    jsonb_build_object('milestone', mid, 'role', p_role, 'occurred_on', coalesce(p_on, current_date)));
  return mid;
end $$;

create or replace function private.notify_other_side(p_side text, p_candidate uuid, p_company uuid, p_kind text, p_title text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_side = 'candidate' then
    perform private.notify_company(p_company, array['owner', 'recruiter']::public.company_role[], p_kind, p_title, 'Open KaamSetu to see the details.');
  else
    perform private.notify(p_candidate, p_kind, p_title, 'Open KaamSetu to see the details.');
  end if;
end $$;

------------------------------------------------------------------------------
-- Offers
------------------------------------------------------------------------------
-- "Make offer" (transition to 'offer') records offer_issued; nobody but the candidate can turn an offer into a hire.
create or replace function private.on_application_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare comp uuid; cand uuid;
begin
  if new.to_stage = 'offer' then
    select j.company_id, a.candidate_id into comp, cand from public.applications a join public.jobs j on j.id = a.job_id where a.id = new.application_id;
    if (private.active_milestone(new.application_id, 'offer_issued')).id is null then
      insert into public.hiring_milestones (application_id, company_id, candidate_id, kind, status, reported_by, reported_role,
        confirmed_at, confirmed_by, confirmed_via, note)
      values (new.application_id, comp, cand, 'offer_issued', 'confirmed', new.actor_id, 'employer', now(), new.actor_id, 'single_party', left(new.details, 1000));
    end if;
  end if;
  return new;
end $$;
create trigger application_events_milestones after insert on public.application_events
  for each row execute function private.on_application_event();

create or replace function private.guard_hire() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.stage = 'offer' and new.stage = 'hired' and coalesce(current_setting('kaamsetu.offer_accepted', true), '') <> 'yes' then
    raise exception 'The candidate accepts the offer in KaamSetu; it then shows as hired' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger applications_guard_hire before update of stage on public.applications
  for each row execute function private.guard_hire();

create or replace function public.set_joining_date(p_application uuid, p_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  select * into s from private.hiring_side(p_application);
  if s.o_side <> 'employer' then raise exception 'Only the employer sets the joining date' using errcode = '42501'; end if;
  if s.o_stage not in ('offer', 'hired') then raise exception 'Make an offer before setting a joining date' using errcode = '55000'; end if;
  if p_date is null or p_date < current_date - 30 or p_date > current_date + 365 then
    raise exception 'Choose a joining date within the next year' using errcode = '22023';
  end if;
  if (private.active_milestone(p_application, 'joined_day_1')).id is not null then
    raise exception 'Joining is already recorded' using errcode = '55000';
  end if;
  update public.applications set joining_date = p_date, updated_at = now() where id = p_application;
  perform private.notify(s.o_candidate, 'hiring.joining_date', 'Joining date updated', 'Open KaamSetu to see the details.');
  perform private.audit('hiring.joining_date', 'application', p_application, s.o_company, jsonb_build_object('date', p_date));
end $$;

create or replace function public.respond_to_offer(p_application uuid, p_accept boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s record; uid uuid := private.require_user();
begin
  select * into s from private.hiring_side(p_application);
  if s.o_side <> 'candidate' then raise exception 'Only the candidate can answer an offer' using errcode = '42501'; end if;
  if s.o_stage <> 'offer' or (private.active_milestone(p_application, 'offer_issued')).id is null then
    raise exception 'There is no open offer to answer' using errcode = '55000';
  end if;
  if p_accept then
    perform private.add_milestone(p_application, s.o_company, s.o_candidate, 'offer_accepted', 'candidate', true, current_date, null);
    perform set_config('kaamsetu.offer_accepted', 'yes', true);
    update public.applications set stage = 'hired', updated_at = now() where id = p_application;
    perform set_config('kaamsetu.offer_accepted', '', true);
    insert into public.application_events (application_id, from_stage, to_stage, actor_id, reason) values (p_application, 'offer', 'hired', uid, 'Offer accepted by the candidate');
    perform private.notify_other_side('candidate', s.o_candidate, s.o_company, 'hiring.offer_accepted', 'Your offer was accepted');
  else
    perform private.add_milestone(p_application, s.o_company, s.o_candidate, 'offer_declined', 'candidate', true, current_date, p_reason);
    update public.applications set stage = 'withdrawn', updated_at = now() where id = p_application;
    insert into public.application_events (application_id, from_stage, to_stage, actor_id, reason)
    values (p_application, 'offer', 'withdrawn', uid, left(coalesce('Offer declined: ' || nullif(trim(p_reason), ''), 'Offer declined'), 1000));
    perform private.notify_other_side('candidate', s.o_candidate, s.o_company, 'hiring.offer_declined', 'Your offer was declined');
  end if;
end $$;

create or replace function public.withdraw_offer(p_application uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare s record; uid uuid := private.require_user(); v_reason text := private.require_reason(p_reason, 5);
begin
  select * into s from private.hiring_side(p_application);
  if s.o_side <> 'employer' then raise exception 'Only the employer can withdraw an offer' using errcode = '42501'; end if;
  if s.o_stage not in ('offer', 'hired') then raise exception 'There is no offer to withdraw' using errcode = '55000'; end if;
  if (private.active_milestone(p_application, 'joined_day_1')).id is not null then
    raise exception 'The candidate has already joined; record "left before day 30" instead' using errcode = '55000';
  end if;
  perform private.add_milestone(p_application, s.o_company, s.o_candidate, 'offer_withdrawn', 'employer', true, current_date, v_reason);
  update public.applications set stage = 'rejected', updated_at = now() where id = p_application;
  insert into public.application_events (application_id, from_stage, to_stage, actor_id, reason) values (p_application, s.o_stage, 'rejected', uid, 'Offer withdrawn: ' || v_reason);
  perform private.notify_other_side('employer', s.o_candidate, s.o_company, 'hiring.offer_withdrawn', 'An offer was withdrawn');
end $$;

------------------------------------------------------------------------------
-- Joining and retention (two-sided)
------------------------------------------------------------------------------
create or replace function public.report_hiring_milestone(p_application uuid, p_kind text, p_on date default null, p_note text default null)
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
  mid := private.add_milestone(p_application, s.o_company, s.o_candidate, p_kind, s.o_side, false, on_day, p_note);
  perform private.notify_other_side(s.o_side, s.o_candidate, s.o_company, 'hiring.confirm_needed', 'Please confirm: ' || private.milestone_label(p_kind));
  return mid;
end $$;

create or replace function private.lock_milestone(p_milestone uuid) returns public.hiring_milestones
language plpgsql security definer set search_path = '' as $$
declare m public.hiring_milestones; s record;
begin
  select * into m from public.hiring_milestones where id = p_milestone for update;
  if m.id is null then raise exception 'Milestone not found' using errcode = 'P0002'; end if;
  select * into s from private.hiring_side(m.application_id);
  if s.o_side = m.reported_role then raise exception 'The other side confirms what you reported' using errcode = '42501'; end if;
  if m.status <> 'pending' then raise exception 'This milestone is already %', m.status using errcode = '55000'; end if;
  return m;
end $$;

create or replace function public.confirm_hiring_milestone(p_milestone uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.hiring_milestones := private.lock_milestone(p_milestone); uid uuid := private.require_user();
begin
  update public.hiring_milestones set status = 'confirmed', confirmed_at = now(), confirmed_by = uid, confirmed_via = 'counterparty' where id = m.id;
  perform private.notify_other_side(case m.reported_role when 'employer' then 'candidate' else 'employer' end, m.candidate_id, m.company_id,
    'hiring.confirmed', 'Confirmed: ' || private.milestone_label(m.kind));
  perform private.audit('hiring.' || m.kind || '.confirmed', 'application', m.application_id, m.company_id, jsonb_build_object('milestone', m.id));
end $$;

create or replace function public.dispute_hiring_milestone(p_milestone uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.hiring_milestones := private.lock_milestone(p_milestone); uid uuid := private.require_user();
        v_reason text := private.require_reason(p_reason, 5);
begin
  update public.hiring_milestones set status = 'disputed', disputed_at = now(), disputed_by = uid, dispute_reason = left(v_reason, 1000) where id = m.id;
  perform private.notify_other_side(case m.reported_role when 'employer' then 'candidate' else 'employer' end, m.candidate_id, m.company_id,
    'hiring.disputed', 'Disputed: ' || private.milestone_label(m.kind));
  perform private.audit('hiring.' || m.kind || '.disputed', 'application', m.application_id, m.company_id, jsonb_build_object('milestone', m.id, 'reason', v_reason));
end $$;

create or replace function public.admin_hiring_disputes()
returns table (milestone_id uuid, kind text, label text, occurred_on date, reported_role text, reported_at timestamptz, note text,
               dispute_reason text, disputed_at timestamptz, job_title text, company_name text, application_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin(array['admin', 'moderator']);
  return query
  select m.id, m.kind, private.milestone_label(m.kind), m.occurred_on, m.reported_role, m.reported_at, m.note, m.dispute_reason, m.disputed_at,
         j.title, c.display_name, m.application_id
    from public.hiring_milestones m join public.applications a on a.id = m.application_id
    join public.jobs j on j.id = a.job_id join public.companies c on c.id = m.company_id
   where m.status = 'disputed' order by m.disputed_at;
end $$;

create or replace function public.admin_resolve_hiring_milestone(p_milestone uuid, p_decision text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin', 'moderator']); v_reason text := private.require_reason(p_reason); m public.hiring_milestones;
begin
  if p_decision not in ('confirm', 'reject') then raise exception 'Decision must be confirm or reject' using errcode = '22023'; end if;
  select * into m from public.hiring_milestones where id = p_milestone for update;
  if m.id is null then raise exception 'Milestone not found' using errcode = 'P0002'; end if;
  if m.status not in ('pending', 'disputed') then raise exception 'Only open or disputed milestones can be decided' using errcode = '55000'; end if;
  update public.hiring_milestones
     set status = case p_decision when 'confirm' then 'confirmed' else 'rejected' end,
         confirmed_at = case p_decision when 'confirm' then now() end, confirmed_by = case p_decision when 'confirm' then uid end,
         confirmed_via = case p_decision when 'confirm' then 'admin' end,
         resolved_at = now(), resolved_by = uid, resolution_reason = left(v_reason, 1000)
   where id = m.id;
  perform private.notify(m.candidate_id, 'hiring.resolved', 'KaamSetu decided: ' || private.milestone_label(m.kind), 'Open KaamSetu to see the decision.');
  perform private.notify_company(m.company_id, array['owner', 'recruiter']::public.company_role[], 'hiring.resolved',
    'KaamSetu decided: ' || private.milestone_label(m.kind), 'Open KaamSetu to see the decision.');
  perform private.audit('hiring.' || m.kind || '.' || p_decision || 'ed_by_admin', 'application', m.application_id, m.company_id,
    jsonb_build_object('milestone', m.id, 'reason', v_reason));
end $$;

-- Background worker: reports nobody answered within 7 days are confirmed (both sides were notified).
create or replace function public.hiring_milestones_auto_confirm()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer; r record;
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  n := 0;
  for r in update public.hiring_milestones set status = 'confirmed', confirmed_at = now(), confirmed_via = 'auto'
            where status = 'pending' and reported_at < now() - interval '7 days' returning id, application_id, company_id, candidate_id, kind loop
    n := n + 1;
    perform private.notify(r.candidate_id, 'hiring.auto_confirmed', 'Confirmed automatically: ' || private.milestone_label(r.kind), 'Nobody disputed it within 7 days.');
    perform private.notify_company(r.company_id, array['owner', 'recruiter']::public.company_role[], 'hiring.auto_confirmed',
      'Confirmed automatically: ' || private.milestone_label(r.kind), 'Nobody disputed it within 7 days.');
    perform private.audit('hiring.' || r.kind || '.auto_confirmed', 'application', r.application_id, r.company_id, jsonb_build_object('milestone', r.id));
  end loop;
  return n;
end $$;

-- One call for the screens: joining date and milestone history per application, for the candidate or the company only.
create or replace function public.hiring_status(p_applications uuid[])
returns table (application_id uuid, joining_date date, milestones jsonb)
language sql stable security definer set search_path = '' as $$
  select a.id, a.joining_date,
    coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'label', private.milestone_label(m.kind), 'status', m.status,
        'occurred_on', m.occurred_on, 'reported_role', m.reported_role, 'confirmed_via', m.confirmed_via, 'note', m.note,
        'dispute_reason', m.dispute_reason, 'resolution_reason', m.resolution_reason) order by m.reported_at)
      from public.hiring_milestones m where m.application_id = a.id), '[]'::jsonb)
  from public.applications a join public.jobs j on j.id = a.job_id
  where a.id = any(p_applications[1:200])
    and (a.candidate_id = (select auth.uid()) or private.is_company_member(j.company_id)) $$;

------------------------------------------------------------------------------
-- Privileges and version
------------------------------------------------------------------------------
create or replace function public.schema_version()
returns text language sql immutable set search_path = '' as $$ select '202611260002'::text $$;

revoke all on function public.set_joining_date(uuid, date) from public, anon;
revoke all on function public.respond_to_offer(uuid, boolean, text) from public, anon;
revoke all on function public.withdraw_offer(uuid, text) from public, anon;
revoke all on function public.report_hiring_milestone(uuid, text, date, text) from public, anon;
revoke all on function public.confirm_hiring_milestone(uuid) from public, anon;
revoke all on function public.dispute_hiring_milestone(uuid, text) from public, anon;
revoke all on function public.admin_hiring_disputes() from public, anon;
revoke all on function public.hiring_status(uuid[]) from public, anon;
grant execute on function public.hiring_status(uuid[]) to authenticated;
revoke all on function public.admin_resolve_hiring_milestone(uuid, text, text) from public, anon;
grant execute on function public.set_joining_date(uuid, date), public.respond_to_offer(uuid, boolean, text), public.withdraw_offer(uuid, text),
  public.report_hiring_milestone(uuid, text, date, text), public.confirm_hiring_milestone(uuid), public.dispute_hiring_milestone(uuid, text),
  public.admin_hiring_disputes(), public.admin_resolve_hiring_milestone(uuid, text, text) to authenticated;
revoke all on function public.hiring_milestones_auto_confirm() from public, anon, authenticated;
grant execute on function public.hiring_milestones_auto_confirm() to service_role;
revoke all on function private.milestone_label(text) from public, anon, authenticated;
revoke all on function private.hiring_side(uuid) from public, anon, authenticated;
revoke all on function private.active_milestone(uuid, text) from public, anon, authenticated;
revoke all on function private.add_milestone(uuid, uuid, uuid, text, text, boolean, date, text) from public, anon, authenticated;
revoke all on function private.notify_other_side(text, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function private.on_application_event() from public, anon, authenticated;
revoke all on function private.guard_hire() from public, anon, authenticated;
revoke all on function private.lock_milestone(uuid) from public, anon, authenticated;
revoke all on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated, service_role;
