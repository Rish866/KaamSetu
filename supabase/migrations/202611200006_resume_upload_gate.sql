-- Resume uploads are switched OFF until a malware scanner has been verified in production, so no resume can sit in
-- quarantine indefinitely. An administrator switches them on (audited) after the scanner has processed a test file.
-- Scans that wait too long fail with a clear message instead of staying quarantined forever.

create table if not exists private.settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table private.settings enable row level security;
revoke all on private.settings from anon, authenticated, service_role;
insert into private.settings (key, value) values
  ('resume_uploads_enabled', 'false'::jsonb),
  ('scan_timeout_hours', '24'::jsonb)
on conflict (key) do nothing;

create or replace function private.setting(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select value from private.settings where key = p_key;
$$;

create or replace function private.resume_uploads_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((private.setting('resume_uploads_enabled'))::text::boolean, false);
$$;

-- Public, non-sensitive flags the app needs before rendering upload controls.
create or replace function public.platform_flags()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('resume_uploads_enabled', private.resume_uploads_enabled());
$$;

create or replace function public.admin_set_resume_uploads(p_enabled boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(array['admin']); v_reason text := private.require_reason(p_reason, 10);
begin
  insert into private.settings (key, value, updated_by, updated_at) values ('resume_uploads_enabled', to_jsonb(p_enabled), uid, now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform private.audit('settings.resume_uploads', 'setting', null, null, jsonb_build_object('enabled', p_enabled, 'reason', v_reason));
end $$;

-- Uploading into the private bucket is refused while uploads are off.
drop policy if exists resume_object_insert on storage.objects;
create policy resume_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text
              and lower(name) ~ '\.(pdf|docx)$' and private.user_is_active() and private.resume_uploads_enabled());

create or replace function public.register_resume(p_path text, p_name text, p_mime text, p_size integer, p_sha256 text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); rid uuid; actual bigint; obj record;
begin
  if not private.resume_uploads_enabled() then
    raise exception 'Resume upload is temporarily unavailable while virus scanning is being set up' using errcode = '55000';
  end if;
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

-- Service-only: scans still pending after the timeout fail visibly; the candidate is told to try again later.
create or replace function public.resume_expire_stale_scans()
returns integer language plpgsql security definer set search_path = '' as $$
declare hours int := coalesce((private.setting('scan_timeout_hours'))::text::int, 24); n int := 0; r record;
begin
  if (select auth.uid()) is not null then raise exception 'Not authorised' using errcode = '42501'; end if;
  for r in select id, candidate_id from public.resumes
           where deleted_at is null and scan_status = 'pending' and created_at < now() - make_interval(hours => hours) for update skip locked loop
    update public.resumes set scan_status = 'failed', active = false, scan_detail = 'scan_timeout', scanned_at = now(), lease_until = null where id = r.id;
    perform private.notify(r.candidate_id, 'resume.blocked', 'Your resume could not be checked', 'Open KaamSetu to upload it again.');
    insert into private.audit_events (actor_id, action, target_type, target_id) values (null, 'resume.scan.timeout', 'resume', r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.schema_version()
returns text language sql immutable set search_path = '' as $$ select '202611200006'::text $$;

revoke all on function public.platform_flags() from public, anon;
grant execute on function public.platform_flags() to authenticated, service_role;
revoke all on function public.admin_set_resume_uploads(boolean, text) from public, anon;
grant execute on function public.admin_set_resume_uploads(boolean, text) to authenticated;
revoke all on function public.register_resume(text, text, text, integer, text) from public, anon;
grant execute on function public.register_resume(text, text, text, integer, text) to authenticated;
revoke all on function public.resume_expire_stale_scans() from public, anon, authenticated;
grant execute on function public.resume_expire_stale_scans() to service_role;
revoke all on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated, service_role;
revoke all on function private.setting(text) from public, anon, authenticated;
revoke all on function private.resume_uploads_enabled() from public, anon;
grant execute on function private.resume_uploads_enabled() to authenticated;
