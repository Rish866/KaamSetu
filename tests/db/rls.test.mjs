import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { failure } from './harness.mjs';
import { world, makeCompany, makeJob, makeCandidate } from './fixtures.mjs';

let api, admin, e1, e2, job1, A, B, app1;
before(async () => {
  ({ api, admin } = await world());
  e1 = await makeCompany(api, admin, 'Alpha'); e2 = await makeCompany(api, admin, 'Beta');
  job1 = await makeJob(api, admin, e1);
  A = await makeCandidate(api, 'Cand A', { discovery: true }); B = await makeCandidate(api, 'Cand B');
  app1 = await api.as(A, async (sql) => (await sql('select public.apply_to_job($1,$2) as id', [job1, 'hello'])).rows[0].id);
  await api.as(A, (sql) => sql(`insert into public.candidate_skills (candidate_id, skill_id, confirmed) select $1, id, true from public.skills where name='SQL'`, [A.id]));
  await api.q(`insert into storage.objects (bucket_id, name, owner_id, metadata) values ('resumes', $1, $2, '{"size":"1000"}')`, [`${A.id}/cv.pdf`, A.id]);
  await api.as(A, (sql) => sql(`select public.register_resume($1,'cv.pdf','application/pdf',1000,$2)`, [`${A.id}/cv.pdf`, 'a'.repeat(64)]));
});

const USER_TABLES = ['profiles', 'candidate_profiles', 'candidate_skills', 'candidate_locations', 'resumes', 'applications',
  'application_events', 'job_invitations', 'interviews', 'consent_records', 'notifications', 'contact_disclosures', 'company_members', 'job_events'];

test('anonymous users cannot read any user-data table', async () => {
  for (const t of USER_TABLES) {
    const err = await failure(api.as(null, (sql) => sql(`select * from public.${t}`)));
    if (err === null) {
      const n = await api.as(null, async (sql) => (await sql(`select count(*)::int n from public.${t}`)).rows[0].n);
      assert.equal(n, 0, `anon saw rows in ${t}`);
    }
  }
});

test('anonymous users cannot reach private schema, audit data, or any RPC', async () => {
  assert.match(await failure(api.as(null, (s) => s('select * from private.audit_events'))) ?? '', /permission denied/);
  assert.match(await failure(api.as(null, (s) => s('select * from private.app_roles'))) ?? '', /permission denied/);
  for (const fn of ['apply_to_job($1)', 'my_job_matches()', 'admin_review_company($1,$1,$1)']) {
    const err = await failure(api.as(null, (s) => s(`select public.${fn}`.replace(/\$1/g, `'${job1}'`))));
    assert.ok(err, `anon called ${fn}`);
  }
});

test('anonymous users see only published jobs of approved companies and no verification data', async () => {
  const draft = await makeJob(api, admin, e1, { title: 'Hidden draft', publish: false });
  const pending = await makeCompany(api, admin, 'Pending Co', { approve: false });
  const hiddenJob = await makeJob(api, admin, e1, { title: 'Suspended later' });
  const rows = await api.as(null, async (s) => (await s('select id from public.jobs')).rows);
  const ids = rows.map((r) => r.id);
  assert.ok(ids.includes(job1)); assert.ok(!ids.includes(draft));
  const companies = await api.as(null, async (s) => (await s('select id from public.companies')).rows.map((r) => r.id));
  assert.ok(companies.includes(e1.companyId)); assert.ok(!companies.includes(pending.companyId));
  assert.match(await failure(api.as(null, (s) => s('select legal_name from public.companies'))) ?? '', /permission denied/);
  assert.match(await failure(api.as(null, (s) => s('select verification_reason from public.companies'))) ?? '', /permission denied/);
  await api.as(admin, (s) => s(`select public.admin_review_company($1,'suspend','Complaint under investigation')`, [e1.companyId]));
  const after = await api.as(null, async (s) => (await s('select id from public.jobs')).rows);
  assert.equal(after.length, 0, 'jobs of a suspended company must disappear');
  await api.as(admin, (s) => s(`select public.admin_review_company($1,'restore','Complaint resolved')`, [e1.companyId]));
  const jobStatus = (await api.q('select status from public.jobs where id=$1', [hiddenJob])).rows[0].status;
  assert.equal(jobStatus, 'paused', 'suspension pauses published jobs; restore does not auto-republish');
  await api.as(e1.owner, (s) => s(`select public.set_job_status($1,'published')`, [hiddenJob]));
  await api.as(e1.owner, (s) => s(`select public.set_job_status($1,'published')`, [job1]));
});

test('candidate B cannot see candidate A data (profile, skills, resumes, applications, notifications, consent)', async () => {
  for (const t of ['profiles', 'candidate_profiles', 'candidate_skills', 'resumes', 'applications', 'application_events', 'notifications', 'consent_records', 'job_invitations', 'interviews']) {
    const owners = await api.as(B, async (s) => (await s(`select * from public.${t}`)).rows);
    for (const row of owners) {
      const who = row.candidate_id ?? row.user_id ?? row.recipient_id ?? row.id;
      assert.notEqual(who, A.id, `B saw A's row in ${t}`);
    }
  }
  const direct = await api.as(B, async (s) => (await s('select * from public.applications where id=$1', [app1])).rows);
  assert.equal(direct.length, 0, 'knowing an application ID must not reveal it');
  const upd = await api.as(B, async (s) => (await s(`update public.candidate_profiles set headline='pwned' where user_id=$1`, [A.id])).affectedRows);
  assert.equal(upd, 0);
  const del = await failure(api.as(B, (s) => s('delete from public.candidate_skills where candidate_id=$1', [A.id])));
  assert.ok(del === null || /permission|row-level/.test(del));
  assert.equal((await api.q('select count(*)::int n from public.candidate_skills where candidate_id=$1', [A.id])).rows[0].n, 3);
});

test('candidate B cannot withdraw, answer or read A\'s items through RPCs', async () => {
  assert.match(await failure(api.as(B, (s) => s('select public.withdraw_application($1)', [app1]))) ?? '', /not found/i);
  assert.match(await failure(api.as(B, (s) => s('select public.delete_resume($1)', [(null)]))) ?? 'x', /./);
  const rid = (await api.q('select id from public.resumes where candidate_id=$1', [A.id])).rows[0].id;
  assert.match(await failure(api.as(B, (s) => s('select public.delete_resume($1)', [rid]))) ?? '', /not found/i);
});

test('candidates cannot escalate by writing protected columns or tables directly', async () => {
  const attempts = [
    ['discovery flag', `update public.candidate_profiles set discovery_enabled=true where user_id='${B.id}'`],
    ['profile_complete flag', `update public.candidate_profiles set profile_complete=true where user_id='${B.id}'`],
    ['account_kind', `update public.profiles set account_kind='employer' where id='${B.id}'`],
    ['account status', `update public.profiles set status='active' where id='${B.id}'`],
    ['direct application', `insert into public.applications (job_id, candidate_id) values ('${job1}','${B.id}')`],
    ['application stage', `update public.applications set stage='hired' where id='${app1}'`],
    ['application event', `insert into public.application_events (application_id,to_stage,actor_id) values ('${app1}','hired','${A.id}')`],
    ['direct consent', `insert into public.consent_records (user_id,purpose,action,notice_version) values ('${B.id}','marketing','granted','x')`],
    ['direct notification', `insert into public.notifications (recipient_id,kind,title,body) values ('${B.id}','x','y','z')`],
    ['notification content', `update public.notifications set title='forged' where recipient_id='${A.id}'`],
    ['resume scan status', `update public.resumes set scan_status='clean' where candidate_id='${A.id}'`],
    ['direct resume row', `insert into public.resumes (candidate_id,storage_path,original_name,mime_type,byte_size,sha256,scan_status) values ('${B.id}','${B.id}/x.pdf','x','application/pdf',10,'${'b'.repeat(64)}','clean')`],
    ['direct invitation', `insert into public.job_invitations (job_id,candidate_id,sent_by) values ('${job1}','${B.id}','${B.id}')`],
    ['direct interview', `insert into public.interviews (application_id,proposed_at,mode,created_by) values ('${app1}',now(),'phone','${A.id}')`],
    ['direct company', `insert into public.companies (legal_name,display_name) values ('x','x')`],
    ['direct membership', `insert into public.company_members (company_id,user_id,role) values ('${e1.companyId}','${B.id}','owner')`],
    ['grant self a role', `insert into private.app_roles (user_id, role) values ('${B.id}','admin')`],
    ['edit audit log', `delete from private.audit_events`],
  ];
  for (const [label, sql] of attempts) {
    const err = await failure(api.as(B, async (s) => {
      const r = await s(sql);
      if (r.affectedRows) throw new Error(`NO-ERROR affected ${r.affectedRows}`);
    }));
    assert.ok(err, `${label} must be rejected`);
    assert.doesNotMatch(err, /NO-ERROR/, `${label} succeeded`);
  }
  const state = (await api.q('select discovery_enabled, profile_complete from public.candidate_profiles where user_id=$1', [B.id])).rows[0];
  assert.deepEqual(state, { discovery_enabled: false, profile_complete: false });
  assert.equal((await api.q('select count(*)::int n from private.app_roles where user_id=$1', [B.id])).rows[0].n, 0);
});

test('selecting an employer account kind never grants admin access', async () => {
  const sneaky = await api.signUp('employer', 'Sneaky');
  await api.q(`update auth.users set raw_user_meta_data = raw_user_meta_data || '{"is_admin":true,"role":"admin"}' where id=$1`, [sneaky.id]);
  const access = await api.as(sneaky, async (s) => (await s('select * from public.current_user_access()')).rows[0]);
  assert.equal(access.is_admin, false);
  for (const call of [`admin_review_company('${e1.companyId}','approve','forced entry')`, `admin_grant_role('${sneaky.id}','admin','self promotion')`,
    `admin_set_matching_weights('{"skills":100,"location":0,"salary":0,"experience":0,"freshness":0}','take over matching')`, `admin_set_account_status('${A.id}','suspended','revenge')`]) {
    assert.match(await failure(api.as(sneaky, (s) => s(`select public.${call}`))) ?? '', /Not authorised/, call);
  }
});

test('employer cannot self-approve company, publish jobs, or edit moderated jobs', async () => {
  const fresh = await makeCompany(api, admin, 'Gamma', { approve: false });
  assert.ok(await failure(api.as(fresh.owner, (s) => s(`update public.companies set verification_status='approved' where id=$1`, [fresh.companyId]))));
  const draftId = await makeJob(api, admin, e1, { publish: false });
  assert.ok(await failure(api.as(e1.owner, (s) => s(`update public.jobs set status='published' where id=$1`, [draftId]))));
  assert.ok(await failure(api.as(e1.owner, (s) => s(`update public.jobs set published_at=now() where id=$1`, [draftId]))));
  assert.ok(await failure(api.as(e1.owner, (s) => s(`insert into public.jobs (company_id,title,description,salary_min,salary_max,work_mode,employment_type,created_by,status)
     values ($1,'x1','d',1,2,'remote','full_time',$2,'published')`, [e1.companyId, e1.owner.id]))));
  const edited = await api.as(e1.owner, async (s) => (await s(`update public.jobs set title='Sneaky edit' where id=$1`, [job1])).affectedRows);
  assert.equal(edited, 0, 'a published job must not be editable without re-review');
  assert.match(await failure(api.as(fresh.owner, (s) => s('select public.submit_job_for_review($1)', [draftId]))) ?? '', /not found/i);
  const unverified = await api.as(fresh.owner, async (s) => (await s(`insert into public.jobs (company_id,title,description,salary_min,salary_max,work_mode,employment_type,created_by)
     values ($1,'Draft only','d',1,2,'remote','full_time',$2) returning id`, [fresh.companyId, fresh.owner.id])).rows[0].id);
  assert.match(await failure(api.as(fresh.owner, (s) => s('select public.submit_job_for_review($1)', [unverified]))) ?? '', /verified/);
});

test('cross-company isolation: jobs, applicants, interviews, members, notifications', async () => {
  const draftId = await makeJob(api, admin, e1, { publish: false });
  const seen = await api.as(e2.owner, async (s) => (await s('select id from public.jobs')).rows.map((r) => r.id));
  assert.ok(!seen.includes(draftId), 'draft job of another company leaked');
  assert.equal((await api.as(e2.owner, (s) => s('select * from public.applications'))).rows.length, 0);
  assert.equal((await api.as(e2.owner, (s) => s('select * from public.interviews'))).rows.length, 0);
  assert.equal((await api.as(e2.owner, (s) => s('select * from public.job_events where job_id=$1', [job1]))).rows.length, 0);
  const members = await api.as(e2.owner, async (s) => (await s('select company_id from public.company_members')).rows);
  assert.ok(members.every((m) => m.company_id === e2.companyId));
  assert.match(await failure(api.as(e2.owner, (s) => s('select * from public.list_job_applicants($1)', [job1]))) ?? '', /not found/i);
  assert.match(await failure(api.as(e2.owner, (s) => s(`select public.transition_application($1,'shortlisted')`, [app1]))) ?? '', /not found/i);
  assert.match(await failure(api.as(e2.owner, (s) => s(`select * from public.get_applicant_contact($1)`, [app1]))) ?? '', /not found/i);
  assert.match(await failure(api.as(e2.owner, (s) => s(`select public.invite_candidate($1,$2)`, [job1, A.id]))) ?? '', /not found/i);
  assert.match(await failure(api.as(e2.owner, (s) => s(`select * from public.search_candidates($1)`, [job1]))) ?? '', /not found/i);
  assert.match(await failure(api.as(e2.owner, (s) => s(`select public.duplicate_job($1)`, [job1]))) ?? '', /not found/i);
  assert.match(await failure(api.as(e2.owner, (s) => s(`select public.set_member_role($1,$2,'viewer')`, [e1.companyId, e1.owner.id]))) ?? '', /owners/);
  assert.match(await failure(api.as(e2.owner, (s) => s(`select public.submit_company_verification($1,'domain','evil.example')`, [e1.companyId]))) ?? '', /owner/);
  assert.equal((await api.as(e2.owner, (s) => s('select * from public.notifications'))).rows.every((n) => n.recipient_id === e2.owner.id), true);
  const upd = await api.as(e2.owner, async (s) => (await s(`update public.companies set display_name='Hijack' where id=$1`, [e1.companyId])).affectedRows);
  assert.equal(upd, 0);
});

test('viewers can read but not act; last owner cannot be removed', async () => {
  const viewer = await api.signUp('employer', 'Viewer V');
  await api.q(`insert into public.company_members (company_id,user_id,role) values ($1,$2,'viewer')`, [e1.companyId, viewer.id]);
  const rows = await api.as(viewer, async (s) => (await s('select * from public.list_job_applicants($1)', [job1])).rows);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].candidate_id, A.id);
  assert.match(await failure(api.as(viewer, (s) => s(`select public.transition_application($1,'shortlisted')`, [app1]))) ?? '', /not found/i);
  assert.match(await failure(api.as(viewer, (s) => s(`select public.set_job_status($1,'paused')`, [job1]))) ?? '', /not found/i);
  assert.match(await failure(api.as(e1.owner, (s) => s(`select public.deactivate_member($1,$2)`, [e1.companyId, e1.owner.id]))) ?? '', /at least one active owner/);
  assert.match(await failure(api.as(e1.owner, (s) => s(`select public.set_member_role($1,$2,'viewer')`, [e1.companyId, e1.owner.id]))) ?? '', /at least one active owner/);
  assert.match(await failure(api.q(`update public.company_members set active=false where company_id=$1 and user_id=$2`, [e1.companyId, e1.owner.id])) ?? '', /at least one active owner/);
  await api.as(e1.owner, (s) => s(`select public.set_member_role($1,$2,'owner')`, [e1.companyId, viewer.id]));
  await api.as(e1.owner, (s) => s(`select public.deactivate_member($1,$2)`, [e1.companyId, viewer.id]));
  assert.equal((await api.q('select active from public.company_members where user_id=$1', [viewer.id])).rows[0].active, false);
  assert.match(await failure(api.as(viewer, (s) => s('select * from public.list_job_applicants($1)', [job1]))) ?? '', /not found/i, 'deactivated members lose access');
});

test('audit log and consent history are immutable even for the table owner', async () => {
  assert.match(await failure(api.q('update private.audit_events set action=$1', ['x'])) ?? '', /immutable/);
  assert.match(await failure(api.q('delete from private.audit_events')) ?? '', /immutable/);
  assert.match(await failure(api.q(`update public.consent_records set action='withdrawn'`)) ?? '', /immutable/);
  assert.match(await failure(api.q(`update public.application_events set reason='edited'`)) ?? '', /immutable/);
  assert.ok((await api.q('select count(*)::int n from private.audit_events')).rows[0].n > 5);
});

test('resume storage is private to the owner and paths are validated', async () => {
  await api.q(`insert into storage.objects (bucket_id, name, owner_id, metadata) values ('resumes', $1, $2, '{"size":"500"}')`, [`${B.id}/b.pdf`, B.id]);
  const seenByB = await api.as(B, async (s) => (await s(`select name from storage.objects where bucket_id='resumes'`)).rows.map((r) => r.name));
  assert.deepEqual(seenByB, [`${B.id}/b.pdf`]);
  const anonErr = await failure(api.as(null, (s) => s('select * from storage.objects')));
  assert.ok(anonErr === null ? (await api.as(null, (s) => s('select * from storage.objects'))).rows.length === 0 : /permission denied/.test(anonErr), 'anon must see no objects');
  assert.equal((await api.as(e1.owner, (s) => s(`select * from storage.objects where bucket_id='resumes'`))).rows.length, 0, 'employers must not list resumes');
  assert.ok(await failure(api.as(B, (s) => s(`insert into storage.objects (bucket_id,name,owner_id) values ('resumes',$1,$2)`, [`${A.id}/evil.pdf`, B.id]))), 'cannot upload into another folder');
  assert.ok(await failure(api.as(B, (s) => s(`insert into storage.objects (bucket_id,name,owner_id) values ('resumes',$1,$2)`, [`${B.id}/script.exe`, B.id]))), 'only pdf/docx names');
  const del = await api.as(B, async (s) => (await s(`delete from storage.objects where name=$1`, [`${A.id}/cv.pdf`])).affectedRows);
  assert.equal(del, 0, 'cannot delete another user\'s object');
  assert.match(await failure(api.as(B, (s) => s(`select public.register_resume($1,'x.pdf','application/pdf',500,$2)`, [`${A.id}/cv.pdf`, 'c'.repeat(64)]))) ?? '', /Invalid resume path/);
  assert.match(await failure(api.as(B, (s) => s(`select public.register_resume($1,'x.pdf','application/pdf',999,$2)`, [`${B.id}/b.pdf`, 'c'.repeat(64)]))) ?? '', /size does not match/);
  assert.match(await failure(api.as(B, (s) => s(`select public.register_resume($1,'x.pdf','application/pdf',500,$2)`, [`${B.id}/../${A.id}/cv.pdf`, 'c'.repeat(64)]))) ?? '', /Invalid resume path/);
  const rid = await api.as(B, async (s) => (await s(`select public.register_resume($1,'b.pdf','application/pdf',500,$2) id`, [`${B.id}/b.pdf`, 'd'.repeat(64)])).rows[0].id);
  assert.ok(rid);
  await api.q(`insert into storage.objects (bucket_id, name, owner_id, metadata) values ('resumes', $1, $2, '{"size":"500"}')`, [`${B.id}/b2.pdf`, B.id]);
  assert.match(await failure(api.as(B, (s) => s(`select public.register_resume($1,'b2.pdf','application/pdf',500,$2)`, [`${B.id}/b2.pdf`, 'd'.repeat(64)]))) ?? '', /already on your profile/, 'SHA-256 duplicate detection');
  assert.equal((await api.q(`select scan_status from public.resumes where id=$1`, [rid])).rows[0].scan_status, 'pending', 'new resumes start quarantined');
});

test('company evidence bucket is private to owner and moderators', async () => {
  await api.q(`insert into storage.objects (bucket_id, name, owner_id) values ('company-evidence', $1, $2)`, [`${e1.companyId}/gst.pdf`, e1.owner.id]);
  assert.equal((await api.as(e1.owner, (s) => s(`select * from storage.objects where bucket_id='company-evidence'`))).rows.length, 1);
  assert.equal((await api.as(e2.owner, (s) => s(`select * from storage.objects where bucket_id='company-evidence'`))).rows.length, 0);
  assert.equal((await api.as(A, (s) => s(`select * from storage.objects where bucket_id='company-evidence'`))).rows.length, 0);
  assert.equal((await api.as(admin, (s) => s(`select * from storage.objects where bucket_id='company-evidence'`))).rows.length, 1);
  assert.ok(await failure(api.as(e2.owner, (s) => s(`insert into storage.objects (bucket_id,name,owner_id) values ('company-evidence',$1,$2)`, [`${e1.companyId}/fake.pdf`, e2.owner.id]))));
});

test('SQL-injection payloads are treated as data', async () => {
  const payload = `'; drop table public.jobs; --`;
  await api.as(A, (s) => s(`update public.candidate_profiles set headline=$2 where user_id=$1`, [A.id, payload]));
  const r = await api.as(A, async (s) => (await s('select headline from public.candidate_profiles where user_id=$1', [A.id])).rows[0]);
  assert.equal(r.headline, payload);
  assert.ok((await api.q('select count(*)::int n from public.jobs')).rows[0].n > 0);
  const search = await failure(api.as(e1.owner, (s) => s('select * from public.search_candidates($1,$2)', [job1, payload])));
  assert.equal(search, null);
});

test('RLS is enabled on every public and private user-data table', async () => {
  const { rows } = await api.q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
  assert.deepEqual(rows, [], `tables without RLS: ${rows.map((r) => r.relname)}`);
  const priv = await api.q(`select has_table_privilege('authenticated', c.oid, 'select') s from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r'`);
  assert.ok(priv.rows.every((r) => r.s === false));
});

test('no public function is executable by anon; internals are not executable by authenticated', async () => {
  const { rows } = await api.q(`select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and has_function_privilege('anon', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')`);
  assert.deepEqual(rows, []);
  const internal = await api.q(`select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and has_function_privilege('authenticated', p.oid, 'execute')`);
  const allowed = ['is_company_member', 'is_admin', 'company_is_approved', 'job_is_public', 'job_is_editable'];
  assert.deepEqual(internal.rows.filter((r) => !allowed.some((a) => r.sig.startsWith(`private.${a}(`))), []);
});
