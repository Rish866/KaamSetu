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
  const db = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } }); await db.connect();
  report.cleanup = [];
  for (const id of [...new Set(created)]) {
    const del = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: anon, Authorization: `Bearer ${service}` } });
    const gone = await fetch(`${url}/auth/v1/admin/users/${id}`, { headers: { apikey: anon, Authorization: `Bearer ${service}` } });
    const rows = (await db.query('select (select count(*) from auth.users where id=$1)::int u, (select count(*) from public.profiles where id=$1)::int p', [id])).rows[0];
    report.cleanup.push({ delete_status: del.status, lookup_after: gone.status, auth_rows: rows.u, profile_rows: rows.p });
  }
  await db.end();
}
const c = report.checks;
report.result = {
  email_signup_works: c.email_signup?.status === 200 && c.email_signup.session && c.email_signin?.session,
  phone_signup_works: c.phone_signup?.status === 200 && c.phone_signup.session && c.phone_signin?.session,
  duplicates_refused: c.duplicate_email?.status >= 400 && c.duplicate_phone?.status >= 400 && !c.duplicate_email.session && !c.duplicate_phone.session,
  wrong_password_refused: c.wrong_password?.status === 400,
  cleaned_up: report.cleanup.length === created.length && report.cleanup.every((x) => x.auth_rows === 0 && x.profile_rows === 0),
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.result.cleaned_up ? 0 : 1);
