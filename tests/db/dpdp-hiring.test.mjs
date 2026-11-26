// DPDP alignment for hiring data (migration 202611260005): joining-verification consent, export, deletion.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { failure } from './harness.mjs';
import { world, makeCompany, makeJob, makeCandidate, stateLoc } from './fixtures.mjs';

let api, admin, co, job;
const V = '2026-11-26.2';
const emp = (sql, p) => api.as(co.owner, (s) => s(sql, p));
const consent = (c, on) => api.as(c, (s) => s('select public.set_consent($1,$2,$3)', ['joining_verification', on, V]));
const pending = async (app, kind) => (await api.q(`select id from public.hiring_milestones where application_id=$1 and kind=$2 and status='pending'`, [app, kind])).rows[0]?.id;

async function toOffer(name) {
  const cand = await makeCandidate(api, name);
  const app = await api.as(cand, async (s) => (await s('select public.apply_to_job($1) id', [job])).rows[0].id);
  const t = (to, det) => emp('select public.transition_application($1,$2,null,$3)', [app, to, det ?? null]);
  await t('viewed'); await t('shortlisted');
  await emp(`select public.propose_interview($1,$2,'video','link')`, [app, new Date(Date.now() + 86400e3).toISOString()]);
  await t('offer', 'CTC 6 LPA');
  return { cand, app };
}
const accept = (c) => api.as(c.cand, (s) => s('select public.respond_to_offer($1, true)', [c.app]));

before(async () => {
  ({ api, admin } = await world());
  co = await makeCompany(api, admin, 'Privacy Hire Co');
  job = await makeJob(api, admin, co, { title: 'Privacy role' });
});

test('accepting an offer needs the joining-verification consent, which is recorded with the notice version', async () => {
  const c = await toOffer('Consent Kiran');
  assert.match(await failure(accept(c)) ?? '', /Agree to joining confirmations/);
  assert.equal((await api.q('select stage from public.applications where id=$1', [c.app])).rows[0].stage, 'offer', 'nothing changed');
  await consent(c.cand, true); await accept(c);
  const rec = (await api.q(`select action, notice_version from public.consent_records where user_id=$1 and purpose='joining_verification'`, [c.cand.id])).rows;
  assert.deepEqual(rec, [{ action: 'granted', notice_version: V }]);
  assert.match(await failure(api.as(c.cand, (s) => s(`select public.set_consent('joining_vetting', true, $1)`, [V]))) ?? '', /Unknown consent purpose/);
});

test('withdrawing consent stops new joining records, confirmations and auto-confirmation, and tells the employer', async () => {
  const c = await toOffer('Withdraw Wani');
  await consent(c.cand, true); await accept(c);
  await emp(`select public.report_hiring_milestone($1,'joined_day_1')`, [c.app]);
  const mid = await pending(c.app, 'joined_day_1');
  await consent(c.cand, false);
  assert.ok((await api.as(co.owner, (s) => s('select kind from public.notifications'))).rows.some((n) => n.kind === 'hiring.consent_withdrawn'));
  assert.match(await failure(api.as(c.cand, (s) => s('select public.confirm_hiring_milestone($1)', [mid]))) ?? '', /not agreed to joining confirmations/);
  await api.q(`update public.hiring_milestones set reported_at = now() - interval '8 days' where id=$1`, [mid]);
  await api.asService((s) => s('select public.hiring_milestones_auto_confirm()'));
  assert.equal((await api.q('select status from public.hiring_milestones where id=$1', [mid])).rows[0].status, 'pending', 'not auto-confirmed without consent');
  // Admins can still decide records made while consent was given.
  await api.as(admin, (s) => s(`select public.admin_resolve_hiring_milestone($1,'confirm','Attendance register checked by KaamSetu')`, [mid]));
  assert.equal((await api.q('select status from public.hiring_milestones where id=$1', [mid])).rows[0].status, 'confirmed');
  // Giving consent again resumes normal reporting.
  await consent(c.cand, true);
  await api.q(`update public.hiring_milestones set occurred_on = current_date - 20 where id=$1`, [mid]);
  await emp(`select public.report_hiring_milestone($1,'retained_day_15')`, [c.app]);
  assert.ok(await pending(c.app, 'retained_day_15'));
});

test('"Download my data" includes hiring records and readable place names', async () => {
  const c = await toOffer('Export Esha');
  await consent(c.cand, true); await accept(c);
  await api.q(`insert into public.candidate_locations (candidate_id, location_id, preference_rank) values ($1,$2,1)`, [c.cand.id, await stateLoc(api, 'KA')]);
  await api.as(c.cand, (s) => s(`select public.report_hiring_milestone($1,'joined_day_1',null,'Joined the Pune office')`, [c.app]));
  const out = (await api.as(c.cand, (s) => s('select public.request_data_export() v'))).rows[0].v;
  assert.equal(out.export_version, 2);
  assert.equal(out.current_location, 'Navi Mumbai (Thane), Maharashtra');
  assert.deepEqual(out.preferred_locations, [{ place: 'Karnataka (entire state)', kind: 'state', rank: 1 }]);
  const h = out.hiring.find((x) => x.job === 'Privacy role');
  assert.deepEqual(h.milestones.map((m) => [m.milestone, m.status]), [['Offer made', 'confirmed'], ['Offer accepted', 'confirmed'], ['Joined (day 1)', 'pending']]);
  assert.equal(h.milestones[2].note, 'Joined the Pune office');
  assert.ok(Array.isArray(out.applications) && out.consents.some((x) => x.purpose === 'joining_verification'), 'earlier sections are still there');
  assert.ok((await api.q(`select count(*)::int n from public.privacy_requests where user_id=$1 and kind='export'`, [c.cand.id])).rows[0].n === 1, 'export is still logged once');
  assert.match(await failure(api.as(c.cand, (s) => s('select private.data_export_base()'))) ?? '', /permission denied/);
});

test('account deletion closes open joining reports and removes notes the person wrote; confirmed outcomes stay anonymised', async () => {
  const c = await toOffer('Delete Deep');
  await consent(c.cand, true); await accept(c);
  await api.as(c.cand, (s) => s(`select public.report_hiring_milestone($1,'joined_day_1',null,'My personal note')`, [c.app]));
  const rid = (await api.as(c.cand, (s) => s('select public.request_account_deletion() id'))).rows[0].id;
  await api.as(admin, (s) => s(`select public.admin_process_deletion($1,'Identity confirmed by email reply')`, [rid]));
  const rows = (await api.q('select kind, status, note, resolution_reason from public.hiring_milestones where application_id=$1 order by reported_at', [c.app])).rows;
  assert.deepEqual(rows.map((r) => r.status), ['confirmed', 'confirmed', 'rejected']);
  assert.equal(rows[2].note, null); assert.equal(rows[2].resolution_reason, 'Closed: account deleted');
  assert.equal((await api.q('select display_name from public.profiles where id=$1', [c.cand.id])).rows[0].display_name, 'Deleted user');
});
