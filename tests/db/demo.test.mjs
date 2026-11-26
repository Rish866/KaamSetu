// The demo story (scripts/demo/demo-story.mjs) runs end to end on the real migrations, so the local demo never rots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { REAL } from './harness.mjs';
import { world } from './fixtures.mjs';
import { seedDemo, accounts } from '../../scripts/demo/demo-story.mjs';

test('demo story: verified company, readiness answers, tagged outcomes, a hire retained to day 30, access log and funnel', { skip: REAL && 'shared database' }, async () => {
  const { api, admin } = await world();
  const as = async (uid, sql, params) => uid ? (await api.as({ id: uid }, (s) => s(sql, params))).rows : (await api.asService((s) => s(sql, params))).rows;
  const createUser = async (email, name, kind) => (await api.signUp(kind, name, { email })).id;
  const r = await seedDemo({ q: async (sql, p) => (await api.q(sql, p)).rows, as, createUser, log: () => undefined });
  assert.equal(r.demo, 'seeded');
  assert.equal(await seedDemo({ q: async (sql, p) => (await api.q(sql, p)).rows, as, createUser, log: () => undefined }), null, 'runs once');

  const card = (await as(r.id.asha, 'select * from public.company_scorecards($1::uuid[]) v', [[r.company]]))[0].v;
  assert.equal(card.verification.method, 'GSTIN');
  assert.equal(card.commitment.review_days, 3);
  const kinds = (await api.q(`select kind, status from public.hiring_milestones where candidate_id = $1 order by reported_at`, [r.id.asha])).rows;
  for (const k of ['offer_issued', 'offer_accepted', 'joined_day_1', 'retained_day_15', 'retained_day_30'])
    assert.ok(kinds.some((m) => m.kind === k && m.status === 'confirmed'), k);
  const tags = (await api.q(`select e.outcome_tag from public.application_events e join public.applications a on a.id = e.application_id
                             where a.candidate_id = any($1) and e.outcome_tag is not null order by 1`, [[r.id.ravi, r.id.meena]])).rows.map((x) => x.outcome_tag);
  assert.deepEqual(tags, ['relocation_or_commute_change', 'skills_or_experience_gap']);
  assert.equal(r.kabir_found_in_discovery, true);
  const log = (await as(r.id.asha, 'select public.my_access_log() l'))[0].l;
  assert.ok(log.events.some((e) => e.purpose === 'contact_sharing'));
  assert.ok(log.events.some((e) => e.purpose === 'joining_verification'));
  assert.ok((await as(r.id.kabir, 'select public.my_access_log() l'))[0].l.events.some((e) => e.what === 'Invited you to apply'));
  const ledger = (await api.q('select count(*)::int n from public.hiring_ledger where company_id = $1', [r.company])).rows[0].n;
  assert.ok(ledger >= 1, 'fee entry created (fees are on in the demo only)');
  const funnel = (await api.as(admin, (s) => s('select public.admin_funnel(30) f'))).rows[0].f;
  assert.equal(funnel.stages.find((s) => s.stage === 'retained_day_30').count, 1);
  assert.ok(Object.keys(accounts).length >= 6);
});

test('the demo seeder refuses anything but localhost', () => {
  const r = spawnSync(process.execPath, ['scripts/demo/seed-demo.mjs'], { env: { ...process.env, DEMO_DB_URL: 'postgresql://u:p@db.zrexqtzhdkkupyxmfqxd.supabase.co:5432/postgres', DEMO_SERVICE_KEY: 'x' }, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Refusing to seed demo data: database URL points at "db\.zrexqtzhdkkupyxmfqxd\.supabase\.co"/);
  const r2 = spawnSync(process.execPath, ['scripts/demo/seed-demo.mjs'], { env: { ...process.env, DEMO_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', DEMO_API_URL: 'https://zrexqtzhdkkupyxmfqxd.supabase.co', DEMO_SERVICE_KEY: 'x' }, encoding: 'utf8' });
  assert.match(r2.stderr, /API URL points at "zrexqtzhdkkupyxmfqxd\.supabase\.co"/);
});
