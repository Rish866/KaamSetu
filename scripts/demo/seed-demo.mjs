#!/usr/bin/env node
// Seeds a complete, explainable demo story into a LOCAL Supabase stack (never production):
//   a GSTIN-verified "Demo Logistics" company with a review commitment, a hybrid job with readiness questions,
//   one candidate taken from application to "still working at day 30", one rejected and one withdrawn application
//   with neutral reason tags, a relocating candidate found in discovery and invited, opt-in job alerts,
//   and the hiring-fee ledger switched on (local only) so the ledger has an entry.
//
// Usage (after `supabase start`):  node scripts/demo/seed-demo.mjs
// Reads DEMO_DB_URL | LIVE_DB_URL | DB_URL, DEMO_API_URL | API_URL and DEMO_SERVICE_KEY | SECRET_KEY | SERVICE_ROLE_KEY.
// Refuses to run unless both the database and the API point at localhost. Demo accounts use DEMO_PASSWORD.
import pg from 'pg';
import { seedDemo } from './demo-story.mjs';

const dbUrl = process.env.DEMO_DB_URL ?? process.env.LIVE_DB_URL ?? process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const apiUrl = process.env.DEMO_API_URL ?? process.env.API_URL ?? 'http://127.0.0.1:54321';
const serviceKey = process.env.DEMO_SERVICE_KEY ?? process.env.SECRET_KEY ?? process.env.SERVICE_ROLE_KEY ?? '';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-KaamSetu-2026';
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function assertLocal(label, value) {
  let host;
  try { host = new URL(value).hostname; } catch { throw new Error(`${label} is not a valid URL`); }
  if (!LOCAL.has(host)) throw new Error(`Refusing to seed demo data: ${label} points at "${host}", not localhost. Demo data must never reach production.`);
}
assertLocal('database URL', dbUrl);
assertLocal('API URL', apiUrl);
if (!serviceKey) throw new Error('Set DEMO_SERVICE_KEY (the local stack service-role or secret key).');

const pool = new pg.Pool({ connectionString: dbUrl, max: 4 });
const q = async (sql, params) => (await pool.query(sql, params)).rows;

/** Runs one statement as a signed-in user (RLS and SECURITY DEFINER checks apply exactly as in the app). */
async function as(uid, sql, params) {
  const c = await pool.connect();
  try {
    await c.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`,
      [uid ?? '', JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'service_role' })]);
    await c.query(uid ? 'set role authenticated' : 'set role service_role');
    return (await c.query(sql, params)).rows;
  } finally {
    await c.query(`reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`).catch(() => undefined);
    c.release();
  }
}

async function createUser(email, name, kind) {
  const r = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: DEMO_PASSWORD, email_confirm: true, user_metadata: { display_name: name, account_kind: kind, accepted_notice_version: '2026-11-26.2' } }) });
  const body = await r.json();
  if (!r.ok || !body.id) throw new Error(`Could not create ${email}: ${body.msg ?? body.message ?? r.status}`);
  return body.id;
}

seedDemo({ q, as, createUser })
  .catch((e) => { console.error(JSON.stringify({ demo: 'failed', error: String(e.message ?? e).slice(0, 300) })); process.exitCode = 1; })
  .finally(() => pool.end());
