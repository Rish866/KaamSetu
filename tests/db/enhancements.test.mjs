// Accountability & privacy pass (migrations 202611270001-0004): outcome tags, readiness questions, review commitment,
// trust details, access log, data minimisation, relocation, job alerts and the pilot funnel.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { failure } from './harness.mjs';
import { world, makeCompany, makeJob, makeCandidate, loc } from './fixtures.mjs';

let api, admin, co, job;
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const as = async (who, sql, p) => (await api.as(who, (s) => s(sql, p))).rows;
const emp = (sql, p) => as(co.owner, sql, p);
const apply = async (cand, j = job) => (await as(cand, 'select public.apply_to_job($1) id', [j]))[0].id;
const event = async (app, to) => (await api.q('select outcome_tag, reason from public.application_events where application_id=$1 and to_stage=$2', [app, to])).rows[0];
const NOTICE = '2026-11-26.2';

async function toOffer(cand, j = job, owner = co.owner) {
  const app = await apply(cand, j);
  const t = (to) => as(owner, 'select public.transition_application($1,$2)', [app, to]);
  await t('viewed'); await t('shortlisted');
  await as(owner, `select public.propose_interview($1,$2,'video','link')`, [app, new Date(Date.now() + 86400e3).toISOString()]);
  await as(owner, `select public.transition_application($1,'offer',null,'CTC 6 LPA')`, [app]);
  return app;
}
async function toHire(name) {
  const cand = await makeCandidate(api, name);
  const app = await toOffer(cand);
  await as(cand, `select public.set_consent('joining_verification', true, '${NOTICE}')`);
  await as(cand, 'select public.respond_to_offer($1, true)', [app]);
  return { cand, app };
}

before(async () => {
  ({ api, admin } = await world());
  co = await makeCompany(api, admin, 'Fair Co');
  job = await makeJob(api, admin, co, { title: 'Fair role' });
});

// ---- Outcome tags ----------------------------------------------------------------------------------------------

test('rejecting needs a reason tag from the employer catalogue, stored with the event', async () => {
  const app = await apply(await makeCandidate(api, 'Tag Tara'));
  const reject = (tag) => emp(`select public.transition_application($1,'rejected','Not a fit right now',null,$2)`, [app, tag]);
  assert.match(await failure(reject(null)) ?? '', /Choose a reason/);
  assert.match(await failure(reject('candidate_accepted_other_offer')) ?? '', /does not apply/, 'candidate-only reason');
  assert.match(await failure(reject('candidate_no_show')) ?? '', /does not apply/, 'wrong context');
  assert.match(await failure(reject('made_up')) ?? '', /does not apply/);
  assert.match(await failure(emp(`select public.transition_application($1,'viewed',null,null,'compensation_mismatch')`, [app])) ?? '', /only used when rejecting/);
  await reject('skills_or_experience_gap');
  assert.deepEqual(await event(app, 'rejected'), { outcome_tag: 'skills_or_experience_gap', reason: 'Not a fit right now' });
});

test('candidates may tag a withdrawal or a declined offer; employers must tag a withdrawn offer', async () => {
  const c1 = await makeCandidate(api, 'Withdraw Wes');
  const a1 = await apply(c1);
  assert.match(await failure(as(c1, `select public.withdraw_application($1,'employer_role_on_hold')`, [a1])) ?? '', /does not apply/);
  await as(c1, `select public.withdraw_application($1,'relocation_or_commute_change')`, [a1]);
  assert.equal((await event(a1, 'withdrawn')).outcome_tag, 'relocation_or_commute_change');
  const c2 = await makeCandidate(api, 'Untagged Uma');
  const a2 = await apply(c2);
  await as(c2, 'select public.withdraw_application($1)', [a2]);
  assert.equal((await event(a2, 'withdrawn')).outcome_tag, null, 'optional for candidates');

  const c3 = await makeCandidate(api, 'Decline Dia');
  const a3 = await toOffer(c3);
  await as(c3, `select public.respond_to_offer($1,false,'Took another role','candidate_accepted_other_offer')`, [a3]);
  assert.equal((await event(a3, 'withdrawn')).outcome_tag, 'candidate_accepted_other_offer');
  assert.equal((await api.q(`select outcome_tag from public.hiring_milestones where application_id=$1 and kind='offer_declined'`, [a3])).rows[0].outcome_tag, 'candidate_accepted_other_offer');

  const a4 = await toOffer(await makeCandidate(api, 'Pulled Pia'));
  assert.match(await failure(emp(`select public.withdraw_offer($1,'Budget was cut')`, [a4])) ?? '', /Choose a reason/);
  await emp(`select public.withdraw_offer($1,'Budget was cut','budget_or_headcount_change')`, [a4]);
  assert.equal((await api.q(`select outcome_tag from public.hiring_milestones where application_id=$1 and kind='offer_withdrawn'`, [a4])).rows[0].outcome_tag, 'budget_or_headcount_change');
  assert.equal((await event(a4, 'rejected')).outcome_tag, 'budget_or_headcount_change');
});

test('no-shows are tagged automatically; early exits need a reason', async () => {
  const ns = await toHire('No Show Neel');
  const mid = (await emp(`select public.report_hiring_milestone($1,'candidate_no_show') id`, [ns.app]))[0].id;
  assert.equal((await api.q('select outcome_tag from public.hiring_milestones where id=$1', [mid])).rows[0].outcome_tag, 'candidate_no_show');

  const ex = await toHire('Early Exit Esha');
  assert.match(await failure(emp(`select public.report_hiring_milestone($1,'joined_day_1',null,null,'early_exit_resigned')`, [ex.app])) ?? '', /only used for no-shows and early exits/);
  await emp(`select public.report_hiring_milestone($1,'joined_day_1')`, [ex.app]);
  assert.match(await failure(emp(`select public.report_hiring_milestone($1,'left_before_day_30')`, [ex.app])) ?? '', /Choose a reason/);
  const left = (await emp(`select public.report_hiring_milestone($1,'left_before_day_30',null,null,'early_exit_resigned') id`, [ex.app]))[0].id;
  assert.equal((await api.q('select outcome_tag from public.hiring_milestones where id=$1', [left])).rows[0].outcome_tag, 'early_exit_resigned');
});

test('the reason catalogue is public and read-only', async () => {
  const rows = await as(null, 'select code, actor from public.outcome_reasons order by code');
  assert.ok(rows.length >= 15);
  assert.ok(await failure(as(co.owner, `insert into public.outcome_reasons values ('x','x','either','fit','{rejected}')`)));
});

// ---- Readiness questions -----------------------------------------------------------------------------------------

test('readiness questions: at most 2, required ones enforced, answers private to candidate and company, frozen after applying', async () => {
  const j = await makeJob(api, admin, co, { title: 'Night shift role' });
  const qs = [{ kind: 'yes_no', prompt: 'Can you work night shifts?' }, { kind: 'short_text', prompt: 'Notice period in days?', required: false }];
  assert.match(await failure(emp('select public.set_job_questions($1,$2)', [j, JSON.stringify([...qs, qs[0]])])) ?? '', /at most 2/);
  const other = await makeCompany(api, admin, 'Other Co');
  assert.match(await failure(as(other.owner, 'select public.set_job_questions($1,$2)', [j, JSON.stringify(qs)])) ?? '', /not found/);
  await emp('select public.set_job_questions($1,$2)', [j, JSON.stringify(qs)]);

  const cand = await makeCandidate(api, 'Ready Ravi');
  const detail = (await as(cand, 'select public.job_detail($1) d', [j]))[0].d;
  assert.deepEqual(detail.questions.map((q) => [q.kind, q.required]), [['yes_no', true], ['short_text', false]]);
  const [q1, q2] = detail.questions.map((q) => q.id);

  assert.match(await failure(as(cand, 'select public.apply_to_job($1)', [j])) ?? '', /Answer this job's questions/);
  assert.match(await failure(as(cand, 'select public.apply_with_answers($1,null,$2)', [j, JSON.stringify([{ question_id: q1, answer: 'yes' }])])) ?? '', /Answer: Can you work night shifts/);
  const app = (await as(cand, 'select public.apply_with_answers($1,null,$2) id', [j, JSON.stringify([{ question_id: q1, answer: true }, { question_id: q2, answer: ' 30 ' }])]))[0].id;
  assert.equal((await api.q('select count(*)::int n from public.application_answers where application_id=$1', [app])).rows[0].n, 2);

  assert.equal((await as(cand, 'select * from public.application_answers')).length, 2, 'candidate sees own answers');
  assert.equal((await as(await makeCandidate(api, 'Nosy Nia'), 'select * from public.application_answers')).length, 0);
  const seen = await emp('select * from public.job_application_answers($1)', [j]);
  assert.deepEqual(seen.map((r) => [r.kind, r.answer_bool, r.answer_text]), [['yes_no', true, null], ['short_text', null, '30']]);
  assert.match(await failure(as(other.owner, 'select * from public.job_application_answers($1)', [j])) ?? '', /not found/);
  assert.match(await failure(emp('select public.set_job_questions($1,$2)', [j, '[]'])) ?? '', /cannot change once candidates have applied/);
});

test('accepting an invitation is not blocked by readiness questions', async () => {
  const j = await makeJob(api, admin, co, { title: 'Invite role' });
  await emp('select public.set_job_questions($1,$2)', [j, JSON.stringify([{ kind: 'yes_no', prompt: 'Weekend work is fine?' }])]);
  const cand = await makeCandidate(api, 'Invited Ira', { discovery: true });
  const inv = (await emp('select public.invite_candidate($1,$2) id', [j, cand.id]))[0].id;
  await as(cand, 'select public.respond_to_invitation($1,true)', [inv]);
  assert.equal((await api.q('select count(*)::int n from public.applications where job_id=$1 and candidate_id=$2', [j, cand.id])).rows[0].n, 1);
});

// ---- Review commitment, scorecard trust details -----------------------------------------------------------------

test('review commitment: owner only, 1-14 days, and the scorecard reports how often it was met', async () => {
  const c = await makeCompany(api, admin, 'Promise Co');
  const j = await makeJob(api, admin, c, { title: 'Promise role' });
  const stranger = await makeCandidate(api, 'Stranger Sid');
  assert.match(await failure(as(stranger, 'select public.set_review_commitment($1,3)', [c.companyId])) ?? '', /Only the company owner/);
  assert.match(await failure(as(c.owner, 'select public.set_review_commitment($1,15)', [c.companyId])) ?? '', /between 1 and 14/);
  await as(c.owner, 'select public.set_review_commitment($1,2)', [c.companyId]);

  // Five answered applications: four within an hour, one after three days.
  for (let i = 0; i < 5; i++) {
    const a = await apply(await makeCandidate(api, `Promise ${i}`), j);
    await as(c.owner, `select public.transition_application($1,'viewed')`, [a]);
    if (i === 4) {
      await api.q('update public.applications set applied_at=$2 where id=$1', [a, ago(4 * 24)]);
      await api.db.exec(`set session_replication_role = replica; update public.application_events set created_at='${ago(24)}' where application_id='${a}' and to_stage='viewed'; set session_replication_role = origin;`);
    }
  }
  const card = (await as(stranger, 'select * from public.company_scorecards($1::uuid[]) v', [[c.companyId]]))[0].v;
  assert.deepEqual(card.commitment, { review_days: 2, sample: 5, met_pct: 80 });
  assert.equal(card.verification.method, 'Company domain');
  assert.ok(card.verification.verified_on);
  assert.ok(!JSON.stringify(card).includes('example.test'), 'never exposes the identifier');
  assert.deepEqual(card.evidence, { both_sides: 0, auto_confirmed: 0, decided_by_kaamsetu: 0 });
  assert.deepEqual(card.outcome_reasons, {}, 'hidden below thresholds');
  const d = (await as(stranger, 'select public.job_detail($1) d', [j]))[0].d;
  assert.equal(d.review_commitment_days, 2);
});

test('GSTIN verification shows the method, never the number', async () => {
  const c = await makeCompany(api, admin, 'Gst Co', { approve: false });
  await as(c.owner, `select public.submit_company_verification($1,'gstin','27AABCD1234E1Z5')`, [c.companyId]);
  await as(admin, `select public.admin_review_company($1,'approve','GSTIN checked on the GST portal')`, [c.companyId]);
  const card = (await as(admin, 'select * from public.company_scorecards($1::uuid[]) v', [[c.companyId]]))[0].v;
  assert.equal(card.verification.method, 'GSTIN');
  assert.ok(!JSON.stringify(card).includes('27AABCD1234E1Z5'));
});

// ---- Access log, consent audit, minimisation --------------------------------------------------------------------

test('access log lists consents, search appearances, invitations and contact reveals; employers cannot read it', async () => {
  const cand = await makeCandidate(api, 'Logged Lata', { discovery: true });
  const j = await makeJob(api, admin, co, { title: 'Search role' });
  const found = await emp('select * from public.discover_candidates($1)', [j]);
  assert.ok(found.some((r) => r.candidate_id === cand.id));
  assert.equal((await api.q('select count(*)::int n from public.discovery_views where candidate_id=$1 and job_id=$2', [cand.id, j])).rows[0].n, 1);
  assert.equal((await emp('select id from public.discovery_views')).length, 0, 'employers cannot read views');

  await as(cand, `select public.set_consent('contact_sharing', true, '${NOTICE}')`);
  const app = await apply(cand);
  await emp(`select public.transition_application($1,'shortlisted')`, [app]);
  await emp('select * from public.get_applicant_contact($1)', [app]);

  const log = (await as(cand, 'select public.my_access_log() l'))[0].l;
  const consent = Object.fromEntries(log.consents.map((c) => [c.purpose, c.granted]));
  assert.equal(consent.employer_discovery, true); assert.equal(consent.contact_sharing, true); assert.equal(consent.marketing, false);
  const whats = log.events.map((e) => [e.purpose, e.company]);
  assert.ok(whats.some(([p, c]) => p === 'employer_discovery' && c === 'Fair Co'));
  assert.ok(whats.some(([p]) => p === 'contact_sharing'));
  const times = log.events.map((e) => Date.parse(e.at));
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');
  assert.equal((await as(cand, 'select public.my_access_log(1) l'))[0].l.events.length, 1);

  const audits = (await api.q(`select action, metadata from private.audit_events where actor_id=$1 and action like 'consent.%' order by created_at`, [cand.id])).rows;
  assert.ok(audits.some((a) => a.action === 'consent.granted' && a.metadata.purpose === 'contact_sharing' && a.metadata.notice_version === NOTICE));
  assert.ok(!JSON.stringify(audits).includes(cand.email));
});

test('withdrawing resume reading cancels queued parsing and is audited', async () => {
  const cand = await makeCandidate(api, 'Parse Pari');
  await api.q(`insert into storage.objects (bucket_id,name,owner_id,metadata) values ('resumes',$1,$2,'{"size":"900"}')`, [`${cand.id}/p.pdf`, cand.id]);
  await as(cand, `select public.set_consent('resume_parsing', true, '${NOTICE}')`);
  const rid = (await as(cand, `select public.register_resume($1,'p.pdf','application/pdf',900,$2) id`, [`${cand.id}/p.pdf`, 'c'.repeat(64)]))[0].id;
  await api.q(`update public.resumes set parse_status='pending' where id=$1`, [rid]);
  await as(cand, `select public.set_consent('resume_parsing', false, '${NOTICE}')`);
  assert.equal((await api.q('select parse_status from public.resumes where id=$1', [rid])).rows[0].parse_status, 'skipped');
  assert.ok((await api.q(`select 1 from private.audit_events where actor_id=$1 and action='consent.withdrawn'`, [cand.id])).rows.length);
});

test('the resume is no longer shared once an application is rejected', async () => {
  const cand = await makeCandidate(api, 'Closed Kavi');
  await api.q(`insert into storage.objects (bucket_id,name,owner_id,metadata) values ('resumes',$1,$2,'{"size":"800"}')`, [`${cand.id}/r.pdf`, cand.id]);
  const rid = (await as(cand, `select public.register_resume($1,'r.pdf','application/pdf',800,$2) id`, [`${cand.id}/r.pdf`, 'd'.repeat(64)]))[0].id;
  await api.q(`update public.resumes set scan_status='clean' where id=$1`, [rid]);
  const app = await apply(cand);
  assert.equal((await emp('select public.get_applicant_resume($1) p', [app]))[0].p, `${cand.id}/r.pdf`);
  const log = (await as(cand, 'select public.my_access_log() l'))[0].l;
  assert.ok(log.events.some((e) => e.purpose === 'job_application'));
  await emp(`select public.transition_application($1,'rejected','Role filled',null,'employer_position_filled')`, [app]);
  assert.match(await failure(emp('select public.get_applicant_resume($1)', [app])) ?? '', /no longer shared/);
});

// ---- Relocation, office days ------------------------------------------------------------------------------------

test('relocation lifts a weak location match (60 anywhere, 65 within the home state) and shows in discovery', async () => {
  const blr = await makeJob(api, admin, co, { title: 'Bengaluru desk', work_mode: 'onsite', city: 'Bengaluru' });
  const pune = await makeJob(api, admin, co, { title: 'Pune desk', work_mode: 'onsite', city: 'Pune' });
  const stay = await makeCandidate(api, 'Stay Sona', { discovery: true });
  const mover = await makeCandidate(api, 'Mover Manu', { discovery: true });
  const local = await makeCandidate(api, 'State Shiv', { discovery: true });
  await as(mover, `update public.candidate_profiles set relocation='anywhere_india', max_office_days=3, commute_note='Can move in 30 days' where user_id=$1`, [mover.id]);
  await as(local, `update public.candidate_profiles set relocation='within_state' where user_id=$1`, [local.id]);
  const fit = async (c, j) => (await api.q('select private.match_score($1,$2) m', [c.id, j])).rows[0].m;

  const s = await fit(stay, blr);
  assert.equal(s.components.location.score, 0); assert.equal(s.eligible, false);
  const m = await fit(mover, blr);
  assert.deepEqual([m.components.location.score, m.components.location.tier, m.eligible], [60, 'relocation', true]);
  assert.match(m.components.location.explanation, /relocate anywhere in India/);
  const l1 = await fit(local, pune);
  assert.deepEqual([l1.components.location.score, l1.components.location.tier], [65, 'relocation_state']);
  assert.equal((await fit(local, blr)).components.location.score, 0, 'other states are not lifted');

  const rows = await emp('select candidate_id, relocation from public.discover_candidates($1,null,$2)', [blr, [await loc(api, 'Bengaluru')]]);
  const ids = rows.map((r) => r.candidate_id);
  assert.ok(ids.includes(mover.id)); assert.ok(!ids.includes(stay.id)); assert.ok(!ids.includes(local.id));
  assert.equal(rows.find((r) => r.candidate_id === mover.id).relocation, 'anywhere_india');

  const app = await apply(mover, blr);
  const prefs = await emp('select * from public.job_applicant_preferences($1)', [blr]);
  assert.deepEqual(prefs.filter((p) => p.application_id === app).map((p) => [p.relocation, p.max_office_days, p.commute_note]), [['anywhere_india', 3, 'Can move in 30 days']]);
  assert.match(await failure(as(mover, `update public.candidate_profiles set relocation='mars' where user_id=$1`, [mover.id])) ?? '', /check/);
});

test('office days on a job are validated and shown in job detail', async () => {
  const j = await makeJob(api, admin, co, { title: 'Hybrid desk', publish: false });
  assert.ok(await failure(emp('update public.jobs set office_days=7 where id=$1', [j])));
  await emp('update public.jobs set office_days=3 where id=$1', [j]);
  await emp('select public.submit_job_for_review($1)', [j]);
  await as(admin, `select public.admin_review_job($1,'approve','Content is acceptable')`, [j]);
  const d = (await as(await makeCandidate(api, 'Office Om'), 'select public.job_detail($1) d', [j]))[0].d;
  assert.equal(d.office_days, 3);
});

// ---- Job alerts ---------------------------------------------------------------------------------------------------

test('job alerts: opt-in only, one digest per day, service role only', async () => {
  const opted = await makeCandidate(api, 'Alert Anu');
  const quiet = await makeCandidate(api, 'Quiet Qasim');
  await as(opted, 'select public.set_job_alerts(true)');
  assert.equal((await as(opted, 'select job_alerts from public.notification_preferences'))[0].job_alerts, true);
  await makeJob(api, admin, co, { title: 'Fresh alert role' });
  assert.match(await failure(as(opted, 'select public.job_alerts_run()')) ?? '', /permission denied|Not authorised/);

  const run = async () => (await api.asService((s) => s('select public.job_alerts_run() r'))).rows[0].r;
  const r1 = await run();
  assert.ok(r1.candidates_alerted >= 1);
  const alerts = async (c) => (await api.q(`select count(*)::int n from public.notifications where recipient_id=$1 and kind='job.match_alert'`, [c.id])).rows[0].n;
  assert.equal(await alerts(opted), 1); assert.equal(await alerts(quiet), 0);
  await makeJob(api, admin, co, { title: 'Second fresh role' });
  await run();
  assert.equal(await alerts(opted), 1, 'at most one digest in 20 hours');
  assert.equal((await api.q(`select category from private.email_outbox where recipient_id=$1 and kind='job.match_alert'`, [opted.id])).rows[0].category, 'optional');
});

test('job alert emails are capped at 50 a day platform-wide', async () => {
  const filler = await makeCandidate(api, 'Filler Fay');
  await api.q(`insert into private.email_outbox (recipient_id, kind, subject, category)
               select $1, 'job.match_alert', 'filler', 'optional' from generate_series(1, 55)`, [filler.id]);
  const r = (await api.asService((s) => s('select public.job_alerts_run() r'))).rows[0].r;
  assert.ok(r.emails_capped >= 5);
  const kept = (await api.q(`select count(*)::int n from private.email_outbox where kind='job.match_alert' and created_at >= date_trunc('day', now()) and status <> 'suppressed'`)).rows[0].n;
  assert.ok(kept <= 50);
  assert.ok((await api.q(`select 1 from private.email_outbox where last_error='daily_alert_cap'`)).rows.length >= 5);
});

// ---- Funnel -------------------------------------------------------------------------------------------------------

test('admin funnel counts real activity only and is restricted to admins', async () => {
  const stage = (f, s) => f.stages.find((x) => x.stage === s).count;
  const funnel = async () => (await as(admin, 'select public.admin_funnel(30) f'))[0].f;
  assert.match(await failure(emp('select public.admin_funnel()')) ?? '', /not authori|permission|admin/i);
  const before = await funnel();

  const qaCo = await makeCompany(api, admin, 'QA Test Co 7');
  await makeJob(api, admin, qaCo, { title: 'QA job' });
  const qa = await makeCandidate(api, 'QA Bot', { email: undefined });
  await api.q(`update public.profiles set email='qa+bot@getkaamsetu.in' where id=$1`, [qa.id]);
  await apply(qa);
  const realJob = await makeJob(api, admin, co, { title: 'Funnel role' });
  const app = await apply(await makeCandidate(api, 'Real Rhea'), realJob);
  await emp(`select public.transition_application($1,'viewed')`, [app]);

  const after = await funnel();
  assert.equal(stage(after, 'job_published') - stage(before, 'job_published'), 1);
  assert.equal(stage(after, 'application_submitted') - stage(before, 'application_submitted'), 1);
  assert.equal(stage(after, 'employer_first_action') - stage(before, 'employer_first_action'), 1);
  assert.deepEqual(after.stages.map((s) => s.stage), ['job_published', 'application_submitted', 'employer_first_action', 'offer_issued', 'offer_accepted', 'joined_day_1', 'retained_day_15', 'retained_day_30']);
  assert.ok(after.outcome_reasons.some((r) => r.reason === 'Skills or experience do not match the role'));
  assert.ok(!JSON.stringify(after).includes('Rhea'), 'aggregates only');
});
