import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { failure } from './harness.mjs';
import { world, makeCompany, makeJob, makeCandidate, skill } from './fixtures.mjs';

let api, admin, co, jobA, jobB, cand, other;
const rpc = (u, sql, p) => api.as(u, async (s) => (await s(sql, p)).rows);
before(async () => {
  ({ api, admin } = await world());
  co = await makeCompany(api, admin, 'Prod Co');
  jobA = await makeJob(api, admin, co, { title: 'Customer Success Executive', city: 'Navi Mumbai', salary_min: 600000, salary_max: 800000 });
  jobB = await makeJob(api, admin, co, { title: 'Backend Developer', city: 'Pune', skills: ['SQL', 'JavaScript'], salary_min: 1200000, salary_max: 1800000, work_mode: 'onsite' });
  cand = await makeCandidate(api, 'Product Cand', { discovery: true });
  other = await makeCandidate(api, 'Other Cand');
});

test('job feed: search by title/skill/company, filters, sorting, saved jobs', async () => {
  const feed = (args = {}) => rpc(cand, 'select * from public.job_feed($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [args.q ?? null, args.city ?? null, null, args.minSalary ?? null, null, args.mode ?? null, null, null, args.sort ?? 'match', args.saved ?? false]);
  assert.equal((await feed()).length, 2);
  assert.deepEqual((await feed({ q: 'backend' })).map((r) => r.job_id), [jobB]);
  assert.deepEqual((await feed({ q: 'javascript' })).map((r) => r.job_id), [jobB], 'skill search');
  assert.equal((await feed({ q: 'prod co' })).length, 2, 'company search');
  assert.deepEqual((await feed({ city: 'Pune' })).map((r) => r.job_id), [jobB]);
  assert.deepEqual((await feed({ minSalary: 1500000 })).map((r) => r.job_id), [jobB]);
  assert.deepEqual((await feed({ mode: 'hybrid' })).map((r) => r.job_id), [jobA]);
  const bySalary = await feed({ sort: 'salary' }); assert.equal(bySalary[0].job_id, jobB);
  const byMatch = await feed(); assert.equal(byMatch[0].job_id, jobA, 'local, skill-matching job ranks first');
  assert.ok(byMatch[0].eligible && byMatch[0].match.components.skills.explanation);
  assert.equal(byMatch[0].company_verified, true);
  assert.equal(await api.as(cand, async (s) => (await s('select public.toggle_saved_job($1) v', [jobB])).rows[0].v), true);
  assert.deepEqual((await feed({ saved: true })).map((r) => r.job_id), [jobB]);
  assert.equal(await api.as(cand, async (s) => (await s('select public.toggle_saved_job($1) v', [jobB])).rows[0].v), false);
  assert.equal((await rpc(other, 'select * from public.saved_jobs')).length, 0);
  assert.match(await failure(api.as(null, (s) => s('select * from public.job_feed()'))) ?? '', /permission denied/);
});

test('job detail, application timeline and invitations views', async () => {
  const d = (await rpc(cand, 'select public.job_detail($1) d', [jobA]))[0].d;
  assert.equal(d.title, 'Customer Success Executive'); assert.equal(d.salary_max, 800000); assert.equal(d.company.verified, true);
  assert.ok(d.match.score >= 0 && d.skills.length === 2 && d.application_id === null);
  assert.equal((await rpc(cand, 'select public.job_detail($1) d', ['00000000-0000-0000-0000-000000000000']))[0].d, null);
  const id = (await rpc(cand, 'select public.apply_to_job($1,$2) id', [jobA, 'note']))[0].id;
  await api.as(co.owner, (s) => s(`select public.transition_application($1,'viewed')`, [id]));
  const apps = (await rpc(cand, 'select public.my_applications() a'))[0].a;
  assert.equal(apps.length, 1); assert.equal(apps[0].stage, 'viewed');
  assert.deepEqual(apps[0].timeline.map((t) => t.stage), ['applied', 'viewed']);
  assert.deepEqual((await rpc(other, 'select public.my_applications() a'))[0].a, []);
  assert.equal((await rpc(cand, 'select public.my_invitations() a'))[0].a.length, 0);
  // jobs closed after applying remain viewable for the applicant but not for others
  await api.as(co.owner, (s) => s(`select public.set_job_status($1,'closed')`, [jobA]));
  assert.ok((await rpc(cand, 'select public.job_detail($1) d', [jobA]))[0].d);
  assert.equal((await rpc(other, 'select public.job_detail($1) d', [jobA]))[0].d, null);
  await api.as(co.owner, (s) => s(`select public.set_job_status($1,'published')`, [jobA]));
});

test('profile sections are private, validated, and drive completion', async () => {
  const c = await makeCandidate(api, 'Complete Me', { skills: ['CRM'] });
  const pct = async () => (await rpc(c, 'select public.my_profile_completion() p'))[0].p;
  const before = await pct(); assert.ok(before.percent < 100 && before.missing.includes('education') && before.missing.includes('resume'));
  await api.as(c, async (s) => {
    await s(`insert into public.candidate_education (candidate_id, institution, qualification, start_year, end_year) values ($1,'Mumbai University','B.Com',2015,2018)`, [c.id]);
    await s(`insert into public.candidate_experience (candidate_id, company_name, title, start_date) values ($1,'Acme','Executive','2019-01-01')`, [c.id]);
    await s(`insert into public.candidate_certifications (candidate_id, name) values ($1,'Customer Service Basics')`, [c.id]);
    await s(`insert into public.candidate_languages (candidate_id, language, proficiency) values ($1,'English','fluent')`, [c.id]);
    await s(`update public.candidate_profiles set employment_status='employed' where user_id=$1`, [c.id]);
    for (const n of ['Customer support', 'English']) await s('insert into public.candidate_skills (candidate_id, skill_id, confirmed) values ($1,$2,true)', [c.id, await skill(api, n)]);
  });
  assert.ok(!(await pct()).missing.includes('education'));
  assert.ok(await failure(api.as(c, (s) => s(`insert into public.candidate_education (candidate_id, institution, qualification, start_year, end_year) values ($1,'X University','MBA',2020,2018)`, [c.id]))), 'end before start rejected');
  assert.ok(await failure(api.as(c, (s) => s(`insert into public.candidate_education (candidate_id, institution, qualification) values ($1,'Evil Univ','Fake')`, [other.id]))), 'cannot write into someone else profile');
  assert.equal((await rpc(other, 'select * from public.candidate_education')).length, 0);
  assert.ok(await failure(api.as(c, (s) => s(`update public.candidate_profiles set photo_path=$2 where user_id=$1`, [c.id, `${other.id}/me.png`]))), 'photo path must be in own folder');
  await api.q(`insert into storage.objects (bucket_id,name,owner_id,metadata) values ('resumes',$1,$2,'{"size":"900"}')`, [`${c.id}/cv.pdf`, c.id]);
  await api.as(c, (s) => s(`select public.register_resume($1,'cv.pdf','application/pdf',900,$2)`, [`${c.id}/cv.pdf`, 'e'.repeat(64)]));
  assert.deepEqual(await pct(), { percent: 100, missing: [] });
  assert.equal((await api.q('select profile_complete from public.candidate_profiles where user_id=$1', [c.id])).rows[0].profile_complete, true);
});

test('resume extraction is applied only after consent and explicit acceptance', async () => {
  const c = await makeCandidate(api, 'Parse Me', { skills: [] });
  await api.q(`insert into storage.objects (bucket_id,name,owner_id,metadata) values ('resumes',$1,$2,'{"size":"800"}')`, [`${c.id}/p.pdf`, c.id]);
  const rid = (await rpc(c, `select public.register_resume($1,'p.pdf','application/pdf',800,$2) id`, [`${c.id}/p.pdf`, 'f'.repeat(64)]))[0].id;
  await api.q(`insert into public.resume_extractions (resume_id, candidate_id, data) values ($1,$2,'{"skills":["CRM","SQL"],"headline":"Ops lead"}')`, [rid, c.id]);
  assert.match(await failure(api.as(c, (s) => s(`select public.accept_resume_extraction($1,'{CRM}')`, [rid]))) ?? '', /consent/);
  assert.equal((await api.q('select count(*)::int n from public.candidate_skills where candidate_id=$1', [c.id])).rows[0].n, 0, 'nothing imported without review');
  await api.as(c, (s) => s(`select public.set_consent('resume_parsing', true, '2026-11-18')`));
  assert.match(await failure(api.as(other, (s) => s(`select public.accept_resume_extraction($1,'{CRM}')`, [rid]))) ?? '', /consent|Nothing to review/);
  await api.as(c, (s) => s(`select public.accept_resume_extraction($1,'{CRM}','Ops lead')`, [rid]));
  assert.deepEqual((await api.q(`select s.name from public.candidate_skills cs join public.skills s on s.id=cs.skill_id where candidate_id=$1`, [c.id])).rows.map((r) => r.name), ['CRM']);
  assert.equal((await rpc(other, 'select * from public.resume_extractions')).length, 0);
});

test('data export contains only the caller\'s data; deletion anonymises and frees identifiers', async () => {
  const c = await makeCandidate(api, 'Export Me', { discovery: true });
  const a = (await rpc(c, 'select public.apply_to_job($1) id', [jobB]))[0].id;
  const dump = (await rpc(c, 'select public.request_data_export() d'))[0].d;
  const text = JSON.stringify(dump);
  assert.equal(dump.account.email, c.email); assert.equal(dump.applications.length, 1); assert.ok(dump.consents.length >= 2);
  for (const forbidden of [other.email, other.phone, cand.email, 'storage_path']) assert.ok(!text.includes(forbidden), `export leaked ${forbidden}`);
  assert.equal((await rpc(c, `select id, kind from public.privacy_requests where kind='export'`)).length, 1);
  assert.equal((await rpc(other, 'select id from public.privacy_requests')).length, 0);
  const rid = (await rpc(c, 'select public.request_account_deletion() id'))[0].id;
  assert.equal((await rpc(c, 'select public.request_account_deletion() id'))[0].id, rid, 'idempotent');
  assert.match(await failure(api.as(c, (s) => s('select public.admin_process_deletion($1,$2)', [rid, 'self approve']))) ?? '', /Not authorised/);
  assert.ok((await api.as(admin, (s) => s('select * from public.admin_privacy_queue()'))).rows.some((r) => r.request_id === rid));
  await api.q(`insert into storage.objects (bucket_id,name,owner_id,metadata) values ('resumes',$1,$2,'{"size":"700"}')`, [`${c.id}/d.pdf`, c.id]);
  await api.as(c, (s) => s(`select public.register_resume($1,'d.pdf','application/pdf',700,$2)`, [`${c.id}/d.pdf`, '1'.repeat(64)]));
  const res = (await api.as(admin, (s) => s('select public.admin_process_deletion($1,$2) r', [rid, 'Verified identity by email'])) ).rows[0].r;
  assert.deepEqual(res, { auth_scrub: 'pending', storage_purge: 'pending' });
  assert.equal((await api.as(admin, (s) => s(`select * from storage.objects where bucket_id='resumes'`))).rows.length, 0, 'admins cannot read resume files, so purging is a service-role job');
  const p = (await api.q('select display_name,email,phone,status from public.profiles where id=$1', [c.id])).rows[0];
  assert.deepEqual(p, { display_name: 'Deleted user', email: null, phone: null, status: 'deleted' });
  assert.equal((await api.q('select count(*)::int n from public.candidate_skills where candidate_id=$1', [c.id])).rows[0].n, 0);
  assert.equal((await api.q('select stage from public.applications where id=$1', [a])).rows[0].stage, 'withdrawn');
  assert.equal((await api.q('select discovery_enabled d from public.candidate_profiles where user_id=$1', [c.id])).rows[0].d, false);
  assert.match(await failure(api.as(c, (s) => s('select public.apply_to_job($1)', [jobA]))) ?? '', /not active/, 'deleted accounts cannot act');
  assert.ok((await api.q('select count(*)::int n from public.consent_records where user_id=$1', [c.id])).rows[0].n >= 2, 'consent evidence is retained');
  // Real GoTrue keeps the email/phone in auth.users, so re-registration must fail until the trusted worker scrubs it.
  assert.match(await failure(api.signUp('candidate', 'Reuser', { email: c.email, phone: c.phone })) ?? '', /duplicate key/, 'identifiers are still held before the scrub');
  const pending = (await api.asService((s) => s('select * from public.privacy_deletions_pending()'))).rows;
  assert.ok(pending.some((p) => p.user_id === c.id));
  // Simulates what scripts/process-deletions.mjs does through the Auth Admin API (unverified against real GoTrue).
  await api.q(`update auth.users set email = 'deleted+' || id || '@deleted.invalid', phone = null, banned_until = 'infinity', raw_user_meta_data = '{}' where id = $1`, [c.id]);
  await api.asService((s) => s(`select public.privacy_mark_processed($1,'auth_scrub'), public.privacy_mark_processed($1,'storage_purge')`, [rid]));
  assert.equal((await api.q('select email from public.profiles where id=$1', [c.id])).rows[0].email, null, 'tombstone email is not synced into the profile');
  assert.equal(await failure(api.signUp('candidate', 'Reuser', { email: c.email, phone: c.phone })), null, 'after the scrub the email and phone can be registered again');
  assert.equal((await api.asService((s) => s('select * from public.privacy_deletions_pending()'))).rows.some((p) => p.user_id === c.id), false);
  assert.match(await failure(api.as(admin, (s) => s('select public.admin_process_deletion($1,$2)', [rid, 'again again']))) ?? '', /not found/i);
  // sole company owner cannot be deleted
  const sole = await makeCompany(api, admin, 'Sole Co'); const r2 = (await rpc(sole.owner, 'select public.request_account_deletion() id'))[0].id;
  assert.match(await failure(api.as(admin, (s) => s('select public.admin_process_deletion($1,$2)', [r2, 'owner leaving']))) ?? '', /only owner/);
  await api.as(admin, (s) => s(`select public.admin_review_company($1,'suspend','Owner requested closure')`, [sole.companyId]));
  await api.as(admin, (s) => s('select public.admin_process_deletion($1,$2)', [r2, 'Owner requested closure; company suspended']));
  assert.equal((await api.q('select active from public.company_members where user_id=$1', [sole.owner.id])).rows[0].active, false, 'sole owner of a suspended company can be deleted');
});

test('abuse reports flow to moderators; reporters see only their own', async () => {
  const rid = (await rpc(cand, `select public.report_job($1,'fee_requested','Asked for registration fee') id`, [jobB]))[0].id;
  assert.ok(await failure(api.as(cand, (s) => s(`select public.report_job($1,'fraud')`, [jobB]))), 'duplicate report rejected');
  assert.equal((await rpc(other, 'select * from public.abuse_reports')).length, 0);
  assert.match(await failure(api.as(cand, (s) => s('select * from public.admin_reports()'))) ?? '', /Not authorised/);
  const q = (await api.as(admin, (s) => s('select * from public.admin_reports()'))).rows;
  assert.equal(q[0].report_id, rid); assert.equal(q[0].job_title, 'Backend Developer');
  assert.match(await failure(api.as(admin, (s) => s(`select public.admin_resolve_report($1,'actioned','')`, [rid]))) ?? '', /reason/);
  await api.as(admin, (s) => s(`select public.admin_resolve_report($1,'actioned','Job paused and employer warned')`, [rid]));
  assert.equal((await api.as(admin, (s) => s('select * from public.admin_reports()'))).rows.length, 0);
});

test('team invitations require the invitee\'s verified email', async () => {
  const inv = await api.signUp('employer', 'New Recruiter', { email: 'recruiter@example.test' });
  await api.q('update public.profiles set email_verified_at = null where id=$1', [inv.id]);
  const id = (await rpc(co.owner, `select public.invite_company_member($1,'Recruiter@Example.test','recruiter') id`, [co.companyId]))[0].id;
  assert.match(await failure(api.as(co.owner, (s) => s(`select public.invite_company_member($1,'recruiter@example.test','viewer')`, [co.companyId]))) ?? '', /already pending/);
  assert.match(await failure(api.as(co.owner, (s) => s(`select public.invite_company_member($1,'x@example.test','owner')`, [co.companyId]))) ?? '', /recruiter or viewer/);
  assert.equal((await rpc(inv, 'select * from public.my_company_invitations()')).length, 0, 'unverified email cannot see or accept');
  assert.match(await failure(api.as(inv, (s) => s('select public.accept_company_invitation($1)', [id]))) ?? '', /not found/i);
  await api.q('update public.profiles set email_verified_at = now() where id=$1', [inv.id]);
  const thief = await api.signUp('employer', 'Thief');
  assert.match(await failure(api.as(thief, (s) => s('select public.accept_company_invitation($1)', [id]))) ?? '', /not found/i);
  assert.equal((await rpc(thief, 'select * from public.company_invitations')).length, 0);
  await api.as(inv, (s) => s('select public.accept_company_invitation($1)', [id]));
  assert.equal((await api.q('select role from public.company_members where user_id=$1', [inv.id])).rows[0].role, 'recruiter');
  const team = await rpc(inv, 'select * from public.company_team($1)', [co.companyId]);
  assert.ok(team.length >= 2 && team.every((m) => m.email === null), 'only owners see team emails');
  assert.ok((await rpc(co.owner, 'select * from public.company_team($1)', [co.companyId])).some((m) => m.email === 'recruiter@example.test'));
  assert.match(await failure(api.as(inv, (s) => s(`select public.invite_company_member($1,'z@example.test','viewer')`, [co.companyId]))) ?? '', /Only owners/);
  assert.match(await failure(api.as(thief, (s) => s('select * from public.company_team($1)', [co.companyId]))) ?? '', /not found/i);
});

test('employer dashboard, job list and interview list use real counts and are company-scoped', async () => {
  const c = await makeCandidate(api, 'Dash Cand'); const a = (await rpc(c, 'select public.apply_to_job($1) id', [jobB]))[0].id;
  await api.as(co.owner, (s) => s(`select public.transition_application($1,'shortlisted')`, [a]));
  await api.as(co.owner, (s) => s(`select public.propose_interview($1,$2,'phone')`, [a, new Date(Date.now() + 86400e3).toISOString()]));
  const d = (await rpc(co.owner, 'select public.employer_dashboard($1) d', [co.companyId]))[0].d;
  assert.equal(d.jobs.published, 2); assert.ok(d.pipeline.interview >= 1); assert.ok(d.upcoming_interviews >= 1);
  const jobs = await rpc(co.owner, 'select * from public.company_jobs($1)', [co.companyId]);
  assert.equal(jobs.find((j) => j.job_id === jobB).applicants >= 1, true);
  const ivs = await rpc(co.owner, 'select * from public.company_interviews($1)', [co.companyId]);
  assert.ok(ivs.some((i) => i.candidate_name === 'Dash Cand'));
  const rival = await makeCompany(api, admin, 'Rival Co');
  for (const fn of ['employer_dashboard', 'company_jobs', 'company_interviews'])
    assert.match(await failure(api.as(rival.owner, (s) => s(`select * from public.${fn}($1)`, [co.companyId]))) ?? '', /not found/i, fn);
});

test('notifications: outbox, preferences, essential vs optional, retries, security events', async () => {
  const c = await makeCandidate(api, 'Mail Me');
  await api.as(c, (s) => s('select public.set_notification_preferences(false)'));
  const a = (await rpc(c, 'select public.apply_to_job($1) id', [jobB]))[0].id;
  await api.as(co.owner, (s) => s(`select public.transition_application($1,'viewed')`, [a]));   // optional kind
  await api.as(co.owner, (s) => s(`select public.transition_application($1,'shortlisted')`, [a])); // essential kind
  const claimed = (await api.asService((s) => s('select * from public.outbox_claim(100)'))).rows;
  const rows = (await api.q('select kind,status,subject,category from private.email_outbox where recipient_id=$1 order by created_at,id', [c.id])).rows;
  assert.equal(rows.find((r) => r.kind === 'application.viewed').status, 'suppressed', 'optional mail respects the preference at send time');
  assert.equal(rows.find((r) => r.kind === 'application.shortlisted').category, 'essential');
  assert.equal(rows.find((r) => r.kind === 'application.shortlisted').status, 'sending', 'essential mail is claimed regardless of preference');
  assert.ok(rows.every((r) => !/Mail Me|@|\+91/.test(r.subject)), 'no candidate-sensitive data in subjects');
  const mine = claimed.find((r) => r.kind === 'application.shortlisted' && r.recipient_email === c.email);
  assert.equal(mine.recipient_email, c.email);
  for (let i = 0; i < 5; i++) {
    assert.equal((await api.asService((s) => s(`select public.outbox_report($1,false,'SMTP 421') ok`, [mine.id]))).rows[0].ok, true);
    await api.q(`update private.email_outbox set next_attempt_at = now() where id=$1 and status='pending'`, [mine.id]);
    if (i < 4) assert.ok((await api.asService((s) => s('select * from public.outbox_claim(100)'))).rows.some((r) => r.id === mine.id), `retry ${i + 1} is re-claimed`);
  }
  assert.equal((await api.q('select status,attempts from private.email_outbox where id=$1', [mine.id])).rows[0].status, 'failed');
  assert.ok((await api.as(admin, (s) => s('select * from public.admin_email_failures()'))).rows.some((r) => r.id === mine.id));
  assert.match(await failure(api.as(c, (s) => s('select * from public.outbox_claim()'))) ?? '', /permission denied/);
  assert.match(await failure(api.as(c, (s) => s('select * from private.email_outbox'))) ?? '', /permission denied/);
  // unsubscribe + security notifications
  const token = (await api.q('select unsubscribe_token t from public.notification_preferences where user_id=$1', [c.id])).rows[0].t;
  assert.equal((await api.asService((s) => s('select public.unsubscribe_by_token($1) ok', [token]))).rows[0].ok, true);
  assert.match(await failure(api.as(c, (s) => s('select public.unsubscribe_by_token($1)', [token]))) ?? '', /permission denied/);
  await api.q(`update auth.users set encrypted_password='new-hash' where id=$1`, [c.id]);
  assert.ok((await rpc(c, 'select kind from public.notifications')).some((n) => n.kind === 'security.password_changed'));
  assert.ok((await rpc(c, 'select kind from public.notifications')).some((n) => n.kind === 'account.registered'));
});

test('admin consoles: authorisation by role, queues, user lookup audit, audit search, retention', async () => {
  const mod = await api.signUp('candidate', 'Mod Two'); const priv = await api.signUp('candidate', 'Privacy Pat'); const sup = await api.signUp('candidate', 'Support Sam');
  await api.grantAdmin(mod, 'moderator'); await api.grantAdmin(priv, 'privacy'); await api.grantAdmin(sup, 'support');
  const fresh = await makeCompany(api, admin, 'Queue Co', { approve: false });
  await api.as(fresh.owner, (s) => s(`select public.submit_company_verification($1,'gstin','27AAPFU0939F1ZV')`, [fresh.companyId]));
  const cq = (await api.as(mod, (s) => s('select * from public.admin_company_queue()'))).rows;
  const row = cq.find((r) => r.company_id === fresh.companyId);
  assert.equal(row.identifier_value, '27AAPFU0939F1ZV'); assert.equal(row.owner_name, 'Queue Co Owner');
  const draft = await makeJob(api, admin, co, { publish: false, title: 'Needs review' });
  await api.as(co.owner, (s) => s('select public.submit_job_for_review($1)', [draft]));
  assert.ok((await api.as(mod, (s) => s('select * from public.admin_job_queue()'))).rows.some((r) => r.job_id === draft));
  const dash = (await api.as(mod, (s) => s('select public.admin_dashboard() d'))).rows[0].d;
  assert.ok(dash.companies_pending >= 1 && dash.jobs_pending >= 1 && dash.published_jobs >= 2);
  assert.deepEqual(dash.roles, ['moderator']);
  for (const [u, fn] of [[sup, 'admin_company_queue()'], [priv, 'admin_job_queue()'], [mod, 'admin_find_user($1)'], [mod, 'admin_search_audit()'], [sup, 'admin_search_audit()'], [mod, 'admin_list_roles()'], [cand, 'admin_dashboard()'], [co.owner, 'admin_company_queue()']])
    assert.match(await failure(api.as(u, (s) => s(`select * from public.${fn}`.replace('$1', "'alice'")))) ?? '', /Not authorised/, fn);
  assert.match(await failure(api.as(sup, (s) => s(`select * from public.admin_find_user('ab')`))) ?? '', /at least 3/);
  const found = (await api.as(sup, (s) => s(`select * from public.admin_find_user($1)`, [cand.email.slice(0, 8)]))).rows;
  assert.ok(found.some((r) => r.user_id === cand.id));
  const audits = (await api.as(priv, (s) => s(`select * from public.admin_search_audit('admin.user_lookup')`))).rows;
  assert.ok(audits.length >= 1 && audits[0].actor_id === sup.id, 'PII lookups are audited');
  assert.ok((await api.as(priv, (s) => s(`select * from public.admin_search_audit('company.approve', null, 'company')`))).rows.length >= 1);
  assert.ok((await api.as(admin, (s) => s('select * from public.admin_list_roles()'))).rows.length >= 4);
  assert.ok((await api.as(mod, (s) => s('select * from public.admin_matching_versions()'))).rows.length >= 1);
  // retention (service role only)
  await api.q(`update public.notifications set read_at = now() - interval '400 days' where recipient_id=$1`, [cand.id]);
  assert.match(await failure(api.as(admin, (s) => s('select public.run_retention_jobs()'))) ?? '', /permission denied/);
  const res = (await api.asService((s) => s('select public.run_retention_jobs() r'))).rows[0].r;
  assert.ok(res.notifications >= 1);
});
