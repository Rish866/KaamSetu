#!/usr/bin/env node
// Production sign-up probe (run by the "Production database" workflow, action auth-probe). Creates two clearly
// marked QA accounts through the public Auth API exactly like the website does, checks sign-in, duplicate refusal and
// wrong-password handling, then deletes both accounts with the Admin API and verifies they are gone.
// Phone numbers use the +91 10xx range, which is not allocated to Indian mobiles, and phone auto-confirm is on in
// production, so no SMS is sent to anyone. Prints only booleans, status codes and error codes.
import pg from 'pg';
const url = process.env.SUPABASE_URL;
const anon = process.env.ANON_KEY;
const service = process.env.SERVICE_KEY;
const dbUrl = process.env.DB_URL;
if (!url || !anon || !service || !dbUrl) { console.error('SUPABASE_URL, ANON_KEY, SERVICE_KEY and DB_URL are required'); process.exit(2); }
{
  // After the v1.4.0 migrations, consent and audit history is immutable and hard deletes are refused by design, so the
  // probe's QA accounts could not be removed. It is a pre-migration check only; afterwards use the live journey spec.
  const guard = new pg.Client({ connectionString: dbUrl.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, ''), ssl: { rejectUnauthorized: false } });
  await guard.connect();
  const { rows } = await guard.query("select to_regprocedure('public.schema_version()') is not null as migrated");
  await guard.end();
  if (rows[0].migrated) { console.error('Database already has the v1.4.0 schema: auth-probe would create undeletable accounts. Refusing.'); process.exit(2); }
}
const run = Date.now().toString(36);
const pw = `Probe-${run}-${Math.random().toString(36).slice(2, 10)}A9`;
const email = `qa+probe-${run}@getkaamsetu.in`;
const phone = `+911000${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
const meta = { display_name: `QA probe ${run}`, account_kind: 'candidate', accepted_notice_version: '2026-11-19' };
const auth = async (path, body, key = anon) => {
  const r = await fetch(`${url}/auth/v1/${path}`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, code: j.error_code ?? j.code ?? null, session: Boolean(j.access_token ?? j.session?.access_token), userId: j.user?.id ?? j.id ?? null };
};
const report = { started_at: new Date().toISOString(), checks: {} };
const created = [];
try {
  const e1 = await auth('signup', { email, password: pw, data: meta }); if (e1.userId) created.push(e1.userId);
  report.checks.email_signup = { status: e1.status, session: e1.session };
  const p1 = await auth('signup', { phone, password: pw, data: meta }); if (p1.userId) created.push(p1.userId);
  report.checks.phone_signup = { status: p1.status, session: p1.session, code: p1.code };
  report.checks.phone_signin = await auth('token?grant_type=password', { phone, password: pw }).then((r) => ({ status: r.status, session: r.session }));
  report.checks.email_signin = await auth('token?grant_type=password', { email, password: pw }).then((r) => ({ status: r.status, session: r.session }));
  report.checks.duplicate_email = await auth('signup', { email, password: pw, data: meta }).then((r) => ({ status: r.status, code: r.code, session: r.session }));
  report.checks.duplicate_phone = await auth('signup', { phone, password: pw, data: meta }).then((r) => ({ status: r.status, code: r.code, session: r.session }));
  report.checks.wrong_password = await auth('token?grant_type=password', { email, password: `${pw}x` }).then((r) => ({ status: r.status, code: r.code }));
} finally {
  // Delete through the Admin API first so a database connection problem can never leave QA accounts behind.
  // Also sweeps accounts left by earlier probe runs: only the probe's own address and number patterns match.
  const admin = { apikey: service, Authorization: `Bearer ${service}` };
  const cs = dbUrl.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '');
  const db = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
  let leftovers = [];
  try {
    await db.connect();
    leftovers = (await db.query("select id::text from auth.users where email like 'qa+probe-%@getkaamsetu.in' or phone like '911000%'")).rows.map((r) => r.id);
  } catch (e) { report.db_error = e.code ?? e.message; }
  report.cleanup = [];
  for (const id of [...new Set([...created, ...leftovers])]) {
    const del = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: admin });
    const gone = await fetch(`${url}/auth/v1/admin/users/${id}`, { headers: admin });
    report.cleanup.push({ from_this_run: created.includes(id), delete_status: del.status, lookup_after: gone.status });
  }
  try {
    const ids = report.cleanup.length ? [...new Set([...created, ...leftovers])] : [];
    const rows = (await db.query('select (select count(*) from auth.users where id = any($1::uuid[]))::int u, (select count(*) from public.profiles where id = any($1::uuid[]))::int p, (select count(*) from auth.users where email like \'qa+probe-%@getkaamsetu.in\' or phone like \'911000%\')::int remaining', [ids])).rows[0];
    report.rows_after = rows;
  } catch (e) { report.db_error = report.db_error ?? (e.code ?? e.message); }
  await db.end().catch(() => {});
}
const c = report.checks;
report.result = {
  email_signup_works: c.email_signup?.status === 200 && c.email_signup.session && c.email_signin?.session,
  phone_signup_works: c.phone_signup?.status === 200 && c.phone_signup.session && c.phone_signin?.session,
  duplicates_refused: c.duplicate_email?.status >= 400 && c.duplicate_phone?.status >= 400 && !c.duplicate_email.session && !c.duplicate_phone.session,
  wrong_password_refused: c.wrong_password?.status === 400,
  cleaned_up: report.cleanup.every((x) => x.lookup_after === 404) && report.rows_after?.u === 0 && report.rows_after?.p === 0 && report.rows_after?.remaining === 0,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.result.cleaned_up ? 0 : 1);
