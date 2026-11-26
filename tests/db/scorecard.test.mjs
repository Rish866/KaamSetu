// Employer accountability scorecard and stale-job auto-pause (migration 202611260003).
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { failure } from './harness.mjs';
import { world, makeCompany, makeJob, makeCandidate } from './fixtures.mjs';

let api, admin, viewer;
const card = async (who, company) => (await api.as(who, (s) => s('select * from public.company_scorecards($1::uuid[]) v', [[company]]))).rows[0]?.v ?? null;
const apply = async (cand, job) => api.as(cand, async (s) => (await s('select public.apply_to_job($1) id', [job])).rows[0].id);
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

before(async () => { ({ api, admin } = await world()); viewer = await makeCandidate(api, 'Viewer Vik'); });

test('a company without enough history is shown as a new employer, with no numbers', async () => {
  const co = await makeCompany(api, admin, 'Fresh Co');
  const job = await makeJob(api, admin, co, { title: 'Fresh role' });
  await apply(await makeCandidate(api, 'Only One'), job);
  const c = await card(viewer, co.companyId);
  assert.equal(c.new_employer, true);
  assert.equal(c.active_jobs, 1);
  for (const k of ['response', 'offers', 'joining', 'retention']) assert.equal(c[k].shown, false, k);
  assert.equal(c.response.median_hours, null); assert.equal(c.offers.honoured_pct, null);
});

test('response speed: median hours and share answered within 7 days, from real events only', async () => {
  const co = await makeCompany(api, admin, 'Speedy Co');
  const job = await makeJob(api, admin, co, { title: 'Speedy role' });
  const hours = [2, 10, 30, 200]; const apps = [];
  for (let i = 0; i < hours.length; i++) {
    const a = await apply(await makeCandidate(api, `Resp ${i}`), job); apps.push(a);
    await api.as(co.owner, (s) => s(`select public.transition_application($1,'viewed')`, [a]));
    await api.q('update public.applications set applied_at=$2 where id=$1', [a, ago(hours[i] + 1)]);
    // History is immutable by design; the test backdates it with triggers bypassed (superuser only).
    await api.db.exec(`set session_replication_role = replica; update public.application_events set created_at='${ago(1)}' where application_id='${a}' and to_stage='viewed'; set session_replication_role = origin;`);
  }
  const silent = await apply(await makeCandidate(api, 'Unanswered'), job);
  await api.q('update public.applications set applied_at=$2 where id=$1', [silent, ago(8 * 24)]);
  const recent = await apply(await makeCandidate(api, 'Too recent'), job); // under 7 days, unanswered: not counted yet
  const gone = await makeCandidate(api, 'Withdrew');
  const g = await apply(gone, job);
  await api.as(gone, (s) => s('select public.withdraw_application($1)', [g]));
  await api.q('update public.applications set applied_at=$2 where id=$1', [g, ago(10 * 24)]);
  const c = await card(viewer, co.companyId);
  assert.equal(c.response.sample, 5, 'four answered + one unanswered over 7 days; the recent and the withdrawn ones are left out');
  assert.equal(c.response.shown, true);
  assert.equal(c.response.median_hours, 20, 'median of 2, 10, 30, 200 hours');
  assert.equal(c.response.within_7_days_pct, 60, '3 of 5 answered within 7 days');
  assert.equal(c.new_employer, false);
  assert.ok(recent);
});

test('offers honoured, joining and day-30 retention count confirmed milestones only', async () => {
  const co = await makeCompany(api, admin, 'Honest Co');
  const job = await makeJob(api, admin, co, { title: 'Honest role' });
  const apps = []; const cands = [];
  for (let i = 0; i < 5; i++) {
    const c = await makeCandidate(api, `Hire ${i}`); cands.push(c); apps.push(await apply(c, job));
    await api.as(c, (s) => s("select public.set_consent('joining_verification', true, '2026-11-26.2')"));
  }
  const add = (i, kind, status = 'confirmed') => api.q(`insert into public.hiring_milestones (application_id, company_id, candidate_id, kind, status, reported_by, reported_role)
    values ($1,$2,$3,$4,$5,$6,'employer')`, [apps[i], co.companyId, cands[i].id, kind, status, co.owner.id]);
  for (const i of [0, 1, 2, 3]) await add(i, 'offer_issued');
  await add(3, 'offer_withdrawn');
  await add(0, 'joined_day_1'); await add(1, 'joined_day_1'); await add(2, 'candidate_no_show');
  await add(4, 'joined_day_1', 'pending'); // unconfirmed: ignored
  await add(0, 'retained_day_30'); await add(1, 'left_before_day_30');
  const c = await card(viewer, co.companyId);
  assert.deepEqual([c.offers.sample, c.offers.withdrawn, c.offers.honoured_pct, c.offers.shown], [4, 1, 75, true]);
  assert.deepEqual([c.joining.sample, c.joining.joined_pct, c.joining.shown], [3, 67, true]);
  assert.deepEqual([c.retention.sample, c.retention.day_30_pct, c.retention.shown], [2, null, false], 'two outcomes are not enough to show');
});

test('only verified companies are public; members always see their own; anonymous visitors see nothing', async () => {
  const pending = await makeCompany(api, admin, 'Pending Co', { approve: false });
  assert.equal(await card(viewer, pending.companyId), null);
  assert.ok(await card(pending.owner, pending.companyId));
  assert.match(await failure(api.as(null, (s) => s('select * from public.company_scorecards($1::uuid[])', [[pending.companyId]]))) ?? '', /permission denied/);
});

test('job detail carries the scorecard, the place label and when the job was last confirmed', async () => {
  const co = await makeCompany(api, admin, 'Detail Co');
  const job = await makeJob(api, admin, co, { title: 'Detail role', city: 'Pune' });
  const d = (await api.as(viewer, (s) => s('select public.job_detail($1) v', [job]))).rows[0].v;
  assert.equal(d.location_label, 'Pune, Maharashtra');
  assert.equal(d.scorecard.new_employer, true);
  assert.ok(Date.now() - Date.parse(d.last_confirmed_at) < 60e3, 'approval counts as confirmation');
});

test('stale jobs: reminder after 25 days, automatic pause after 30, confirmation and resume reset the clock', async () => {
  const co = await makeCompany(api, admin, 'Stale Co');
  const remind = await makeJob(api, admin, co, { title: 'Remind me' });
  const pause = await makeJob(api, admin, co, { title: 'Pause me' });
  await api.q(`update public.jobs set last_confirmed_at = now() - interval '26 days' where id=$1`, [remind]);
  await api.q(`update public.jobs set last_confirmed_at = now() - interval '31 days' where id=$1`, [pause]);
  assert.match(await failure(api.as(co.owner, (s) => s('select public.jobs_stale_sweep()'))) ?? '', /permission denied|Not authorised/);
  const r = (await api.asService((s) => s('select public.jobs_stale_sweep() v'))).rows[0].v;
  assert.ok(r.reminded >= 1 && r.paused >= 1);
  const st = async (j) => (await api.q('select status, stale_reminder_at is not null reminded from public.jobs where id=$1', [j])).rows[0];
  assert.deepEqual(await st(remind), { status: 'published', reminded: true });
  assert.equal((await st(pause)).status, 'paused');
  const ev = (await api.q(`select actor_id, reason from public.job_events where job_id=$1 order by created_at desc limit 1`, [pause])).rows[0];
  assert.deepEqual(ev, { actor_id: null, reason: 'Paused automatically: not confirmed as still open for 30 days' });
  const kinds = (await api.as(co.owner, (s) => s('select kind from public.notifications'))).rows.map((n) => n.kind);
  assert.ok(kinds.includes('job.confirm_needed') && kinds.includes('job.auto_paused'));
  assert.equal((await api.asService((s) => s('select public.jobs_stale_sweep() v'))).rows[0].v.reminded, 0, 'one reminder only');
  // Employer confirms the reminded job; resumes the paused one.
  assert.match(await failure(api.as(viewer, (s) => s('select public.confirm_job_active($1)', [remind]))) ?? '', /not found/);
  await api.as(co.owner, (s) => s('select public.confirm_job_active($1)', [remind]));
  assert.deepEqual(await st(remind), { status: 'published', reminded: false });
  assert.match(await failure(api.as(co.owner, (s) => s('select public.confirm_job_active($1)', [pause]))) ?? '', /Only a published job/);
  await api.as(co.owner, (s) => s(`select public.set_job_status($1,'published')`, [pause]));
  const fresh = (await api.q('select now() - last_confirmed_at < interval \'1 minute\' ok from public.jobs where id=$1', [pause])).rows[0].ok;
  assert.equal(fresh, true);
  assert.ok((await api.q(`select count(*)::int n from private.audit_events where action in ('job.confirmed_active','job.auto_paused')`)).rows[0].n >= 2);
});
