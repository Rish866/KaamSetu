import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { failure } from './harness.mjs';
import { world, makeCompany, makeJob, makeCandidate } from './fixtures.mjs';

let api, admin, co, job, cand;
const q = (u, sql, p) => api.as(u, async (s) => (await s(sql, p)).rows);
before(async () => {
  ({ api, admin } = await world());
  co = await makeCompany(api, admin, 'Flow Co');
  job = await makeJob(api, admin, co);
  cand = await makeCandidate(api, 'Flow Candidate', { discovery: true });
});

test('company verification lifecycle: draft -> pending -> rejected -> resubmit -> approved', async () => {
  const c = await makeCompany(api, admin, 'Lifecycle', { approve: false });
  const st = async () => (await api.q('select verification_status s, verification_reason r from public.companies where id=$1', [c.companyId])).rows[0];
  assert.equal((await st()).s, 'draft');
  assert.match(await failure(api.as(c.owner, (s) => s(`select public.submit_company_verification($1,'gstin','BADGST')`, [c.companyId]))) ?? '', /GSTIN format/);
  await api.as(c.owner, (s) => s(`select public.submit_company_verification($1,'gstin','27AAPFU0939F1ZV')`, [c.companyId]));
  assert.equal((await st()).s, 'pending');
  assert.match(await failure(api.as(admin, (s) => s(`select public.admin_review_company($1,'reject','no')`, [c.companyId]))) ?? '', /reason/);
  await api.as(admin, (s) => s(`select public.admin_review_company($1,'reject','GSTIN belongs to another entity')`, [c.companyId]));
  assert.deepEqual(await st(), { s: 'rejected', r: 'GSTIN belongs to another entity' });
  assert.match(await failure(api.as(admin, (s) => s(`select public.admin_review_company($1,'approve','try anyway')`, [c.companyId]))) ?? '', /not allowed/);
  await api.as(c.owner, (s) => s(`select public.submit_company_verification($1,'cin','U12345MH2020PTC123456')`, [c.companyId]));
  await api.as(admin, (s) => s(`select public.admin_review_company($1,'approve','Documents verified')`, [c.companyId]));
  assert.equal((await st()).s, 'approved');
  const audit = (await api.q(`select action from private.audit_events where company_id=$1 order by created_at`, [c.companyId])).rows.map((r) => r.action);
  assert.deepEqual(audit.filter((a) => a.startsWith('company.')), ['company.created', 'company.verification_submitted', 'company.reject', 'company.verification_submitted', 'company.approve']);
  const notes = await q(c.owner, 'select kind from public.notifications order by created_at');
  assert.ok(notes.some((n) => n.kind === 'company.approve') && notes.some((n) => n.kind === 'company.reject'));
});

test('job lifecycle: moderation, history, pause, reopen, close, duplicate', async () => {
  const j = await makeJob(api, admin, co, { publish: false, title: 'Lifecycle job' });
  assert.match(await failure(api.as(co.owner, (s) => s(`select public.set_job_status($1,'published')`, [j]))) ?? '', /cannot become/);
  await api.as(co.owner, (s) => s('select public.submit_job_for_review($1)', [j]));
  assert.match(await failure(api.as(co.owner, (s) => s('select public.submit_job_for_review($1)', [j]))) ?? '', /draft or rejected/);
  await api.as(admin, (s) => s(`select public.admin_review_job($1,'reject','Salary range looks wrong')`, [j]));
  await api.as(co.owner, (s) => s(`update public.jobs set salary_max=800000 where id=$1`, [j]));
  await api.as(co.owner, (s) => s('select public.submit_job_for_review($1)', [j]));
  await api.as(admin, (s) => s(`select public.admin_review_job($1,'approve','Looks good')`, [j]));
  await api.as(co.owner, (s) => s(`select public.set_job_status($1,'paused','Hiring freeze')`, [j]));
  assert.equal((await q(null, 'select id from public.jobs where id=$1', [j])).length, 0, 'paused job is not public');
  await api.as(co.owner, (s) => s(`select public.set_job_status($1,'published')`, [j]));
  await api.as(co.owner, (s) => s(`select public.set_job_status($1,'closed')`, [j]));
  const dup = await api.as(co.owner, async (s) => (await s('select public.duplicate_job($1) id', [j])).rows[0].id);
  assert.equal((await api.q('select status, title from public.jobs where id=$1', [dup])).rows[0].status, 'draft');
  assert.equal((await api.q('select count(*)::int n from public.job_skills where job_id=$1', [dup])).rows[0].n, 2);
  const hist = (await q(co.owner, 'select to_status from public.job_events where job_id=$1 order by created_at, id', [j])).map((r) => r.to_status);
  assert.deepEqual(hist, ['pending_review', 'rejected', 'pending_review', 'published', 'paused', 'published', 'closed']);
  const incomplete = await api.as(co.owner, async (s) => (await s(`insert into public.jobs (company_id,title,description,salary_min,salary_max,work_mode,employment_type,created_by) values ($1,'No skills','short',1,2,'remote','full_time',$2) returning id`, [co.companyId, co.owner.id])).rows[0].id);
  assert.match(await failure(api.as(co.owner, (s) => s('select public.submit_job_for_review($1)', [incomplete]))) ?? '', /Description/);
  assert.match(await failure(api.as(admin, (s) => s(`select public.admin_review_job($1,'approve','')`, [j]))) ?? '', /reason/);
});

test('application pipeline enforces valid transitions and records every event', async () => {
  const appId = await api.as(cand, async (s) => (await s('select public.apply_to_job($1,$2) id', [job, 'I am interested'])).rows[0].id);
  assert.match(await failure(api.as(cand, (s) => s('select public.apply_to_job($1)', [job]))) ?? '', /already applied/);
  const snap = (await api.q('select match_snapshot from public.applications where id=$1', [appId])).rows[0].match_snapshot;
  assert.equal(snap.version, 1); assert.ok(snap.score >= 0 && snap.score <= 100);
  const t = (to, reason, details) => api.as(co.owner, (s) => s('select public.transition_application($1,$2,$3,$4)', [appId, to, reason ?? null, details ?? null]));
  assert.match(await failure(t('hired')) ?? '', /Cannot move/);
  assert.match(await failure(t('offer')) ?? '', /Cannot move/);
  await t('viewed'); await t('shortlisted');
  assert.match(await failure(t('interview')) ?? '', /Propose an interview/);
  const when = new Date(Date.now() + 3 * 86400e3).toISOString();
  assert.match(await failure(api.as(co.owner, (s) => s(`select public.propose_interview($1,$2,'video','x')`, [appId, new Date(Date.now() - 1000).toISOString()]))) ?? '', /future/);
  const iv = await api.as(co.owner, async (s) => (await s(`select public.propose_interview($1,$2,'video','Meet link sent by email') id`, [appId, when])).rows[0].id);
  assert.equal((await api.q('select stage from public.applications where id=$1', [appId])).rows[0].stage, 'interview');
  assert.match(await failure(api.as(co.owner, (s) => s(`select public.respond_to_interview($1,'confirm')`, [iv]))) ?? '', /not found/i, 'employer cannot answer for the candidate');
  await api.as(cand, (s) => s(`select public.respond_to_interview($1,'reschedule','Can we do Friday?')`, [iv]));
  assert.equal((await api.q('select status from public.interviews where id=$1', [iv])).rows[0].status, 'reschedule_requested');
  const iv2 = await api.as(co.owner, async (s) => (await s(`select public.propose_interview($1,$2,'phone') id`, [appId, new Date(Date.now() + 4 * 86400e3).toISOString()])).rows[0].id);
  assert.equal((await api.q('select status from public.interviews where id=$1', [iv])).rows[0].status, 'cancelled');
  await api.as(cand, (s) => s(`select public.respond_to_interview($1,'confirm')`, [iv2]));
  assert.match(await failure(api.as(cand, (s) => s(`select public.respond_to_interview($1,'confirm')`, [iv2]))) ?? '', /cannot be/);
  assert.match(await failure(t('rejected', 'no')) ?? '', /reason/);
  await t('offer', null, 'CTC 6.5 LPA, joining 1 Jan');
  assert.match(await failure(t('hired')) ?? '', /candidate accepts the offer/, 'employers cannot mark a hire themselves');
  await api.as(cand, async (s) => { await s("select public.set_consent('joining_verification', true, '2026-11-26.2')"); return s('select public.respond_to_offer($1, true)', [appId]); });
  assert.match(await failure(t('rejected', 'changed our mind')) ?? '', /Cannot move/);
  const events = (await q(cand, 'select from_stage, to_stage from public.application_events where application_id=$1 order by created_at, id', [appId])).map((e) => `${e.from_stage ?? '-'}>${e.to_stage}`);
  assert.deepEqual(events, ['->applied', 'applied>viewed', 'viewed>shortlisted', 'shortlisted>interview', 'interview>offer', 'offer>hired']);
  const kinds = (await q(cand, 'select kind from public.notifications order by created_at, id')).map((n) => n.kind);
  for (const k of ['application.viewed', 'application.shortlisted', 'interview.proposed', 'interview.changed', 'application.offer']) assert.ok(kinds.includes(k), `missing notification ${k}`);
  const emp = (await q(co.owner, 'select kind from public.notifications')).map((n) => n.kind);
  assert.ok(emp.includes('application.received') && emp.includes('interview.reschedule_requested') && emp.includes('interview.confirmed') && emp.includes('hiring.offer_accepted'));
  const sensitive = (await api.q('select title, body from public.notifications')).rows;
  assert.ok(sensitive.every((n) => !/@|\+91|Flow Candidate/.test(n.title + n.body)), 'notifications must not contain PII');
});

test('rejection requires a reason, closes interviews, and withdrawn applications are terminal', async () => {
  const c2 = await makeCandidate(api, 'Reject Me'); const c3 = await makeCandidate(api, 'Withdrawer');
  const a2 = await api.as(c2, async (s) => (await s('select public.apply_to_job($1) id', [job])).rows[0].id);
  await api.as(co.owner, (s) => s(`select public.transition_application($1,'rejected','Role requires a degree')`, [a2]));
  const ev = await q(c2, `select reason from public.application_events where application_id=$1 and to_stage='rejected'`, [a2]);
  assert.equal(ev[0].reason, 'Role requires a degree');
  const a3 = await api.as(c3, async (s) => (await s('select public.apply_to_job($1) id', [job])).rows[0].id);
  await api.as(c3, (s) => s('select public.withdraw_application($1)', [a3]));
  assert.match(await failure(api.as(c3, (s) => s('select public.withdraw_application($1)', [a3]))) ?? '', /already closed/);
  assert.match(await failure(api.as(co.owner, (s) => s(`select public.transition_application($1,'viewed')`, [a3]))) ?? '', /Cannot move/);
  assert.match(await failure(api.as(c3, (s) => s('select public.apply_to_job($1)', [job]))) ?? '', /already applied/);
  const list = await api.as(co.owner, async (s) => (await s('select * from public.list_job_applicants($1)', [job])).rows);
  assert.ok(!list.some((r) => r.application_id === a3), 'withdrawn applications are hidden from the employer list');
});

test('contact details are hidden until shortlisted AND the candidate consents; disclosure is audited', async () => {
  const c = await makeCandidate(api, 'Private Pat');
  const a = await api.as(c, async (s) => (await s('select public.apply_to_job($1) id', [job])).rows[0].id);
  const get = () => api.as(co.owner, (s) => s('select * from public.get_applicant_contact($1)', [a]));
  assert.match(await failure(get()) ?? '', /after shortlisting/);
  await api.as(co.owner, (s) => s(`select public.transition_application($1,'shortlisted')`, [a]));
  assert.match(await failure(get()) ?? '', /not agreed/);
  await api.as(c, (s) => s(`select public.set_consent('contact_sharing', true, '2026-11-18')`));
  const r = (await get()).rows[0];
  assert.equal(r.email, c.email); assert.equal(r.phone, c.phone);
  assert.equal((await q(c, 'select * from public.contact_disclosures')).length, 1, 'candidate can see who received their data');
  assert.equal((await api.q(`select count(*)::int n from private.audit_events where action='contact.disclosed'`)).rows[0].n, 1);
  await api.as(c, (s) => s(`select public.set_consent('contact_sharing', false, '2026-11-18')`));
  assert.match(await failure(get()) ?? '', /not agreed/, 'withdrawal takes effect immediately');
  const rows = await api.as(co.owner, async (s) => (await s('select * from public.list_job_applicants($1)', [job])).rows);
  assert.ok(rows.every((x) => !('email' in x) && !('phone' in x)));
});

test('discovery: only consenting candidates are searchable; invitations are deduplicated and answerable', async () => {
  const hidden = await makeCandidate(api, 'Hidden Hana', { discovery: false });
  const open = await makeCandidate(api, 'Open Omar', { discovery: true, months: 24 });
  const res = await api.as(co.owner, async (s) => (await s('select * from public.search_candidates($1)', [job])).rows);
  const ids = res.map((r) => r.candidate_id);
  assert.ok(ids.includes(open.id) && !ids.includes(hidden.id));
  assert.ok(res.every((r) => !('display_name' in r) && !('email' in r) && !('phone' in r)), 'search results are masked');
  assert.ok(res[0].score >= res[res.length - 1].score, 'ranked by score');
  assert.match(await failure(api.as(co.owner, (s) => s('select public.invite_candidate($1,$2)', [job, hidden.id]))) ?? '', /not available/);
  const inv = await api.as(co.owner, async (s) => (await s('select public.invite_candidate($1,$2,$3) id', [job, open.id, 'We liked your profile'])).rows[0].id);
  assert.match(await failure(api.as(co.owner, (s) => s('select public.invite_candidate($1,$2)', [job, open.id]))) ?? '', /already been invited/);
  const reSearch = await api.as(co.owner, async (s) => (await s('select * from public.search_candidates($1)', [job])).rows);
  assert.ok(!reSearch.some((r) => r.candidate_id === open.id), 'already-invited candidates are not suggested again');
  assert.equal((await q(hidden, 'select * from public.job_invitations')).length, 0);
  assert.match(await failure(api.as(hidden, (s) => s('select public.respond_to_invitation($1,true)', [inv]))) ?? '', /not found/i);
  await api.as(open, (s) => s('select public.respond_to_invitation($1,true)', [inv]));
  const app = (await api.q(`select source, stage from public.applications where candidate_id=$1 and job_id=$2`, [open.id, job])).rows[0];
  assert.deepEqual(app, { source: 'accepted_invitation', stage: 'applied' });
  assert.match(await failure(api.as(open, (s) => s('select public.respond_to_invitation($1,false)', [inv]))) ?? '', /already accepted/);
  // decline path + expiry
  const o2 = await makeCandidate(api, 'Decliner', { discovery: true }); const o3 = await makeCandidate(api, 'Late Larry', { discovery: true });
  const i2 = await api.as(co.owner, async (s) => (await s('select public.invite_candidate($1,$2) id', [job, o2.id])).rows[0].id);
  await api.as(o2, (s) => s('select public.respond_to_invitation($1,false)', [i2]));
  assert.equal((await api.q('select status from public.job_invitations where id=$1', [i2])).rows[0].status, 'declined');
  assert.equal((await api.q('select count(*)::int n from public.applications where candidate_id=$1', [o2.id])).rows[0].n, 0);
  const i3 = await api.as(co.owner, async (s) => (await s('select public.invite_candidate($1,$2) id', [job, o3.id])).rows[0].id);
  await api.q(`update public.job_invitations set expires_at = now() - interval '1 day' where id=$1`, [i3]);
  assert.match(await failure(api.as(o3, (s) => s('select public.respond_to_invitation($1,true)', [i3]))) ?? '', /expired/);
  assert.match(await failure(api.as(co.owner, (s) => s('select public.expire_stale_invitations()'))) ?? '', /permission denied|Not authorised/);
  // withdrawing discovery consent removes the candidate from search immediately and records history
  await api.as(open, (s) => s(`select public.set_consent('employer_discovery', false, '2026-11-18')`));
  const after = await api.as(co.owner, async (s) => (await s('select * from public.search_candidates($1)', [job])).rows);
  assert.ok(!after.some((r) => r.candidate_id === open.id));
  const hist = (await api.q(`select action from public.consent_records where user_id=$1 and purpose='employer_discovery' order by created_at, id`, [open.id])).rows.map((r) => r.action);
  assert.deepEqual(hist, ['granted', 'withdrawn']);
});

test('suspended accounts and companies lose write access', async () => {
  const s1 = await makeCandidate(api, 'To Suspend');
  await api.as(admin, (s) => s(`select public.admin_set_account_status($1,'suspended','Fraud report 123')`, [s1.id]));
  assert.match(await failure(api.as(s1, (s) => s('select public.apply_to_job($1)', [job]))) ?? '', /not active/);
  await api.as(admin, (s) => s(`select public.admin_set_account_status($1,'active','Cleared')`, [s1.id]));
  await api.as(s1, (s) => s('select public.apply_to_job($1)', [job]));
  assert.match(await failure(api.as(admin, (s) => s(`select public.admin_set_account_status($1,'suspended','testing self suspension')`, [admin.id]))) ?? '', /own status/);
  const pause = await makeCompany(api, admin, 'Soon Suspended'); const pj = await makeJob(api, admin, pause);
  const pc = await makeCandidate(api, 'Applicant P'); const pa = await api.as(pc, async (s) => (await s('select public.apply_to_job($1) id', [pj])).rows[0].id);
  await api.as(admin, (s) => s(`select public.admin_review_company($1,'suspend','Fake GSTIN found')`, [pause.companyId]));
  assert.match(await failure(api.as(pause.owner, (s) => s(`select public.transition_application($1,'shortlisted')`, [pa]))) ?? '', /not verified/);
  assert.match(await failure(api.as(pc, (s) => s('select public.apply_to_job($1)', [pj]))) ?? '', /already applied|not open/);
  assert.equal((await q(null, 'select id from public.jobs where id=$1', [pj])).length, 0);
});

test('admin role management: least privilege, last-admin protection, reasons required', async () => {
  const mod = await api.signUp('candidate', 'Moderator M'); const sup = await api.signUp('candidate', 'Support S');
  await api.as(admin, (s) => s(`select public.admin_grant_role($1,'moderator','Trust & safety hire')`, [mod.id]));
  await api.as(admin, (s) => s(`select public.admin_grant_role($1,'support','Support hire')`, [sup.id]));
  const cx = await makeCompany(api, admin, 'Mod Test', { approve: false });
  await api.as(cx.owner, (s) => s(`select public.submit_company_verification($1,'domain','modtest.example')`, [cx.companyId]));
  await api.as(mod, (s) => s(`select public.admin_review_company($1,'approve','Domain matches')`, [cx.companyId]));
  assert.match(await failure(api.as(mod, (s) => s(`select public.admin_grant_role($1,'admin','escalate')`, [mod.id]))) ?? '', /Not authorised/);
  assert.match(await failure(api.as(sup, (s) => s(`select public.admin_review_company($1,'suspend','support may not')`, [cx.companyId]))) ?? '', /Not authorised/);
  assert.match(await failure(api.as(mod, (s) => s(`select public.admin_set_account_status($1,'suspended','mods may not')`, [sup.id]))) ?? '', /Not authorised/);
  await api.as(sup, (s) => s(`select public.admin_set_account_status($1,'suspended','Abuse report #77')`, [mod.id]));
  assert.match(await failure(api.as(admin, (s) => s(`select public.admin_revoke_role($1,'admin','leaving')`, [admin.id]))) ?? '', /last administrator/);
  assert.match(await failure(api.as(admin, (s) => s(`select public.admin_grant_role($1,'support','x')`, [sup.id]))) ?? '', /reason/);
  assert.ok((await api.q(`select count(*)::int n from private.audit_events where action in ('admin.role_granted')`)).rows[0].n >= 2);
});

test('data-minimised notifications: users read only their own and may only mark read', async () => {
  const mine = await q(cand, 'select id from public.notifications');
  assert.ok(mine.length > 0);
  await api.as(cand, (s) => s('select public.mark_notifications_read()'));
  assert.equal((await q(cand, 'select count(*)::int n from public.notifications where read_at is null'))[0].n, 0);
  assert.equal((await q(co.owner, 'select count(*)::int n from public.notifications where read_at is null'))[0].n > 0, true, 'other users are unaffected');
});
