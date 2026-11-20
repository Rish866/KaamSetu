// One adversarial test per finding in docs/reviews/2026-11-19-210714-pr-2-3.md.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDb, failure, REAL } from './harness.mjs';
import { world, makeCompany, makeJob, makeCandidate } from './fixtures.mjs';

let api, admin, co, job;
const as = (u, sql, p) => api.as(u, async (s) => (await s(sql, p)).rows);
const svc = (sql, p) => api.asService(async (s) => (await s(sql, p)).rows);
async function uploadResume(c, name = 'cv.pdf', size = 1200, sha = null) {
  const path = `${c.id}/${name}`;
  await api.q(`insert into storage.objects (bucket_id,name,owner_id,metadata) values ('resumes',$1,$2,$3::jsonb)`, [path, c.id, JSON.stringify({ size: String(size) })]);
  const id = (await as(c, `select public.register_resume($1,$2,'application/pdf',$3,$4) id`, [path, name, size, sha ?? createHash('sha256').update(path).digest('hex')]))[0].id;
  return { id, path };
}
before(async () => { ({ api, admin } = await world()); co = await makeCompany(api, admin, 'Fix Co'); job = await makeJob(api, admin, co); });

test('upgrade path: v1.3.0 production state migrates cleanly and keeps data', { skip: REAL && 'real Supabase: rehearsed by the CI supabase-db job (scripts/rehearse-upgrade.sh)' }, async () => {
  const old = await createDb({ until: '202611190001' });
  const emp = await old.signUp('employer', 'Legacy Employer'); const cand = await old.signUp('candidate', 'Legacy Candidate');
  // v1.3.0 behaviour: company created directly as pending, candidate profile upserted by the client, a consent row.
  const cid = await old.as(emp, async (s) => (await s(`select public.create_employer_company('Legacy Pvt Ltd','Legacy','Pune',null) id`)).rows[0].id);
  await old.as(cand, (s) => s('insert into public.candidate_profiles (user_id) values ($1)', [cand.id]));
  assert.equal((await old.q('select verification_status s from public.companies where id=$1', [cid])).rows[0].s, 'pending');
  await old.applyMigrations();
  assert.equal(old.applied.at(-1), '202611200004_review_fixes.sql');
  assert.equal((await old.q('select verification_status s from public.companies where id=$1', [cid])).rows[0].s, 'draft', 'legacy pending company returns to draft');
  await old.as(emp, (s) => s(`select public.submit_company_verification($1,'domain','legacy.example')`, [cid]));
  assert.equal((await old.q('select count(*)::int n from public.notification_preferences')).rows[0].n, 2, 'preferences backfilled');
  const access = await old.as(cand, async (s) => (await s('select * from public.current_user_access()')).rows[0]);
  assert.deepEqual([access.account_kind, access.is_admin, access.status], ['candidate', false, 'active'], 'v1.3.0 password-auth RPC still works');
  assert.equal((await old.as(null, async (s) => (await s('select public.schema_version() v')).rows[0].v)), '202611200004');
});

test('migrations are not re-runnable by accident: a second apply of 0004 fails loudly rather than silently', { skip: REAL && 'would mutate the shared real database' }, async () => {
  // Supabase records applied versions and never re-runs them; this documents that 0004 is not idempotent by design.
  const fresh = await createDb();
  const err = await failure(fresh.db.exec((await import('node:fs')).readFileSync(new URL('../../supabase/migrations/202611200004_review_fixes.sql', import.meta.url), 'utf8')));
  assert.ok(err, 'a re-run is detected');
});

test('admin-paused or removed jobs cannot be republished by the employer; reinstate restores control', async () => {
  const j = await makeJob(api, admin, co, { title: 'Held job' });
  await as(admin, `select public.admin_review_job($1,'pause','Reported as misleading')`, [j]);
  assert.match(await failure(as(co.owner, `select public.set_job_status($1,'published')`, [j])) ?? '', /on hold/);
  await as(admin, `select public.admin_review_job($1,'remove','Confirmed misleading')`, [j]);
  assert.match(await failure(as(co.owner, `select public.set_job_status($1,'published')`, [j])) ?? '', /on hold/);
  assert.match(await failure(as(co.owner, `update public.jobs set moderation_hold = null where id=$1`, [j])) ?? '', /permission denied/);
  await as(admin, `select public.admin_review_job($1,'reinstate','Employer corrected the description')`, [j]);
  await as(co.owner, `select public.set_job_status($1,'published')`, [j]);
  // Company suspension holds are lifted on restore, but jobs stay paused until the employer resumes them.
  const c2 = await makeCompany(api, admin, 'Suspend Co'); const j2 = await makeJob(api, admin, c2);
  await as(admin, `select public.admin_review_company($1,'suspend','Fake GSTIN')`, [c2.companyId]);
  await as(admin, `select public.admin_review_company($1,'restore','GSTIN verified again')`, [c2.companyId]);
  assert.equal((await api.q('select status, moderation_hold from public.jobs where id=$1', [j2])).rows[0].status, 'paused');
  await as(c2.owner, `select public.set_job_status($1,'published')`, [j2]);
});

test('outbox: concurrent claims never return the same message; reports require an active lease; stale leases are re-queued', async () => {
  const c = await makeCandidate(api, 'Mail Twice');
  const a = (await as(c, 'select public.apply_to_job($1) id', [job]))[0].id;
  await as(co.owner, `select public.transition_application($1,'shortlisted')`, [a]);
  const [x, y] = await Promise.all([svc('select id from public.outbox_claim(100)'), svc('select id from public.outbox_claim(100)')]);
  const overlap = x.map((r) => r.id).filter((id) => y.some((r) => r.id === id));
  assert.deepEqual(overlap, [], 'no message is handed to two workers');
  const one = [...x, ...y][0].id;
  assert.equal((await svc('select public.outbox_report($1,true) ok', [one]))[0].ok, true);
  assert.equal((await svc('select public.outbox_report($1,true) ok', [one]))[0].ok, false, 'a second report for the same message is ignored');
  assert.equal((await api.q('select status from private.email_outbox where id=$1', [one])).rows[0].status, 'sent');
  const stale = [...x, ...y].find((r) => r.id !== one)?.id;
  if (stale) {
    await api.q(`update private.email_outbox set lease_until = now() - interval '1 minute' where id=$1`, [stale]);
    assert.ok((await svc('select id from public.outbox_claim(100)')).some((r) => r.id === stale), 'crashed send is retried');
  }
  assert.match(await failure(as(c, 'select * from public.outbox_report($1,true)', [one])) ?? '', /permission denied/);
});

test('every user gets a working unsubscribe token at sign-up; late opt-out suppresses already-queued optional mail', async () => {
  const c = await makeCandidate(api, 'Never Visited Settings');
  const tok = (await api.q('select unsubscribe_token t from public.notification_preferences where user_id=$1', [c.id])).rows[0]?.t;
  assert.ok(tok && tok !== '00000000-0000-0000-0000-000000000000');
  const a = (await as(c, 'select public.apply_to_job($1) id', [job]))[0].id;
  await as(co.owner, `select public.transition_application($1,'viewed')`, [a]);
  assert.equal((await svc('select public.unsubscribe_by_token($1) ok', [tok]))[0].ok, true);
  await svc('select * from public.outbox_claim(100)');
  assert.equal((await api.q(`select status from private.email_outbox where recipient_id=$1 and kind='application.viewed'`, [c.id])).rows[0].status, 'suppressed');
});

test('email confirmation and email changes sync into profiles; invitations need a confirmed email', async () => {
  const e = await api.signUp('employer', 'Unconfirmed Recruiter', { email: 'later@example.test', confirmed: false });
  await as(co.owner, `select public.invite_company_member($1,'later@example.test','recruiter')`, [co.companyId]);
  assert.equal((await as(e, 'select * from public.my_company_invitations()')).length, 0);
  await api.q('update auth.users set email_confirmed_at = now() where id=$1', [e.id]);
  assert.equal((await as(e, 'select * from public.my_company_invitations()')).length, 1, 'confirmation is synced');
  await api.q(`update auth.users set email = 'changed@example.test' where id=$1`, [e.id]);
  assert.equal((await api.q('select email from public.profiles where id=$1', [e.id])).rows[0].email, 'changed@example.test');
  assert.ok((await as(e, 'select kind from public.notifications')).some((n) => n.kind === 'security.contact_changed'));
});

test('a failing notification never breaks sign-up or password change', async () => {
  await api.q(`alter table public.notifications add constraint test_block check (kind <> 'account.registered' and kind <> 'security.password_changed') not valid`);
  try {
    const u = await api.signUp('candidate', 'Resilient Signup');
    await api.q(`update auth.users set encrypted_password = 'x' where id=$1`, [u.id]);
    assert.equal((await api.q('select count(*)::int n from public.profiles where id=$1', [u.id])).rows[0].n, 1);
  } finally { await api.q('alter table public.notifications drop constraint test_block'); }
});

test('suspended and deleted accounts cannot upload files', async () => {
  const c = await makeCandidate(api, 'Upload Blocked');
  await as(admin, `select public.admin_set_account_status($1,'suspended','Spam uploads')`, [c.id]);
  assert.ok(await failure(as(c, `insert into storage.objects (bucket_id,name,owner_id) values ('resumes',$1,$2)`, [`${c.id}/x.pdf`, c.id])));
  assert.ok(await failure(as(c, `insert into storage.objects (bucket_id,name,owner_id) values ('profile-photos',$1,$2)`, [`${c.id}/x.png`, c.id])));
});

test('company columns: other users cannot read private verification fields; identity edits lock after approval', async () => {
  const c = await makeCandidate(api, 'Curious');
  assert.match(await failure(as(c, 'select legal_name from public.companies')) ?? '', /permission denied/);
  assert.match(await failure(as(c, 'select verification_reason, registered_address from public.companies')) ?? '', /permission denied/);
  assert.ok((await as(c, 'select display_name from public.companies')).length >= 1);
  assert.match(await failure(as(null, 'select created_by from public.jobs')) ?? '', /permission denied/, 'recruiter ids are not public');
  const m = (await as(co.owner, 'select public.my_membership() m'))[0].m;
  assert.equal(m.role, 'owner'); assert.ok(m.company.legal_name);
  assert.match(await failure(as(co.owner, `select public.update_company_profile($1,'{"display_name":"Totally Different Co"}')`, [co.companyId])) ?? '', /only by KaamSetu support/);
  await as(co.owner, `select public.update_company_profile($1,'{"description":"We build logistics software.","company_size":"11-50","operating_locations":["Pune","Thane"]}')`, [co.companyId]);
  assert.deepEqual((await api.q('select company_size, operating_locations from public.companies where id=$1', [co.companyId])).rows[0], { company_size: '11-50', operating_locations: ['Pune', 'Thane'] });
  assert.match(await failure(as(co.owner, `select public.update_company_profile($1,'{"verification_status":"approved"}')`, [co.companyId])) ?? '', /Unknown field/);
});

test('LIKE wildcards are escaped; skill search is exact; usage quotas apply', async () => {
  const sup = await api.signUp('candidate', 'Support Agent'); await api.grantAdmin(sup, 'support');
  assert.deepEqual(await as(sup, `select * from public.admin_find_user('%%%')`), [], 'a wildcard query does not dump all users');
  await makeCandidate(api, 'Discoverable', { discovery: true });
  assert.deepEqual(await as(co.owner, `select * from public.search_candidates($1,'%')`, [job]), []);
  await api.q(`insert into private.audit_events (actor_id, action, target_type, company_id) select $1, 'candidate.search', 'job', $2 from generate_series(1,60)`, [co.owner.id, co.companyId]);
  assert.match(await failure(as(co.owner, 'select * from public.search_candidates($1)', [job])) ?? '', /Limit reached/);
  const r = await makeCandidate(api, 'Serial Reporter');
  await api.q(`insert into public.abuse_reports (reporter_id, category) select $1, 'other' from generate_series(1,10)`, [r.id]);
  assert.match(await failure(as(r, `select public.report_job($1,'fraud')`, [job])) ?? '', /Limit reached/);
});

test('resume pipeline: quarantine, unavailable scanner, retries, clean, infected, parse consent, purge, leases', async () => {
  const c = await makeCandidate(api, 'Pipeline Pat'); const other = await makeCandidate(api, 'Other Person');
  const r1 = await uploadResume(c, 'one.pdf');
  const work = await svc('select * from public.resume_work_claim(50)');
  assert.ok(work.some((w) => w.resume_id === r1.id && w.task === 'scan'));
  assert.equal((await svc('select * from public.resume_work_claim(50)')).some((w) => w.resume_id === r1.id), false, 'leased work is not handed out twice');
  // No scanner configured: stays quarantined, not downloadable, retried later without burning attempts.
  await svc(`select public.resume_scan_report($1,'unavailable','none')`, [r1.id]);
  let row = (await api.q('select scan_status, scan_detail, scan_attempts from public.resumes where id=$1', [r1.id])).rows[0];
  assert.deepEqual(row, { scan_status: 'pending', scan_detail: 'awaiting_scanner', scan_attempts: 0 });
  assert.deepEqual(await as(c, `select name from storage.objects where bucket_id='resumes'`), [], 'quarantined file is not downloadable by its owner');
  // Scanner errors back off, then fail permanently after 5 attempts.
  for (let i = 0; i < 5; i++) { await api.q('update public.resumes set scan_next_attempt_at = now(), lease_until = null where id=$1', [r1.id]); await svc(`select public.resume_scan_report($1,'error','clamav','timeout')`, [r1.id]); }
  assert.equal((await api.q('select scan_status from public.resumes where id=$1', [r1.id])).rows[0].scan_status, 'failed');
  assert.match(await failure(as(c, `select public.admin_retry_resume_scan($1,'try again')`, [r1.id])) ?? '', /Not authorised/);
  await as(admin, `select public.admin_retry_resume_scan($1,'Scanner outage resolved')`, [r1.id]);
  await svc(`select public.resume_scan_report($1,'clean','clamav','OK')`, [r1.id]);
  assert.deepEqual((await as(c, `select name from storage.objects where bucket_id='resumes'`)).map((x) => x.name), [r1.path], 'clean file is readable by its owner');
  assert.deepEqual(await as(other, `select name from storage.objects where bucket_id='resumes'`), [], 'other candidates cannot read it');
  assert.deepEqual(await as(co.owner, `select name from storage.objects where bucket_id='resumes'`), [], 'employers without an application cannot read it');
  // Parsing without consent is skipped; granting consent re-queues it; results land in review, not in the profile.
  await svc(`select public.resume_parse_report($1,'complete','{"skills":["SQL"]}')`, [r1.id]);
  assert.equal((await api.q('select parse_status from public.resumes where id=$1', [r1.id])).rows[0].parse_status, 'skipped');
  await as(c, `select public.set_consent('resume_parsing', true, '2026-11-20')`);
  assert.equal((await api.q('select parse_status from public.resumes where id=$1', [r1.id])).rows[0].parse_status, 'pending');
  await svc(`select public.resume_parse_report($1,'complete','{"skills":["SQL"]}')`, [r1.id]);
  assert.equal((await as(c, 'select status from public.resume_extractions')).length, 1);
  assert.equal((await api.q(`select count(*)::int n from public.candidate_skills cs join public.skills s on s.id=cs.skill_id where cs.candidate_id=$1 and s.name='SQL'`, [c.id])).rows[0].n, 0, 'nothing applied without review');
  // Infected replacement: blocked, inactive, never downloadable.
  const r2 = await uploadResume(c, 'two.pdf', 1300);
  await svc(`select public.resume_scan_report($1,'infected','clamav','Eicar-Test-Signature')`, [r2.id]);
  assert.deepEqual((await api.q('select scan_status, active from public.resumes where id=$1', [r2.id])).rows[0], { scan_status: 'infected', active: false });
  assert.ok(!(await as(c, `select name from storage.objects where bucket_id='resumes'`)).some((x) => x.name === r2.path));
  // Deletion: soft-deleted, unreadable, then purged by the worker.
  await as(c, 'select public.delete_resume($1)', [r1.id]);
  assert.deepEqual(await as(c, `select name from storage.objects where bucket_id='resumes'`), []);
  assert.ok((await svc('select * from public.resume_work_claim(50)')).some((w) => w.resume_id === r1.id && w.task === 'purge'));
  await svc('select public.resume_mark_purged($1)', [r1.id]);
  for (const fn of [`resume_work_claim(1)`, `resume_scan_report('${r2.id}','clean','x')`, `resume_mark_purged('${r2.id}')`, `privacy_deletions_pending()`])
    assert.match(await failure(as(c, `select * from public.${fn}`)) ?? '', /permission denied/, fn);
});

test('employer resume access follows the application consent rule and is logged', async () => {
  const c = await makeCandidate(api, 'Applicant With CV'); const rival = await makeCompany(api, admin, 'Rival Resume Co');
  const r = await uploadResume(c, 'cv.pdf');
  const a = (await as(c, 'select public.apply_to_job($1) id', [job]))[0].id;
  assert.match(await failure(as(co.owner, 'select public.get_applicant_resume($1)', [a])) ?? '', /No security-checked resume/, 'pending scan blocks access');
  await svc(`select public.resume_scan_report($1,'clean','clamav','OK')`, [r.id]);
  assert.equal((await as(co.owner, 'select public.get_applicant_resume($1) p', [a]))[0].p, r.path);
  assert.deepEqual((await as(co.owner, `select name from storage.objects where bucket_id='resumes'`)).map((x) => x.name), [r.path]);
  assert.deepEqual(await as(rival.owner, `select name from storage.objects where bucket_id='resumes'`), [], 'unrelated company cannot read it');
  assert.match(await failure(as(rival.owner, 'select public.get_applicant_resume($1)', [a])) ?? '', /not found/i);
  assert.ok((await as(c, 'select fields from public.contact_disclosures')).some((d) => d.fields.includes('resume')), 'candidate sees the disclosure');
  await as(c, 'select public.withdraw_application($1)', [a]);
  assert.deepEqual(await as(co.owner, `select name from storage.objects where bucket_id='resumes'`), [], 'withdrawing revokes access');
});

test('contact disclosure reports whether email and phone are verified', async () => {
  const c = await makeCandidate(api, 'Phone Unverified');
  await as(c, `select public.set_consent('contact_sharing', true, '2026-11-20')`);
  const a = (await as(c, 'select public.apply_to_job($1) id', [job]))[0].id;
  await as(co.owner, `select public.transition_application($1,'shortlisted')`, [a]);
  const row = (await as(co.owner, 'select * from public.get_applicant_contact($1)', [a]))[0];
  assert.deepEqual([row.email_verified, row.phone_verified], [true, false]);
});

test('admin dashboard exposes email backlog and quarantined resumes', async () => {
  const d = (await as(admin, 'select public.admin_dashboard() d'))[0].d;
  for (const k of ['email_pending', 'email_failures', 'resumes_quarantined', 'resumes_blocked', 'privacy_cleanup_pending']) assert.ok(k in d, k);
  const st = (await as(admin, 'select public.admin_email_status() s'))[0].s;
  assert.ok('by_status' in st);
});

test('history tables reject DELETE and TRUNCATE, even for the table owner', async () => {
  for (const [t, n] of await Promise.all(['public.consent_records', 'public.application_events', 'public.job_events', 'public.contact_disclosures', 'private.audit_events'].map(async (t) => [t, (await api.q(`select count(*)::int n from ${t}`)).rows[0].n]))) assert.ok(n > 0, `${t} has rows, so the row trigger is exercised`);
  for (const t of ['public.consent_records', 'public.application_events', 'public.job_events', 'public.contact_disclosures', 'private.audit_events']) {
    assert.match(await failure(api.q(`delete from ${t}`)) ?? '', /immutable/, `delete on ${t}`);
    assert.match(await failure(api.q(`truncate ${t} cascade`)) ?? '', /cannot be truncated/, `truncate on ${t}`);
  }
});
