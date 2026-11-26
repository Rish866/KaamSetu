// Outcome-based hiring ledger (migration 202611260004): fee terms, snapshot at offer acceptance, milestone-driven
// status, disputes, payments, voids, waivers, immutable history and visibility.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { failure } from './harness.mjs';
import { world, makeCompany, makeJob, makeCandidate } from './fixtures.mjs';

let api, admin, co, job;
const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const emp = (sql, p) => api.as(co.owner, (s) => s(sql, p));
const setFee = (enabled, amount, milestone, why = 'Pilot pricing agreed by the owner') =>
  api.as(admin, (s) => s('select public.admin_set_hire_fee($1,$2,$3,$4) v', [enabled, amount, milestone, why]));
const entry = async (app) => (await api.q('select id, status, amount_inr, fee_milestone, payment_reference from public.hiring_ledger where application_id=$1', [app])).rows[0] ?? null;
const pendingMid = async (app, kind) => (await api.q(`select id from public.hiring_milestones where application_id=$1 and kind=$2 and status='pending'`, [app, kind])).rows[0].id;

async function toHire(name) {
  const cand = await makeCandidate(api, name);
  const app = await api.as(cand, async (s) => (await s('select public.apply_to_job($1) id', [job])).rows[0].id);
  const t = (to, det) => emp('select public.transition_application($1,$2,null,$3)', [app, to, det ?? null]);
  await t('viewed'); await t('shortlisted');
  await emp(`select public.propose_interview($1,$2,'video','link')`, [app, new Date(Date.now() + 86400e3).toISOString()]);
  await t('offer', 'CTC 6 LPA');
  await api.as(cand, async (s) => { await s("select public.set_consent('joining_verification', true, '2026-11-26.2')"); return s('select public.respond_to_offer($1, true)', [app]); });
  return { cand, app };
}
/** Employer reports, candidate confirms. */
async function confirmed(c, kind, on) {
  await emp('select public.report_hiring_milestone($1,$2,$3)', [c.app, kind, on ?? null]);
  await api.as(c.cand, async (s) => s('select public.confirm_hiring_milestone($1)', [await pendingMid(c.app, kind)]));
}

before(async () => {
  ({ api, admin } = await world());
  co = await makeCompany(api, admin, 'Fee Co');
  job = await makeJob(api, admin, co, { title: 'Fee role' });
});

test('fees are off and ₹0 by default: a hire creates no ledger entry, and the terms are visible to signed-in users', async () => {
  const c = await toHire('Free Hire');
  assert.equal(await entry(c.app), null);
  const flags = (await api.as(c.cand, (s) => s('select public.platform_flags() f'))).rows[0].f;
  assert.deepEqual(flags.hire_fee, { enabled: false, amount_inr: 0, milestone: 'retained_day_15' });
});

test('only administrators set fee terms, with a reason and valid values; the change is audited', async () => {
  assert.match(await failure(api.as(co.owner, (s) => s(`select public.admin_set_hire_fee(true, 5000, 'joined_day_1', 'I would like this')`))) ?? '', /Not authorised|admin/i);
  assert.match(await failure(setFee(true, 5000, 'joined_day_1', 'short')) ?? '', /reason/);
  assert.match(await failure(setFee(true, 0, 'joined_day_1')) ?? '', /above ₹0/);
  assert.match(await failure(setFee(true, 5000, 'offer_accepted')) ?? '', /day 1, day 15 or day 30/);
  const v = (await setFee(true, 10000, 'joined_day_1')).rows[0].v;
  assert.deepEqual(v, { enabled: true, amount_inr: 10000, milestone: 'joined_day_1' });
  const a = (await api.q(`select metadata from private.audit_events where action='settings.hire_fee' order by created_at desc limit 1`)).rows[0].metadata;
  assert.deepEqual([a.before.enabled, a.after.amount_inr], [false, 10000]);
});

test('terms are copied at offer acceptance; the fee becomes payable only when its milestone is confirmed by both sides', async () => {
  await setFee(true, 10000, 'joined_day_1');
  const c = await toHire('Paid Hire');
  assert.deepEqual((({ status, amount_inr, fee_milestone }) => ({ status, amount_inr, fee_milestone }))(await entry(c.app)),
    { status: 'pending_milestone', amount_inr: 10000, fee_milestone: 'joined_day_1' });
  await setFee(true, 20000, 'retained_day_30', 'Price change for new hires only');
  assert.equal((await entry(c.app)).amount_inr, 10000, 'later changes never apply to existing hires');
  await emp(`select public.report_hiring_milestone($1,'joined_day_1')`, [c.app]);
  assert.equal((await entry(c.app)).status, 'pending_milestone', 'a one-sided report is not enough');
  await api.as(c.cand, async (s) => s('select public.confirm_hiring_milestone($1)', [await pendingMid(c.app, 'joined_day_1')]));
  assert.equal((await entry(c.app)).status, 'payable');

  const e = await entry(c.app);
  assert.match(await failure(api.as(c.cand, (s) => s(`select public.dispute_ledger_entry($1,'I do not want this fee')`, [e.id]))) ?? '', /not found/);
  assert.match(await failure(emp(`select public.dispute_ledger_entry($1,'no')`, [e.id])) ?? '', /reason/);
  await emp(`select public.dispute_ledger_entry($1,'The candidate left on the first day; we will share proof')`, [e.id]);
  assert.equal((await entry(c.app)).status, 'disputed');
  await api.as(admin, (s) => s(`select public.admin_ledger_action($1,'uphold','Attendance proof shows a full first week')`, [e.id]));
  assert.equal((await entry(c.app)).status, 'payable');
  assert.match(await failure(api.as(admin, (s) => s(`select public.admin_ledger_action($1,'mark_paid','Payment received')`, [e.id]))) ?? '', /payment reference/);
  await api.as(admin, (s) => s(`select public.admin_ledger_action($1,'mark_paid','Payment received','UPI 412345678901')`, [e.id]));
  assert.deepEqual([(await entry(c.app)).status, (await entry(c.app)).payment_reference], ['paid', 'UPI 412345678901']);
  assert.match(await failure(api.as(admin, (s) => s(`select public.admin_ledger_action($1,'waive','Changed our mind on this')`, [e.id]))) ?? '', /not possible/);
  const hist = (await api.q('select to_status, actor_id is null auto from public.hiring_ledger_events where entry_id=$1 order by created_at, id', [e.id])).rows;
  assert.deepEqual(hist.map((h) => h.to_status), ['pending_milestone', 'payable', 'disputed', 'payable', 'paid']);
  assert.deepEqual(hist.slice(0, 2).map((h) => h.auto), [true, true], 'creation and payable are automatic');
  assert.ok(await failure(api.q(`update public.hiring_ledger_events set reason='edited' where entry_id=$1`, [e.id])), 'history is immutable');
  assert.ok((await api.as(co.owner, (s) => s('select kind from public.notifications'))).rows.some((n) => n.kind === 'ledger.paid'));
});

test('no fee when the hire does not happen: no-show, or leaving before the fee milestone', async () => {
  await setFee(true, 15000, 'retained_day_15');
  const a = await toHire('No Show Fee');
  await confirmed(a, 'candidate_no_show');
  assert.equal((await entry(a.app)).status, 'void');
  const b = await toHire('Early Leaver');
  await confirmed(b, 'joined_day_1', day(-20));
  await confirmed(b, 'left_before_day_30', day(-11));
  assert.equal((await entry(b.app)).status, 'void', 'left on day 9, before the day-15 milestone');
  const c = await toHire('Day Fifteen');
  await confirmed(c, 'joined_day_1', day(-20));
  await confirmed(c, 'retained_day_15');
  assert.equal((await entry(c.app)).status, 'payable');
  await confirmed(c, 'left_before_day_30', day(-2));
  assert.equal((await entry(c.app)).status, 'payable', 'leaving after the fee milestone does not cancel an earned fee');
  const w = await toHire('Waived Hire');
  await api.as(admin, async (s) => s(`select public.admin_ledger_action($1,'waive','First hire free for pilot employers')`, [(await entry(w.app)).id]));
  assert.equal((await entry(w.app)).status, 'waived');
});

test('the ledger is visible to the company owner and recruiters and to administrators only; never writable directly', async () => {
  await setFee(true, 8000, 'joined_day_1');
  const c = await toHire('Visible Hire');
  const own = (await emp('select * from public.company_ledger($1) v', [co.companyId])).rows.map((r) => r.v);
  const row = own.find((r) => r.application_id === c.app);
  assert.deepEqual([row.job_title, row.candidate_name, row.amount_inr, row.fee_milestone_label], ['Fee role', 'Visible Hire', 8000, 'Joined (day 1)']);
  assert.equal((await api.as(c.cand, (s) => s('select id from public.hiring_ledger'))).rows.length, 0, 'candidates are never a party');
  assert.match(await failure(api.as(c.cand, (s) => s('select * from public.company_ledger($1)', [co.companyId]))) ?? '', /not found/);
  const other = await makeCompany(api, admin, 'Nosy Co');
  assert.equal((await api.as(other.owner, (s) => s('select id from public.hiring_ledger'))).rows.length, 0);
  assert.match(await failure(api.as(co.owner, (s) => s(`select * from public.admin_ledger()`))) ?? '', /Not authorised|admin/i);
  assert.ok((await api.as(admin, (s) => s(`select * from public.admin_ledger('pending_milestone')`))).rows.length >= 1);
  assert.ok(await failure(emp(`update public.hiring_ledger set status='waived' where application_id=$1`, [c.app])));
  assert.ok(await failure(emp(`insert into public.hiring_ledger (company_id, application_id, amount_inr, fee_milestone) values ($1,$2,1,'joined_day_1')`, [co.companyId, c.app])));
  await setFee(false, 0, 'retained_day_15', 'Back to free hiring for the pilot');
});
