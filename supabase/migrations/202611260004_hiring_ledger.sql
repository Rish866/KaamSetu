-- 202611260004 Outcome-based hiring ledger (record keeping only; no payments are taken).
-- Job posting is free and candidates are never charged: the ledger has a company as the only payer and no candidate side.
-- Fee terms are platform settings, OFF with ₹0 by default. An administrator sets them (audited). The terms in force when
-- a candidate accepts an offer are copied onto that hire's ledger entry, so later changes never apply retroactively.
-- Entry life cycle (every change is written to hiring_ledger_events and the audit log):
--   pending_milestone --(fee milestone confirmed)--> payable --(admin records payment, with reference)--> paid
--   pending_milestone --(no-show / offer withdrawn / left before the fee milestone)--> void
--   payable --(employer disputes, with reason)--> disputed --(admin)--> payable | waived
--   pending_milestone | payable | disputed --(admin waives, with reason)--> waived

insert into private.settings (key, value) values
  ('hire_fee_enabled', 'false'::jsonb), ('hire_fee_inr', '0'::jsonb), ('hire_fee_milestone', '"retained_day_15"'::jsonb)
on conflict (key) do nothing;

create table public.hiring_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  application_id uuid not null unique references public.applications(id),
  amount_inr integer not null check (amount_inr > 0 and amount_inr <= 10000000),
  fee_milestone text not null check (fee_milestone in ('joined_day_1', 'retained_day_15', 'retained_day_30')),
  status text not null default 'pending_milestone'
    check (status in ('pending_milestone', 'payable', 'paid', 'waived', 'disputed', 'void')),
  created_at timestamptz not null default now(),
  payable_at timestamptz,
  closed_at timestamptz,
  payment_reference text check (char_length(payment_reference) <= 120),
  note text check (char_length(note) <= 1000)
);
create index hiring_ledger_company_idx on public.hiring_ledger (company_id, status);
create table public.hiring_ledger_events (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.hiring_ledger(id) on delete cascade,
  from_status text, to_status text not null,
  actor_id uuid references public.profiles(id),   -- null: automatic (milestone confirmed, hire did not happen)
  reason text check (char_length(reason) <= 1000),
  created_at timestamptz not null default now()
);
create index hiring_ledger_events_entry_idx on public.hiring_ledger_events (entry_id, created_at);
create or replace function private.ledger_events_immutable() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Ledger history is immutable' using errcode = '42501'; end $$;
create trigger hiring_ledger_events_immutable before update or delete on public.hiring_ledger_events
  for each row execute function private.ledger_events_immutable();

alter table public.hiring_ledger enable row level security;
alter table public.hiring_ledger_events enable row level security;
create policy hiring_ledger_read on public.hiring_ledger for select to authenticated
  using (private.is_company_member(company_id, array['owner', 'recruiter']::public.company_role[]) or private.is_admin(array['admin']));
create policy hiring_ledger_events_read on public.hiring_ledger_events for select to authenticated
  using (exists (select 1 from public.hiring_ledger l where l.id = entry_id
                  and (private.is_company_member(l.company_id, array['owner', 'recruiter']::public.company_role[]) or private.is_admin(array['admin']))));
revoke all on public.hiring_ledger, public.hiring_ledger_events from anon, authenticated, service_role;
grant select on public.hiring_ledger, public.hiring_ledger_events to authenticated;

------------------------------------------------------------------------------
-- Fee terms
------------------------------------------------------------------------------
create or replace function private.hire_fee_terms()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'enabled', coalesce((private.setting('hire_fee_enabled'))::text::boolean, false),
    'amount_inr', coalesce((private.setting('hire_fee_inr'))::text::integer, 0),
    'milestone', coalesce(private.setting('hire_fee_milestone') #>> '{}', 'retained_day_15')) $$;

create or replace function public.platform_flags()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('resume_uploads_enabled', private.resume_uploads_enabled(), 'hire_fee', private.hire_fee_terms()) $$;

create or replace function public.admin_set_hire_fee(p_enabled boolean, p_amount_inr integer, p_milestone text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin']); v_reason text := private.require_reason(p_reason, 10); old jsonb := private.hire_fee_terms();
begin
  if p_milestone not in ('joined_day_1', 'retained_day_15', 'retained_day_30') then raise exception 'Choose day 1, day 15 or day 30' using errcode = '22023'; end if;
  if p_amount_inr is null or p_amount_inr < 0 or p_amount_inr > 10000000 then raise exception 'Enter a fee between ₹0 and ₹1,00,00,000' using errcode = '22023'; end if;
  if p_enabled and p_amount_inr = 0 then raise exception 'Set an amount above ₹0 before switching fees on' using errcode = '22023'; end if;
  insert into private.settings (key, value, updated_by, updated_at) values
    ('hire_fee_enabled', to_jsonb(p_enabled), uid, now()), ('hire_fee_inr', to_jsonb(p_amount_inr), uid, now()), ('hire_fee_milestone', to_jsonb(p_milestone), uid, now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform private.audit('settings.hire_fee', 'setting', null, null, jsonb_build_object('before', old, 'after', private.hire_fee_terms(), 'reason', v_reason));
  return private.hire_fee_terms();
end $$;

------------------------------------------------------------------------------
-- Ledger transitions
------------------------------------------------------------------------------
create or replace function private.ledger_move(p_entry uuid, p_to text, p_actor uuid, p_reason text, p_reference text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.hiring_ledger;
begin
  select * into e from public.hiring_ledger where id = p_entry for update;
  update public.hiring_ledger set status = p_to,
    payable_at = case when p_to = 'payable' then coalesce(payable_at, now()) else payable_at end,
    closed_at = case when p_to in ('paid', 'waived', 'void') then now() else null end,
    payment_reference = coalesce(nullif(trim(coalesce(p_reference, '')), ''), payment_reference)
   where id = p_entry;
  insert into public.hiring_ledger_events (entry_id, from_status, to_status, actor_id, reason) values (p_entry, e.status, p_to, p_actor, left(p_reason, 1000));
  perform private.audit('ledger.' || p_to, 'ledger_entry', p_entry, e.company_id, jsonb_build_object('from', e.status, 'reason', left(p_reason, 300)));
  perform private.notify_company(e.company_id, array['owner']::public.company_role[], 'ledger.' || p_to, 'Hiring fee update', 'Open KaamSetu to see the details.');
end $$;

-- Follows confirmed milestones: creates the entry when an offer is accepted (if fees are on), makes it payable when the
-- fee milestone is confirmed, and voids it when the hire does not happen.
create or replace function private.ledger_on_milestone() returns trigger
language plpgsql security definer set search_path = '' as $$
declare terms jsonb; e public.hiring_ledger; joined date;
begin
  if new.status <> 'confirmed' or (tg_op = 'UPDATE' and old.status = 'confirmed') then return new; end if;
  if new.kind = 'offer_accepted' then
    terms := private.hire_fee_terms();
    if (terms->>'enabled')::boolean and (terms->>'amount_inr')::integer > 0 then
      insert into public.hiring_ledger (company_id, application_id, amount_inr, fee_milestone)
      values (new.company_id, new.application_id, (terms->>'amount_inr')::integer, terms->>'milestone')
      on conflict (application_id) do nothing returning * into e;
      if e.id is not null then
        insert into public.hiring_ledger_events (entry_id, to_status, reason)
        values (e.id, 'pending_milestone', format('Fee terms at offer acceptance: ₹%s when %s is confirmed', e.amount_inr, private.milestone_label(e.fee_milestone)));
      end if;
    end if;
    return new;
  end if;
  select * into e from public.hiring_ledger where application_id = new.application_id;
  if e.id is null or e.status <> 'pending_milestone' then return new; end if;
  if new.kind = e.fee_milestone then
    perform private.ledger_move(e.id, 'payable', null, 'Milestone confirmed: ' || private.milestone_label(new.kind));
  elsif new.kind in ('candidate_no_show', 'offer_withdrawn') then
    perform private.ledger_move(e.id, 'void', null, 'No fee: ' || private.milestone_label(new.kind));
  elsif new.kind = 'left_before_day_30' and e.fee_milestone <> 'joined_day_1' then
    select occurred_on into joined from public.hiring_milestones where application_id = new.application_id and kind = 'joined_day_1' and status = 'confirmed';
    if e.fee_milestone = 'retained_day_30' or joined is null or new.occurred_on < joined + 15 then
      perform private.ledger_move(e.id, 'void', null, 'No fee: left before ' || private.milestone_label(e.fee_milestone));
    end if;
  end if;
  return new;
end $$;
create trigger hiring_milestones_ledger after insert or update of status on public.hiring_milestones
  for each row execute function private.ledger_on_milestone();

create or replace function public.dispute_ledger_entry(p_entry uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); v_reason text := private.require_reason(p_reason, 10); e public.hiring_ledger;
begin
  select * into e from public.hiring_ledger where id = p_entry for update;
  if e.id is null or not private.is_company_member(e.company_id, array['owner']::public.company_role[]) then
    raise exception 'Entry not found' using errcode = 'P0002';
  end if;
  if e.status <> 'payable' then raise exception 'Only a payable fee can be disputed' using errcode = '55000'; end if;
  perform private.ledger_move(p_entry, 'disputed', uid, v_reason);
end $$;

create or replace function public.admin_ledger_action(p_entry uuid, p_action text, p_reason text, p_reference text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin']); v_reason text := private.require_reason(p_reason); e public.hiring_ledger;
begin
  select * into e from public.hiring_ledger where id = p_entry for update;
  if e.id is null then raise exception 'Entry not found' using errcode = 'P0002'; end if;
  if p_action = 'mark_paid' and e.status = 'payable' then
    if char_length(trim(coalesce(p_reference, ''))) < 4 then raise exception 'Add the payment reference (bank or UPI transaction id)' using errcode = '22023'; end if;
    perform private.ledger_move(p_entry, 'paid', uid, v_reason, p_reference);
  elsif p_action = 'waive' and e.status in ('pending_milestone', 'payable', 'disputed') then
    perform private.ledger_move(p_entry, 'waived', uid, v_reason);
  elsif p_action = 'uphold' and e.status = 'disputed' then
    perform private.ledger_move(p_entry, 'payable', uid, v_reason);
  else
    raise exception 'Action "%" is not possible for a % entry', p_action, e.status using errcode = '55000';
  end if;
end $$;

create or replace function private.ledger_rows(p_company uuid, p_status text)
returns table (entry_id uuid, company_id uuid, company_name text, application_id uuid, job_title text, candidate_name text, amount_inr integer,
               fee_milestone text, fee_milestone_label text, status text, created_at timestamptz, payable_at timestamptz, closed_at timestamptz,
               payment_reference text, history jsonb)
language sql stable security definer set search_path = '' as $$
  select l.id, l.company_id, c.display_name, l.application_id, j.title, p.display_name, l.amount_inr, l.fee_milestone,
         private.milestone_label(l.fee_milestone), l.status, l.created_at, l.payable_at, l.closed_at, l.payment_reference,
         coalesce((select jsonb_agg(jsonb_build_object('to', ev.to_status, 'reason', ev.reason, 'at', ev.created_at, 'automatic', ev.actor_id is null) order by ev.created_at)
                   from public.hiring_ledger_events ev where ev.entry_id = l.id), '[]'::jsonb)
    from public.hiring_ledger l join public.companies c on c.id = l.company_id
    join public.applications a on a.id = l.application_id join public.jobs j on j.id = a.job_id
    join public.profiles p on p.id = a.candidate_id
   where (p_company is null or l.company_id = p_company) and (p_status is null or l.status = p_status)
   order by l.created_at desc limit 500 $$;

create or replace function public.company_ledger(p_company uuid)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.is_company_member(p_company, array['owner', 'recruiter']::public.company_role[]) then raise exception 'Company not found' using errcode = 'P0002'; end if;
  return query select to_jsonb(r) from private.ledger_rows(p_company, null) r;
end $$;

create or replace function public.admin_ledger(p_status text default null)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin(array['admin']);
  return query select to_jsonb(r) from private.ledger_rows(null, p_status) r;
end $$;

------------------------------------------------------------------------------
-- Privileges and version
------------------------------------------------------------------------------
create or replace function public.schema_version()
returns text language sql immutable set search_path = '' as $$ select '202611260004'::text $$;

revoke all on function public.platform_flags() from public, anon;
grant execute on function public.platform_flags() to authenticated, service_role;
revoke all on function public.admin_set_hire_fee(boolean, integer, text, text) from public, anon;
revoke all on function public.dispute_ledger_entry(uuid, text) from public, anon;
revoke all on function public.admin_ledger_action(uuid, text, text, text) from public, anon;
revoke all on function public.company_ledger(uuid) from public, anon;
revoke all on function public.admin_ledger(text) from public, anon;
grant execute on function public.admin_set_hire_fee(boolean, integer, text, text), public.dispute_ledger_entry(uuid, text),
  public.admin_ledger_action(uuid, text, text, text), public.company_ledger(uuid), public.admin_ledger(text) to authenticated;
revoke all on function private.hire_fee_terms() from public, anon, authenticated;
revoke all on function private.ledger_move(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function private.ledger_on_milestone() from public, anon, authenticated;
revoke all on function private.ledger_rows(uuid, text) from public, anon, authenticated;
revoke all on function private.ledger_events_immutable() from public, anon, authenticated;
revoke all on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated, service_role;
