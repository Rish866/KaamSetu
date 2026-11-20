// Background workers against a REAL local Supabase stack (GoTrue, Storage, Postgres) with a REAL ClamAV (Docker image).
// Run by CI job e2e-local-stack. Never points at production.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { strToU8, zipSync } from 'fflate';
import pg from 'pg';

const URL_ = process.env.LIVE_SUPABASE_URL; const ANON = process.env.LIVE_SUPABASE_ANON_KEY; const SERVICE = process.env.SERVICE_ROLE_KEY; const DB = process.env.LIVE_DB_URL;
const skip = !(URL_ && ANON && SERVICE && DB && process.env.CLAMSCAN_CMD);
const db = skip ? null : new pg.Pool({ connectionString: DB, max: 2, allowExitOnIdle: true });
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const admin = skip ? null : createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const run = Date.now().toString(36);
const PW = `Wk-${run}-Strong9`;
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''); // built at runtime; standard harmless AV test string

function worker(taskName, extraEnv = {}) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/workers/run.mjs', '--task', taskName],
    { encoding: 'utf8', env: { ...process.env, SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: SERVICE, ...extraEnv } });
  const line = (r.stdout || '').trim().split('\n').at(-1);
  return { status: r.status, summary: JSON.parse(line || '{}').summary ?? {}, stderr: r.stderr };
}
async function user(tag) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const email = `wk+${run}-${tag}@example.com`;
  const { data, error } = await c.auth.signUp({ email, password: PW, options: { data: { display_name: `Worker ${tag}`, account_kind: 'candidate', accepted_notice_version: '2026-11-20' } } });
  if (error) throw error;
  return { c, id: data.user.id, email };
}
function pdf(text) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${44 + text.length} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
async function upload(u, name, mime, bytes) {
  const path = `${u.id}/${run}-${name}`;
  const up = await u.c.storage.from('resumes').upload(path, bytes, { contentType: mime }); if (up.error) throw up.error;
  const sha = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  const { data, error } = await u.c.rpc('register_resume', { p_path: path, p_name: name, p_mime: mime, p_size: bytes.length, p_sha256: sha }); if (error) throw error;
  return { id: data, path };
}

before(async () => { if (!skip) await q(`update private.settings set value = 'true'::jsonb where key = 'resume_uploads_enabled'`); });

test('real ClamAV detects the EICAR test file and passes a clean file (scanner command used by the worker)', { skip }, () => {
  const dir = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim();
  execFileSync('bash', ['-c', `printf '%s' '${EICAR.replace(/'/g, "'\\''")}' > ${dir}/11111111-1111-4111-8111-111111111111.bin && printf 'hello' > ${dir}/22222222-2222-4222-8222-222222222222.bin`]);
  const out = spawnSync('bash', ['-c', `${process.env.CLAMSCAN_CMD} "${dir}"`], { encoding: 'utf8' });
  assert.match(out.stdout, /11111111-1111-4111-8111-111111111111\.bin: .*FOUND/);
  assert.match(out.stdout, /22222222-2222-4222-8222-222222222222\.bin: OK/);
});

test('worker scans: clean PDF becomes downloadable; DOCX carrying EICAR is blocked; fake PDF rejected structurally; parsing needs consent', { skip }, async () => {
  const u = await user('scan');
  const clean = await upload(u, 'clean.pdf', 'application/pdf', pdf('Skills CRM and Customer support'));
  const r1 = worker('resumes'); assert.equal(r1.status, 0, r1.stderr);
  assert.equal((await q('select scan_status from public.resumes where id=$1', [clean.id]))[0].scan_status, 'clean');
  const signed = await u.c.storage.from('resumes').createSignedUrl(clean.path, 60); assert.ifError(signed.error);
  assert.equal((await fetch(signed.data.signedUrl)).status, 200);
  // Parsing: skipped without consent, done after consent, never applied without review.
  worker('resumes');
  assert.equal((await q('select parse_status from public.resumes where id=$1', [clean.id]))[0].parse_status, 'skipped');
  await u.c.rpc('set_consent', { p_purpose: 'resume_parsing', p_granted: true, p_notice_version: '2026-11-20' });
  worker('resumes');
  const ex = await q('select data from public.resume_extractions where resume_id=$1', [clean.id]);
  assert.deepEqual(ex[0].data.skills, ['CRM', 'Customer support']);
  assert.equal((await q('select count(*)::int n from public.candidate_skills where candidate_id=$1', [u.id]))[0].n, 0);
  // Infected archive: a structurally valid DOCX with the EICAR string inside.
  const docx = Buffer.from(zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<w:document/>'), 'word/media/note.txt': strToU8(EICAR) }));
  const bad = await upload(u, 'bad.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx);
  const fake = await upload(u, 'fake.pdf', 'application/pdf', Buffer.from('MZ this is not a pdf'));
  const r2 = worker('resumes'); assert.equal(r2.status, 0, r2.stderr);
  const rows = Object.fromEntries((await q('select id, scan_status, scan_detail from public.resumes where id = any($1)', [[bad.id, fake.id]])).map((r) => [r.id, r]));
  assert.equal(rows[bad.id].scan_status, 'infected', JSON.stringify(rows[bad.id]));
  assert.deepEqual([rows[fake.id].scan_status, rows[fake.id].scan_detail], ['failed', 'not_a_pdf']);
  assert.ok((await u.c.storage.from('resumes').createSignedUrl(bad.path, 60)).error, 'infected file cannot be signed');
});

test('worker fails stale scans instead of leaving them quarantined', { skip }, async () => {
  const u = await user('stale');
  const f = await upload(u, 'late.pdf', 'application/pdf', pdf('late file'));
  await q(`update public.resumes set created_at = now() - interval '25 hours' where id=$1`, [f.id]);
  const r = worker('resumes', { CLAMSCAN_CMD: '' });
  assert.equal(r.summary.scan_timeouts, 1);
  assert.deepEqual((await q('select scan_status, scan_detail from public.resumes where id=$1', [f.id]))[0], { scan_status: 'failed', scan_detail: 'scan_timeout' });
});

test('privacy worker soft-deletes the Auth user (sign-in blocked, email reusable) and purges stored files', { skip }, async () => {
  const u = await user('del');
  await upload(u, 'mine.pdf', 'application/pdf', pdf('to be deleted'));
  await u.c.rpc('request_account_deletion');
  const adminUser = await user('admin');
  await q(`insert into private.app_roles (user_id, role) values ($1, 'admin')`, [adminUser.id]);
  const [req] = await q(`select id from public.privacy_requests where user_id=$1 and kind='deletion'`, [u.id]);
  const done = await adminUser.c.rpc('admin_process_deletion', { p_request: req.id, p_reason: 'worker test clean-up' }); assert.ifError(done.error);
  const r = worker('privacy'); assert.equal(r.status, 0, r.stderr);
  assert.ok(r.summary.accounts_cleaned >= 1 && r.summary.files_purged >= 1, JSON.stringify(r.summary));
  const signIn = await createClient(URL_, ANON, { auth: { persistSession: false } }).auth.signInWithPassword({ email: u.email, password: PW });
  assert.ok(signIn.error, 'deleted account cannot sign in');
  const again = await createClient(URL_, ANON, { auth: { persistSession: false } }).auth.signUp({ email: u.email, password: PW });
  assert.ifError(again.error); assert.ok(again.data.user && again.data.user.id !== u.id, 'email can be registered again');
  const list = await admin.storage.from('resumes').list(u.id); assert.deepEqual(list.data, []);
  const [st] = await q(`select result->>'auth_scrub' a, result->>'storage_purge' s from public.privacy_requests where id=$1`, [req.id]);
  assert.deepEqual(st, { a: 'done', s: 'done' });
});

test('email worker: without a provider nothing is claimed; with a provider the message is delivered once and recorded', { skip }, async () => {
  const u = await user('mail');
  await admin.auth.admin.updateUserById(u.id, { password: `${PW}x` }); // queues the essential "password changed" email
  const before = await q(`select count(*)::int n from private.email_outbox where recipient_id=$1 and status='pending'`, [u.id]);
  assert.ok(before[0].n >= 1);
  const none = worker('email', { EMAIL_PROVIDER: '' });
  assert.equal(none.summary.email_provider_missing, 1);
  assert.equal((await q(`select count(*)::int n from private.email_outbox where recipient_id=$1 and status='pending'`, [u.id]))[0].n, before[0].n, 'still pending');
  const received = [];
  const srv = createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { received.push({ auth: req.headers.authorization, body: JSON.parse(b) }); res.end('{}'); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const { execFile } = await import('node:child_process');
    await new Promise((resolve) => execFile(process.execPath, ['--experimental-strip-types', 'scripts/workers/run.mjs', '--task', 'email'],
      { env: { ...process.env, SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: SERVICE, EMAIL_PROVIDER: 'webhook', EMAIL_API_KEY: 'test-key', EMAIL_FROM: 'KaamSetu <no-reply@example.com>', EMAIL_WEBHOOK_URL: `http://127.0.0.1:${srv.address().port}/send` } },
      () => resolve()));
  } finally { srv.close(); }
  const mine = received.filter((m) => m.body.to === u.email);
  assert.equal(mine.length, before[0].n);
  assert.equal(mine[0].auth, 'Bearer test-key');
  assert.equal(mine[0].body.subject, 'Your password was changed');
  assert.doesNotMatch(mine[0].body.subject, /@|Worker/);
  assert.equal((await q(`select count(*)::int n from private.email_outbox where recipient_id=$1 and status='sent'`, [u.id]))[0].n, before[0].n);
});

test('unsubscribe link: GET only shows a confirmation; POST switches optional emails off', { skip }, async () => {
  const u = await user('unsub');
  const [p] = await q('select unsubscribe_token t, email_updates e from public.notification_preferences where user_id=$1', [u.id]);
  assert.equal(p.e, true);
  const link = `${URL_}/functions/v1/unsubscribe?token=${p.t}`;
  const get = await fetch(link); assert.equal(get.status, 200); assert.match(await get.text(), /Stop optional KaamSetu emails\?/);
  assert.equal((await q('select email_updates e from public.notification_preferences where user_id=$1', [u.id]))[0].e, true, 'GET changes nothing');
  const post = await fetch(link, { method: 'POST' }); assert.equal(post.status, 200);
  assert.equal((await q('select email_updates e from public.notification_preferences where user_id=$1', [u.id]))[0].e, false);
  assert.equal((await fetch(`${URL_}/functions/v1/unsubscribe?token=not-a-token`)).status, 400);
});
