// Pan-India locations (migration 202611260001): catalogue, type-ahead search, India-wide job search filters,
// hierarchical location score and candidate discovery by place.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { failure } from './harness.mjs';
import { world, makeCompany, makeJob, makeCandidate, loc, pinLoc, stateLoc } from './fixtures.mjs';

let api, admin, co, jobs, cand;
const one = async (sql, p) => (await api.q(sql, p)).rows[0];
const search = (who, args) => api.as(who, async (s) => (await s(
  `select * from public.job_search(p_places => $1::uuid[], p_states => $2::text[], p_pin_prefix => $3, p_include_remote => $4)`,
  [args.places ?? null, args.states ?? null, args.pin ?? null, args.remote ?? true])).rows);
const ids = (rows) => new Set(rows.map((r) => r.job_id));

before(async () => {
  ({ api, admin } = await world());
  co = await makeCompany(api, admin, 'India Co');
  jobs = {
    powai: await makeJob(api, admin, co, { title: 'Powai role', work_mode: 'onsite', location_id: await pinLoc(api, '400076') }),
    pune: await makeJob(api, admin, co, { title: 'Pune role', work_mode: 'onsite', city: 'Pune' }),
    blr: await makeJob(api, admin, co, { title: 'Bengaluru role', work_mode: 'onsite', location_id: await pinLoc(api, '560001') }),
    delhi: await makeJob(api, admin, co, { title: 'Delhi role', work_mode: 'onsite', location_id: await pinLoc(api, '110001') }),
    thane: await makeJob(api, admin, co, { title: 'Thane role', work_mode: 'onsite', city: 'Thane' }),
    remote: await makeJob(api, admin, co, { title: 'Remote role', work_mode: 'remote', city: null }),
  };
  cand = await makeCandidate(api, 'Navi Mumbai Nisha', { city: 'Navi Mumbai' });
  await api.as(cand, (s) => s(`update public.candidate_profiles set work_modes='{onsite,hybrid,remote}' where user_id=$1`, [cand.id]));
});

test('catalogue covers every state/UT, district and PIN code, and keeps the original places', async () => {
  const c = await one(`select (select count(*) from public.states)::int states, (select count(*) from public.districts)::int districts,
    (select count(*) from public.locations where kind = 'pin')::int pins,
    (select count(*) from public.locations where kind = 'state')::int state_places,
    (select count(*) from public.locations where state_code is null)::int no_state,
    (select count(*) from public.locations where kind not in ('state') and district_id is null and city <> 'Delhi')::int no_district`);
  assert.deepEqual(c, { states: 36, districts: 737, pins: 19300, state_places: 36, no_state: 0, no_district: 0 });
  const vashi = await one(`select kind, state_code, district, pincode from public.locations where city = 'Navi Mumbai' and locality = 'Vashi'`);
  assert.deepEqual(vashi, { kind: 'locality', state_code: 'MH', district: 'Thane', pincode: '400703' });
  assert.equal((await one(`select count(*)::int n from public.states where kind = 'union_territory'`)).n, 8);
  assert.match(await failure(api.as(null, (s) => s(`select * from public.search_locations('pune')`))) ?? '', /permission denied/, 'anonymous visitors cannot call it');
});

test('type-ahead finds cities, areas, states and PIN prefixes, safely', async () => {
  const q = (text, kinds = null) => api.as(cand, async (s) => (await s('select * from public.search_locations($1, $2::text[])', [text, kinds])).rows);
  assert.equal((await q('Bengaluru'))[0].label, 'Bengaluru (Bengaluru Urban), Karnataka');
  assert.equal((await q('powai'))[0].locality, 'Powai');
  assert.ok((await q('4110')).every((r) => r.pincode.startsWith('4110')) && (await q('4110')).length > 0);
  assert.ok((await q('wakad')).some((r) => r.pincode === '411057'), 'other post-office names are searchable');
  assert.ok((await q('maharashtra', ['state'])).some((r) => r.label === 'Maharashtra (entire state)'));
  assert.ok((await q('maharashtra', ['district', 'city', 'locality', 'pin'])).every((r) => r.kind !== 'state'));
  assert.equal((await q('%a')).length, 0, 'LIKE wildcards are escaped');
  assert.equal((await q('4')).length, 0, 'PIN search needs 3 digits');
  assert.ok((await q('zz')).length <= 20);
});

test('job search: anywhere, by city, district, state, PIN prefix, with or without remote', async () => {
  const all = ids(await search(cand, {}));
  for (const j of Object.values(jobs)) assert.ok(all.has(j), 'anywhere in India shows every job');
  assert.deepEqual(ids(await search(cand, { places: [await loc(api, 'Mumbai')] })), new Set([jobs.powai, jobs.remote]), 'Mumbai includes Powai (Mumbai Suburban)');
  assert.deepEqual(ids(await search(cand, { places: [await stateLoc(api, 'MH')], remote: false })), new Set([jobs.powai, jobs.pune, jobs.thane]));
  assert.deepEqual(ids(await search(cand, { states: ['KA'], remote: false })), new Set([jobs.blr]));
  assert.deepEqual(ids(await search(cand, { pin: '110' })), new Set([jobs.delhi, jobs.remote]));
  assert.deepEqual(ids(await search(cand, { places: [await loc(api, 'Delhi')], remote: false })), new Set([jobs.delhi]), 'Delhi city covers its districts');
  assert.deepEqual(ids(await search(cand, { places: [await loc(api, 'Bengaluru'), await loc(api, 'Pune')], remote: false })), new Set([jobs.blr, jobs.pune]));
  const row = (await search(cand, { pin: '400076' })).find((r) => r.job_id === jobs.powai);
  assert.equal(row.location_label, '400076 · Powai Iit, Mumbai, Maharashtra');
  assert.equal(row.state_name, 'Maharashtra');
  assert.equal((await search(cand, {})).find((r) => r.job_id === jobs.remote).location_label, 'Remote (anywhere in India)');
  assert.match(await failure(search(cand, { pin: '0400' })) ?? '', /PIN code/);
  assert.match(await failure(search(cand, { states: ['XX'] })) ?? '', /Unknown state/);
  const many = (await api.q(`select array_agg(id) a from (select id from public.locations where kind = 'district' limit 21) x`)).rows[0].a;
  assert.match(await failure(search(cand, { places: many })) ?? '', /at most 20/);
  // The previous website's feed keeps working until it is redeployed.
  const old = await api.as(cand, async (s) => (await s(`select job_id from public.job_feed(p_city => 'Pune')`)).rows);
  assert.ok(ids(old).has(jobs.pune));
});

test('location score follows the place hierarchy and explains itself', async () => {
  const fit = async (c, j) => (await api.q('select private.match_score($1,$2) v', [c.id, j])).rows[0].v.components.location;
  assert.deepEqual([(await fit(cand, jobs.thane)).score, (await fit(cand, jobs.thane)).tier], [75, 'district'], 'Navi Mumbai and Thane share a district');
  assert.match((await fit(cand, jobs.thane)).explanation, /district you prefer/);
  assert.equal((await fit(cand, jobs.pune)).score, 0);
  const m = (await api.q('select private.match_score($1,$2) v', [cand.id, jobs.pune])).rows[0].v;
  assert.ok(m.ineligible_reasons.includes('location_mismatch'), 'a different city in the same state is not a match by itself');
  await api.q(`insert into public.candidate_locations (candidate_id, location_id, preference_rank) values ($1, $2, 2)`, [cand.id, await stateLoc(api, 'KA')]);
  const k = await fit(cand, jobs.blr);
  assert.deepEqual([k.score, k.tier], [67.9, 'state'], 'entire-state preference: 70 x 0.97');
  assert.match(k.explanation, /state you are open to\. It matches a lower-ranked preference\./);
  assert.equal((await fit(cand, jobs.remote)).score, 100);
  const st = await stateLoc(api, 'MH');
  assert.match(await failure(api.as(cand, (s) => s('update public.candidate_profiles set current_location_id=$2 where user_id=$1', [cand.id, st]))) ?? '', /not a whole state/);
  assert.match(await failure(makeJob(api, admin, co, { location_id: st, publish: false })) ?? '', /not a whole state/);
  await api.q('delete from public.candidate_locations where candidate_id = $1', [cand.id]);
});

test('employers discover opted-in candidates by place, including candidates open to a whole state', async () => {
  const talent = await makeCandidate(api, 'Open Karnataka', { city: 'Navi Mumbai', discovery: true });
  await api.q(`insert into public.candidate_locations (candidate_id, location_id, preference_rank) values ($1, $2, 1)`, [talent.id, await stateLoc(api, 'KA')]);
  const nm = await makeJob(api, admin, co, { title: 'Navi Mumbai role', city: 'Navi Mumbai' });
  const find = (places, states = null) => api.as(co.owner, async (s) => (await s(
    'select candidate_id, location_label from public.discover_candidates($1, p_places => $2::uuid[], p_states => $3::text[])', [nm, places, states])).rows);
  assert.ok((await find([await loc(api, 'Bengaluru')])).some((r) => r.candidate_id === talent.id), 'state preference covers Bengaluru');
  assert.ok((await find(null, ['KA'])).some((r) => r.candidate_id === talent.id));
  assert.ok(!(await find([await loc(api, 'Pune')])).some((r) => r.candidate_id === talent.id));
  const hit = (await find([await loc(api, 'Navi Mumbai')])).find((r) => r.candidate_id === talent.id);
  assert.equal(hit.location_label, 'Navi Mumbai (Thane), Maharashtra');
  const audit = await one(`select metadata from private.audit_events where action = 'candidate.search' order by created_at desc limit 1`);
  assert.equal(audit.metadata.places, 1);
});
