import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { failure } from './harness.mjs';
import { world, makeCompany, makeJob, makeCandidate, loc, skill } from './fixtures.mjs';

let api, admin, co;
const num = async (sql, p) => { const v = Object.values((await api.q(sql, p)).rows[0])[0]; return v === null ? null : Number(v); };
before(async () => { ({ api, admin } = await world()); co = await makeCompany(api, admin, 'Match Co'); });

test('salary component', async () => {
  const f = (cm, cp, jn, jx, jp = 'annual') => num('select private.score_salary($1,$2,$3,$4,$5)', [cm, cp, jn, jx, jp]);
  assert.equal(await f(500000, 'annual', 600000, 800000), 100, 'range fully above expectation');
  assert.equal(await f(500000, 'annual', 400000, 600000), 85, 'overlap: 70 + 30*(100k/200k)');
  assert.equal(await f(500000, 'annual', 300000, 500000), 70, 'max equals expectation');
  assert.equal(await f(500000, 'annual', 300000, 450000), 30, '10% below expectation');
  assert.equal(await f(500000, 'annual', 100000, 200000), 0, 'far below expectation');
  assert.equal(await f(40000, 'monthly', 500000, 700000), 100, 'monthly 4.8L vs annual 5-7L');
  assert.equal(await f(50000, 'monthly', 40000, 45000, 'monthly'), 30, 'same-period comparison, 10% under');
  assert.equal(await f(null, 'annual', 1, 2), null, 'missing expectation is explicit');
});

test('experience component: under-experience penalised, over-experience barely', async () => {
  const f = (c, mn, mx) => num('select private.score_experience($1,$2,$3)', [c, mn, mx]);
  assert.equal(await f(36, 24, 48), 100);
  assert.equal(await f(24, 36, 60), 66.7);
  assert.equal(await f(0, 36, null), 0);
  assert.equal(await f(6, 12, null), 50);
  assert.equal(await f(60, 12, 36), 90, '24 months over max loses 10 points');
  assert.ok(await f(600, 12, 36) >= 80, 'overqualification never drops below 80');
  assert.equal(await f(200, 12, null), 100, 'no upper bound means no penalty');
  assert.equal(await f(null, 12, 36), null);
});

test('freshness component', async () => {
  const at = new Date('2026-11-19T00:00:00Z');
  const f = (daysAgo) => num('select private.score_freshness($1::timestamptz,$2::timestamptz)', [new Date(at - daysAgo * 86400e3).toISOString(), at.toISOString()]);
  assert.equal(await f(0), 100); assert.equal(await f(3), 100); assert.equal(await f(60), 0); assert.equal(await f(90), 0);
  assert.equal(await f(31.5), 50);
  assert.equal(await num('select private.score_freshness(null)'), null);
});

test('skills component: required skills weigh fully, optional half; only confirmed skills count', async () => {
  const j = await makeJob(api, admin, co, { skills: ['CRM', 'SQL'] });
  await api.q(`update public.job_skills set required=false where job_id=$1 and skill_id=$2`, [j, await skill(api, 'SQL')]);
  const sc = async (c) => (await api.q('select private.score_skills($1,$2) v', [c.id, j])).rows[0].v;
  const crm = await makeCandidate(api, 'Has CRM', { skills: ['CRM'] });
  assert.equal((await sc(crm)).score, 66.7);          // 1 / (1 + 0.5)
  const sql = await makeCandidate(api, 'Has SQL', { skills: ['SQL'] });
  assert.equal((await sc(sql)).score, 33.3);          // 0.5 / 1.5
  const both = await makeCandidate(api, 'Has both', { skills: ['CRM', 'SQL'] });
  assert.deepEqual(await sc(both), { score: 100, matched: ['CRM', 'SQL'], missing: [] });
  const none = await makeCandidate(api, 'No skills', { skills: [] });
  assert.equal((await sc(none)).score, null, 'no candidate skills is reported as missing, not zero');
  await api.q(`update public.candidate_skills set confirmed=false where candidate_id=$1`, [both.id]);
  assert.equal((await sc(both)).score, null, 'unconfirmed (e.g. parsed but unreviewed) skills are ignored');
});

test('location component', async () => {
  const mk = (c, o) => makeCandidate(api, c, o);
  const local = await makeJob(api, admin, co, { city: 'Navi Mumbai', locality: 'Vashi', work_mode: 'onsite' });
  const city = await makeJob(api, admin, co, { city: 'Navi Mumbai', work_mode: 'onsite' });
  const pune = await makeJob(api, admin, co, { city: 'Pune', work_mode: 'onsite' });
  const remote = await makeJob(api, admin, co, { city: null, work_mode: 'remote' });
  const same = await mk('Vashi Vera', { city: 'Navi Mumbai', locality: 'Vashi' });
  const s = (c, j) => num('select private.score_location($1,$2)', [c.id, j]);
  assert.equal(await s(same, local), 100, 'same locality');
  assert.equal(await s(same, city), 85, 'same city, job has no locality -> city match');
  assert.equal(await s(same, pune), 0, 'different city');
  assert.equal(await s(same, remote), 100, 'remote');
  const airoli = await mk('Airoli Ali', { city: 'Navi Mumbai', locality: 'Airoli' });
  assert.equal(await s(airoli, local), 85, 'same city, different locality');
  // preferred locations are ranked: rank 2 loses 3%
  await api.q(`insert into public.candidate_locations (candidate_id, location_id, preference_rank) values ($1,$2,2)`, [airoli.id, await loc(api, 'Pune')]);
  assert.equal(await s(airoli, pune), 82.5, 'rank-2 preference: 85 x 0.97, rounded');
  const nowhere = await makeCandidate(api, 'No Location'); await api.q('update public.candidate_profiles set current_location_id=null where user_id=$1', [nowhere.id]);
  assert.equal(await s(nowhere, local), null, 'missing location data is explicit');
});

test('overall score: bounds, weights, explanations, version, missing data neutral', async () => {
  const j = await makeJob(api, admin, co, { title: 'Full match', city: 'Navi Mumbai', salary_min: 600000, salary_max: 800000, exp_min: 12, exp_max: 48 });
  const strong = await makeCandidate(api, 'Strong', { salary: 500000, months: 30 });
  const m = (await api.q('select private.match_score($1,$2) v', [strong.id, j])).rows[0].v;
  assert.equal(m.version, 1);
  assert.ok(m.score >= 95 && m.score <= 100, `strong match scored ${m.score}`);
  assert.equal(m.eligible, true);
  const total = Object.values(m.components).reduce((a, c) => a + c.weight, 0);
  assert.equal(total, 100);
  for (const [k, c] of Object.entries(m.components)) assert.ok(typeof c.explanation === 'string' && c.explanation.length > 10, `${k} lacks explanation`);
  const rebuilt = Math.round(Object.values(m.components).reduce((a, c) => a + (c.score ?? 50) * c.weight, 0) / 100);
  assert.equal(rebuilt, m.score, 'score is reproducible from components and weights');
  const blank = await makeCandidate(api, 'Blank', { skills: [], salary: null, months: 0 });
  await api.q('update public.candidate_profiles set current_location_id=null where user_id=$1', [blank.id]);
  const mb = (await api.q('select private.match_score($1,$2) v', [blank.id, j])).rows[0].v;
  assert.ok(mb.components.skills.missing && mb.components.location.missing && mb.components.salary.missing);
  assert.ok(mb.confidence < 100 && mb.score < m.score);
  assert.equal(mb.components.skills.explanation, 'Add confirmed skills to your profile to improve this score.');
});

test('hard filters apply before ranking', async () => {
  const onsitePune = await makeJob(api, admin, co, { city: 'Pune', work_mode: 'onsite' });
  const parttime = await makeJob(api, admin, co, { employment_type: 'part_time' });
  const c = await makeCandidate(api, 'Filtered', {});
  await api.as(c, (s) => s(`update public.candidate_profiles set employment_types='{full_time}', work_modes='{hybrid,remote}' where user_id=$1`, [c.id]));
  const rows = await api.as(c, async (s) => (await s('select * from public.my_job_matches()')).rows);
  const by = Object.fromEntries(rows.map((r) => [r.job_id, r]));
  assert.equal(by[onsitePune].eligible, false); assert.deepEqual(by[onsitePune].match.ineligible_reasons.sort(), ['location_mismatch', 'work_mode_not_preferred']);
  assert.deepEqual(by[parttime].match.ineligible_reasons, ['employment_type_not_preferred']);
  const firstIneligible = rows.findIndex((r) => !r.eligible);
  assert.ok(rows.slice(firstIneligible).every((r) => !r.eligible), 'eligible jobs always rank before ineligible ones');
  const closed = await makeJob(api, admin, co, { title: 'Closed job' });
  await api.as(co.owner, (s) => s(`select public.set_job_status($1,'closed')`, [closed]));
  const after = await api.as(c, async (s) => (await s('select job_id from public.my_job_matches()')).rows.map((r) => r.job_id));
  assert.ok(!after.includes(closed), 'closed jobs are excluded');
  const expired = await makeJob(api, admin, co, { title: 'Expired' });
  await api.q(`update public.jobs set closes_at = now() - interval '1 day' where id=$1`, [expired]);
  assert.ok(!(await api.as(c, async (s) => (await s('select job_id from public.my_job_matches()')).rows.map((r) => r.job_id))).includes(expired), 'expired jobs are excluded');
  assert.equal(await api.as(c, async (s) => (await s('select public.my_job_match($1) v', [closed])).rows[0].v), null);
});

test('integration: ranking orders candidates by fit and respects discovery consent', async () => {
  const j = await makeJob(api, admin, co, { title: 'Ranking job', city: 'Thane', skills: ['CRM', 'Customer support', 'English'], salary_min: 600000, salary_max: 800000, exp_min: 24, exp_max: 60 });
  const best = await makeCandidate(api, 'Best', { city: 'Thane', skills: ['CRM', 'Customer support', 'English'], salary: 550000, months: 36, discovery: true });
  const mid = await makeCandidate(api, 'Middle', { city: 'Thane', skills: ['CRM'], salary: 750000, months: 18, discovery: true });
  const low = await makeCandidate(api, 'Lower', { city: 'Thane', skills: ['SQL'], salary: 1500000, months: 2, discovery: true });
  const off = await makeCandidate(api, 'Off', { city: 'Thane', skills: ['CRM', 'Customer support', 'English'], discovery: false });
  const res = await api.as(co.owner, async (s) => (await s('select * from public.search_candidates($1)', [j])).rows);
  const order = res.map((r) => r.candidate_id).filter((id) => [best.id, mid.id, low.id].includes(id));
  assert.deepEqual(order, [best.id, mid.id, low.id]);
  assert.ok(!res.some((r) => r.candidate_id === off.id));
  assert.ok(res.every((r) => r.match.components && Number(r.score) === r.match.score));
  const filtered = await api.as(co.owner, async (s) => (await s('select * from public.search_candidates($1,$2,$3,$4)', [j, 'SQL', null, null])).rows);
  assert.deepEqual(filtered.map((r) => r.candidate_id), [low.id]);
});

test('fairness: identity attributes cannot influence scores', async () => {
  const j = await makeJob(api, admin, co, { title: 'Fairness job' });
  const mk = async (name, extra) => { const c = await makeCandidate(api, name, {}); await api.q(`update auth.users set raw_user_meta_data = raw_user_meta_data || $2::jsonb where id=$1`, [c.id, JSON.stringify(extra)]); return c; };
  const a = await mk('Priya Sharma', { gender: 'female', religion: 'hindu', caste: 'x', age: 24, marital_status: 'single', disability: 'none' });
  const b = await mk('Mohammed Siddiqui', { gender: 'male', religion: 'muslim', caste: 'y', age: 52, marital_status: 'married', disability: 'visual' });
  await api.q(`update public.profiles set display_name='Zzz Unusual Name' where id=$1`, [b.id]);
  const sa = (await api.q('select private.match_score($1,$2) v', [a.id, j])).rows[0].v;
  const sb = (await api.q('select private.match_score($1,$2) v', [b.id, j])).rows[0].v;
  assert.deepEqual(sa, sb, 'identical qualifications must give identical results');
  // structural guarantee: the engine's source never references identity columns
  const src = (await api.q(`select string_agg(pg_get_functiondef(p.oid), ' ') s from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and (p.proname like 'score\\_%' or p.proname = 'match_score' or p.proname='annual_salary')`)).rows[0].s;
  for (const banned of ['display_name', 'email', 'phone', 'gender', 'religion', 'caste', 'marital', 'disability', 'birth', 'age', 'photo', 'raw_user_meta_data', 'account_kind'])
    assert.ok(!new RegExp(`\\b${banned}\\b`, 'i').test(src), `matching engine must not reference "${banned}"`);
});

test('matching weights: admin-only, validated, versioned, audited and effective', async () => {
  const j = await makeJob(api, admin, co, { title: 'Weights job', salary_min: 100000, salary_max: 200000 });
  const c = await makeCandidate(api, 'Weight Wendy', { salary: 900000 });
  const before = (await api.q('select private.match_score($1,$2) v', [c.id, j])).rows[0].v;
  assert.match(await failure(api.as(co.owner, (s) => s(`select public.admin_set_matching_weights('{"skills":20,"location":20,"salary":20,"experience":20,"freshness":20}','sneaky change')`))) ?? '', /Not authorised/);
  assert.match(await failure(api.as(admin, (s) => s(`select public.admin_set_matching_weights('{"skills":50,"location":25,"salary":20,"experience":15,"freshness":5}','sums to 115')`))) ?? '', /matching_weights_shape/);
  assert.match(await failure(api.as(admin, (s) => s(`select public.admin_set_matching_weights('{"skills":35}','incomplete')`))) ?? '', /matching_weights_shape/);
  assert.match(await failure(api.as(admin, (s) => s(`select public.admin_set_matching_weights('{"skills":10,"location":10,"salary":60,"experience":15,"freshness":5}','short')`))) ?? '', /reason/);
  const v = await api.as(admin, async (s) => (await s(`select public.admin_set_matching_weights('{"skills":10,"location":10,"salary":60,"experience":15,"freshness":5}','Pilot feedback: salary mismatch drives rejections') v`)).rows[0].v);
  assert.equal(v, 2);
  const after = (await api.q('select private.match_score($1,$2) v', [c.id, j])).rows[0].v;
  assert.equal(after.version, 2); assert.ok(after.score < before.score, 'salary weight increased, salary is poor, so score drops');
  assert.equal((await api.q('select count(*)::int n from public.matching_versions where active')).rows[0].n, 1);
  assert.equal((await api.q(`select count(*)::int n from private.audit_events where action='matching.weights_changed'`)).rows[0].n, 1);
  assert.ok(await failure(api.as(admin, (s) => s('update public.matching_versions set active=false'))));
});
