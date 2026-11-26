// Offer and joining milestones (migration 202611260002): two-sided confirmation, disputes, auto-confirmation, audit.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { failure } from './harness.mjs';
import { world, makeCompany, makeJob, makeCandidate } from './fixtures.mjs';

let api, admin, co, job;
const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const rows = async (who, sql, p) => (await api.as(who, (s) => s(sql, p))).rows;
const ms = async (app) => (await api.q('select kind, status, reported_role, confirmed_via, occurred_on::text d, note from public.hiring_milestones where application_id=$1 order by reported_at, kind', [app])).rows;
const stage = async (app) => (await api.q('select stage from public.applications where id=$1', [app])).rows[0].stage;
const emp = (sql, p) => api.as(co.owner, (s) => s(sql, p));

/** Candidate applies; employer takes them to an offer. Returns { cand, app }. */
async function toOffer(name, details = 'CTC 6 LPA, joining on the 1st') {
  const cand = await makeCandidate(api, name);
  const app = await api.as(cand, async (s) => (await s('select public.apply_to_job($1) id', [job])).rows[0].id);
  const t = (to, det) => emp('select public.transition_application($1,$2,null,$3)', [app, to, det ?? null]);
  await t('viewed'); await t('shortlisted');
  await emp(`select public.propose_interview($1,$2,'video','link')`, [app, new Date(Date.now() + 86400e3).toISOString()]);
  await t('offer', details);
  return { cand, app };
}
async function toHire(name) { const r = await toOffer(name); await api.as(r.cand, async (s) => { await s("select public.set_consent('joining_verification', true, '2026-11-26.2')"); return s('select public.respond_to_offer($1, true)', [r.app]); }); return r; }

before(async () => {
  ({ api, admin } = await world());
  co = await makeCompany(api, admin, 'Hire Co');
  job = await makeJob(api, admin, co, { title: 'Hiring role' });
});

test('an offer is recorded automatically; only the candidate turns it into a hire', async () => {
  const { cand, app } = await toOffer('Offer Olga', 'CTC 6 LPA');
  assert.deepEqual(await ms(app), [{ kind: 'offer_issued', status: 'confirmed', reported_role: 'employer', confirmed_via: 'single_party', d: day(0), note: 'CTC 6 LPA' }]);
  assert.match(await failure(emp('select public.transition_application($1,$2)', [app, 'hired'])) ?? '', /candidate accepts the offer/);
  assert.match(await failure(emp('select public.respond_to_offer($1, true)', [app])) ?? '', /Only the candidate/);
  const stranger = await makeCandidate(api, 'Stranger Sam');
  assert.match(await failure(api.as(stranger, async (s) => { await s("select public.set_consent('joining_verification', true, '2026-11-26.2')"); return s('select public.respond_to_offer($1, true)', [app]); })) ?? '', /not found/);
  await api.as(cand, async (s) => { await s("select public.set_consent('joining_verification', true, '2026-11-26.2')"); return s('select public.respond_to_offer($1, true)', [app]); });
  assert.equal(await stage(app), 'hired');
  assert.deepEqual((await ms(app)).map((m) => [m.kind, m.status]), [['offer_issued', 'confirmed'], ['offer_accepted', 'confirmed']]);
  assert.match(await failure(api.as(cand, async (s) => { await s("select public.set_consent('joining_verification', true, '2026-11-26.2')"); return s('select public.respond_to_offer($1, true)', [app]); })) ?? '', /no open offer/);
  assert.ok((await rows(co.owner, 'select kind from public.notifications')).some((n) => n.kind === 'hiring.offer_accepted'));
});

test('declining an offer withdraws the application with the candidate\'s reason', async () => {
  const { cand, app } = await toOffer('Decline Dev');
  await api.as(cand, (s) => s(`select public.respond_to_offer($1, false, 'Accepted another role')`, [app]));
  assert.equal(await stage(app), 'withdrawn');
  const m = (await ms(app)).find((x) => x.kind === 'offer_declined');
  assert.deepEqual([m.status, m.note], ['confirmed', 'Accepted another role']);
  const ev = (await api.q(`select reason from public.application_events where application_id=$1 and to_stage='withdrawn'`, [app])).rows[0];
  assert.equal(ev.reason, 'Offer declined: Accepted another role');
});

test('joining date: employer only, sensible dates, and joining cannot be reported before it', async () => {
  const { cand, app } = await toHire('Date Divya');
  assert.match(await failure(api.as(cand, (s) => s('select public.set_joining_date($1,$2)', [app, day(5)]))) ?? '', /Only the employer/);
  assert.match(await failure(emp('select public.set_joining_date($1,$2)', [app, day(400)])) ?? '', /within the next year/);
  await emp('select public.set_joining_date($1,$2)', [app, day(0)]);
  assert.equal((await api.q('select joining_date::text d from public.applications where id=$1', [app])).rows[0].d, day(0));
  assert.match(await failure(emp(`select public.report_hiring_milestone($1,'joined_day_1',$2)`, [app, day(-1)])) ?? '', /before the agreed joining date/);
  assert.match(await failure(emp(`select public.report_hiring_milestone($1,'joined_day_1',$2)`, [app, day(1)])) ?? '', /last 90 days/);
  assert.ok((await rows(cand, 'select kind from public.notifications')).some((n) => n.kind === 'hiring.joining_date'));
});

test('two-sided joining: one side reports, the other confirms; nobody confirms their own report', async () => {
  const { cand, app } = await toHire('Joiner Jai');
  const mid = (await emp(`select public.report_hiring_milestone($1,'joined_day_1') id`, [app])).rows[0].id;
  assert.equal((await ms(app)).find((m) => m.kind === 'joined_day_1').status, 'pending');
  assert.ok((await rows(cand, 'select kind, title from public.notifications')).some((n) => n.kind === 'hiring.confirm_needed' && n.title === 'Please confirm: Joined (day 1)'));
  assert.match(await failure(emp('select public.confirm_hiring_milestone($1)', [mid])) ?? '', /other side confirms/);
  await api.as(cand, (s) => s('select public.confirm_hiring_milestone($1)', [mid]));
  assert.deepEqual((({ status, confirmed_via }) => ({ status, confirmed_via }))((await ms(app)).find((m) => m.kind === 'joined_day_1')), { status: 'confirmed', confirmed_via: 'counterparty' });
  assert.match(await failure(api.as(cand, (s) => s('select public.confirm_hiring_milestone($1)', [mid]))) ?? '', /already confirmed/);
  assert.match(await failure(emp(`select public.report_hiring_milestone($1,'joined_day_1')`, [app])) ?? '', /already recorded/);
  assert.match(await failure(emp(`select public.report_hiring_milestone($1,'candidate_no_show')`, [app])) ?? '', /already recorded/);
  assert.match(await failure(emp(`select public.report_hiring_milestone($1,'retained_day_15')`, [app])) ?? '', /Day 15 has not been reached/);
  assert.match(await failure(emp(`select public.withdraw_offer($1,'Budget was cut')`, [app])) ?? '', /already joined/);
  const audit = (await api.q(`select action from private.audit_events where target_id=$1 order by created_at`, [app])).rows.map((r) => r.action);
  assert.ok(audit.includes('hiring.joined_day_1.reported') && audit.includes('hiring.joined_day_1.confirmed'));
});

test('no-show is employer-only; retention dates follow the joining day', async () => {
  const a = await toHire('No Show Nia');
  assert.match(await failure(api.as(a.cand, (s) => s(`select public.report_hiring_milestone($1,'candidate_no_show')`, [a.app]))) ?? '', /Only the employer/);
  await emp(`select public.report_hiring_milestone($1,'candidate_no_show')`, [a.app]);
  assert.match(await failure(api.as(a.cand, (s) => s(`select public.report_hiring_milestone($1,'joined_day_1')`, [a.app]))) ?? '', /already recorded/);

  const b = await toHire('Stayer Sid');
  await api.as(b.cand, (s) => s(`select public.report_hiring_milestone($1,'joined_day_1',$2)`, [b.app, day(-30)]));
  await emp(`select public.report_hiring_milestone($1,'retained_day_15')`, [b.app]);
  await emp(`select public.report_hiring_milestone($1,'retained_day_30')`, [b.app]);
  const got = Object.fromEntries((await ms(b.app)).map((m) => [m.kind, m.d]));
  assert.deepEqual([got.joined_day_1, got.retained_day_15, got.retained_day_30], [day(-30), day(-15), day(0)]);
  assert.match(await failure(emp(`select public.report_hiring_milestone($1,'left_before_day_30',$2)`, [b.app, day(-5)])) ?? '', /Day 30 is already recorded/);

  const c = await toHire('Leaver Lata');
  await emp(`select public.report_hiring_milestone($1,'joined_day_1',$2)`, [c.app, day(-10)]);
  assert.match(await failure(emp(`select public.report_hiring_milestone($1,'left_before_day_30',$2)`, [c.app, day(-11)])) ?? '', /first 30 days/);
  await emp(`select public.report_hiring_milestone($1,'left_before_day_30',$2,'Resigned')`, [c.app, day(-2)]);
  assert.match(await failure(emp(`select public.report_hiring_milestone($1,'retained_day_30')`, [c.app])) ?? '', /Day 30 has not been reached|Leaving before day 30/);
});

test('disputes go to administrators, who decide with a reason; a rejected report can be filed again', async () => {
  const { cand, app } = await toHire('Dispute Dia');
  const mid = (await api.as(cand, (s) => s(`select public.report_hiring_milestone($1,'joined_day_1') id`, [app]))).rows[0].id;
  assert.match(await failure(emp('select public.dispute_hiring_milestone($1,$2)', [mid, 'no'])) ?? '', /reason/);
  await emp('select public.dispute_hiring_milestone($1,$2)', [mid, 'The candidate did not come on the agreed day']);
  assert.match(await failure(emp('select * from public.admin_hiring_disputes()')) ?? '', /Not authorised|admin/i);
  const q = await rows(admin, 'select milestone_id, label, job_title, company_name, dispute_reason from public.admin_hiring_disputes()');
  const d = q.find((r) => r.milestone_id === mid);
  assert.deepEqual([d.label, d.job_title, d.company_name], ['Joined (day 1)', 'Hiring role', 'Hire Co']);
  assert.match(await failure(api.as(admin, (s) => s(`select public.admin_resolve_hiring_milestone($1,'reject','')`, [mid]))) ?? '', /reason/);
  await api.as(admin, (s) => s(`select public.admin_resolve_hiring_milestone($1,'reject','Employer attendance record shows no joining')`, [mid]));
  assert.equal((await ms(app)).find((m) => m.kind === 'joined_day_1').status, 'rejected');
  assert.ok((await rows(cand, 'select kind from public.notifications')).some((n) => n.kind === 'hiring.resolved'));
  await emp(`select public.report_hiring_milestone($1,'candidate_no_show')`, [app]);
  assert.ok((await ms(app)).some((m) => m.kind === 'candidate_no_show' && m.status === 'pending'));
});

test('unanswered reports confirm automatically after 7 days (worker only)', async () => {
  const { app } = await toHire('Quiet Quinn');
  const mid = (await emp(`select public.report_hiring_milestone($1,'joined_day_1') id`, [app])).rows[0].id;
  assert.match(await failure(emp('select public.hiring_milestones_auto_confirm()')) ?? '', /permission denied|Not authorised/);
  assert.equal((await api.asService((s) => s('select public.hiring_milestones_auto_confirm() n'))).rows[0].n, 0, 'not before 7 days');
  await api.q(`update public.hiring_milestones set reported_at = now() - interval '8 days' where id=$1`, [mid]);
  assert.ok((await api.asService((s) => s('select public.hiring_milestones_auto_confirm() n'))).rows[0].n >= 1);
  assert.deepEqual((({ status, confirmed_via }) => ({ status, confirmed_via }))((await ms(app)).find((m) => m.kind === 'joined_day_1')), { status: 'confirmed', confirmed_via: 'auto' });
});

test('withdrawing an offer needs a reason, ends the application and tells the candidate', async () => {
  const { cand, app } = await toHire('Withdrawn Wes');
  assert.match(await failure(api.as(cand, (s) => s(`select public.withdraw_offer($1,'Changed my mind')`, [app]))) ?? '', /Only the employer/);
  assert.match(await failure(emp(`select public.withdraw_offer($1,'')`, [app])) ?? '', /reason/);
  await emp(`select public.withdraw_offer($1,'Position was closed by finance')`, [app]);
  assert.equal(await stage(app), 'rejected');
  assert.ok((await rows(cand, 'select kind from public.notifications')).some((n) => n.kind === 'hiring.offer_withdrawn'));
});

test('milestones are readable only by the candidate, the company and administrators; never writable directly', async () => {
  const { cand, app } = await toHire('Private Priya');
  const other = await makeCompany(api, admin, 'Other Co');
  assert.ok((await rows(cand, 'select id from public.hiring_milestones where application_id=$1', [app])).length >= 2);
  assert.equal((await rows(other.owner, 'select id from public.hiring_milestones where application_id=$1', [app])).length, 0);
  assert.ok((await rows(admin, 'select id from public.hiring_milestones where application_id=$1', [app])).length >= 2);
  const mine = (await rows(cand, 'select * from public.hiring_status($1::uuid[])', [[app]]))[0];
  assert.deepEqual(mine.milestones.map((m) => m.label), ['Offer made', 'Offer accepted']);
  assert.equal((await rows(other.owner, 'select * from public.hiring_status($1::uuid[])', [[app]])).length, 0, 'other companies see nothing');
  assert.equal((await rows(co.owner, 'select * from public.hiring_status($1::uuid[])', [[app]])).length, 1);
  assert.ok(await failure(api.as(cand, (s) => s(`update public.hiring_milestones set status='confirmed' where application_id=$1`, [app]))));
  assert.ok(await failure(emp(`insert into public.hiring_milestones (application_id, company_id, candidate_id, kind, status, reported_by, reported_role) values ($1,$2,$3,'joined_day_1','confirmed',$4,'employer')`, [app, co.companyId, cand.id, co.owner.id])));
});
