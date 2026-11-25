#!/usr/bin/env node
// Production resume-upload go-live test (workflow "Production database", action resume-go-live).
// 1. A temporary QA administrator (audited) switches resume uploads ON with a written reason.
// 2. A QA candidate uploads, through the same Storage + register_resume path as the website:
//    a clean PDF, a DOCX containing the harmless EICAR antivirus test string, and an .exe disguised as .pdf.
// 3. The real worker (ClamAV in Docker) scans them.
// 4. Pass = clean -> 'clean' and downloadable by its owner only; EICAR -> 'infected' and never downloadable;
//    fake PDF -> 'failed'/'not_a_pdf'. On pass uploads stay ON; on any failure they are switched OFF again.
// 5. Always: QA accounts deleted through product functions, admin role revoked, files purged.
// Prints statuses, counts and ids only. Env: SUPABASE_URL, ANON_KEY, SERVICE_KEY, DB_URL, CLAMSCAN_CMD.
import { createClient } from '@supabase/supabase-js';
import { zipSync, strToU8 } from 'fflate';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { Buffer } from 'node:buffer';

const url = process.env.SUPABASE_URL, anon = process.env.ANON_KEY, service = process.env.SERVICE_KEY;
const dbUrl = (process.env.DB_URL ?? '').replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '');
if (!url || !anon || !service || !dbUrl) { console.error('SUPABASE_URL, ANON_KEY, SERVICE_KEY, DB_URL required'); process.exit(2); }
const run = process.env.GITHUB_RUN_ID ?? Date.now().toString(36);
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, service, opts);
const db = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } }); await db.connect();
const q = async (sql, p) => (await db.query(sql, p)).rows;
const report = { run, checks: {} };
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('');
const PDF = 'application/pdf', DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function pdf(text) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${44 + text.length} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function account(kind) {
  const email = `qa+${kind}-${run}@getkaamsetu.in`, password = `Qa-${randomBytes(12).toString('hex')}-A9`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { display_name: `QA ${kind} ${run}`, account_kind: 'candidate', accepted_notice_version: '2026-11-19' } });
  if (error) throw error;
  const c = createClient(url, anon, opts);
  const s = await c.auth.signInWithPassword({ email, password }); if (s.error) throw s.error;
  return { id: data.user.id, c };
}
async function upload(u, name, mime, bytes) {
  const path = `${u.id}/${crypto.randomUUID()}.${name.split('.').pop()}`;
  const up = await u.c.storage.from('resumes').upload(path, bytes, { contentType: mime, upsert: false }); if (up.error) throw up.error;
  const reg = await u.c.rpc('register_resume', { p_path: path, p_name: name, p_mime: mime, p_size: bytes.length, p_sha256: createHash('sha256').update(bytes).digest('hex') });
  if (reg.error) throw reg.error;
  return { id: reg.data, path };
}
function worker() {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/workers/run.mjs', '--task', 'resumes'],
    { encoding: 'utf8', env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: service } });
  return { status: r.status, out: (r.stdout || '').trim().split('\n').at(-1), err: (r.stderr || '').slice(0, 400) };
}

let adm, cand, pass = false;
try {
  adm = await account('admin');
  await q(`insert into private.app_roles (user_id, role) values ($1, 'admin') on conflict do nothing`, [adm.id]);
  await q(`select private.audit('admin.role_granted', 'user', $1, null, jsonb_build_object('role', 'admin', 'reason', $2::text))`, [adm.id, `Temporary QA administrator for resume go-live test run ${run}`]);
  const on = await adm.c.rpc('admin_set_resume_uploads', { p_enabled: true, p_reason: `Resume go-live test run ${run}: enabling uploads to verify the production ClamAV scan` });
  if (on.error) throw on.error;
  cand = await account('resume');
  report.checks.flag_visible_to_candidate = (await cand.c.rpc('platform_flags')).data?.resume_uploads_enabled === true;

  const clean = await upload(cand, 'qa-clean.pdf', PDF, pdf('QA resume CRM Customer support'));
  const bad = await upload(cand, 'qa-eicar.docx', DOCX, Buffer.from(zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<w:document/>'), 'word/media/note.txt': strToU8(EICAR) })));
  const fake = await upload(cand, 'qa-fake.pdf', PDF, Buffer.from('MZ this is an executable pretending to be a pdf'));
  report.checks.quarantined_before_scan = (await cand.c.storage.from('resumes').createSignedUrl(clean.path, 60)).error != null;

  const w = worker(); report.worker = { status: w.status, summary: w.out }; if (w.status !== 0) report.worker.stderr = w.err;
  const rows = Object.fromEntries((await q('select id::text, scan_status, scan_detail, scan_engine from public.resumes where id = any($1::uuid[])', [[clean.id, bad.id, fake.id]])).map((r) => [r.id, r]));
  report.results = { clean: rows[clean.id], eicar: rows[bad.id], fake: rows[fake.id] };
  report.checks.clean_is_clean = rows[clean.id]?.scan_status === 'clean';
  report.checks.eicar_is_infected = rows[bad.id]?.scan_status === 'infected';
  report.checks.fake_pdf_rejected = rows[fake.id]?.scan_status === 'failed' && rows[fake.id]?.scan_detail === 'not_a_pdf';
  const signed = await cand.c.storage.from('resumes').createSignedUrl(clean.path, 60);
  report.checks.owner_can_download_clean = !signed.error && (await fetch(signed.data.signedUrl)).status === 200;
  report.checks.infected_never_downloadable = (await cand.c.storage.from('resumes').createSignedUrl(bad.path, 60)).error != null;
  report.checks.other_user_cannot_download = (await adm.c.storage.from('resumes').createSignedUrl(clean.path, 60)).error != null;
  report.checks.anonymous_cannot_download = (await fetch(`${url}/storage/v1/object/resumes/${clean.path}`, { headers: { apikey: anon } })).status >= 400;
  pass = Object.values(report.checks).every(Boolean);
} catch (e) {
  report.error = String(e.message ?? e).slice(0, 300);
} finally {
  try {
    if (adm && !pass) {
      const off = await adm.c.rpc('admin_set_resume_uploads', { p_enabled: false, p_reason: `Resume go-live test run ${run} did not pass; uploads switched off again` });
      report.switched_off_again = !off.error;
    }
    if (adm && cand) {
      const rid = (await cand.c.rpc('request_account_deletion')).data;
      const del = await adm.c.rpc('admin_process_deletion', { p_request: rid, p_reason: `Automated QA clean-up after resume go-live test run ${run}` });
      report.cleanup_candidate = del.error ? del.error.message : 'deletion processed';
    }
    if (adm) {
      await q('delete from private.app_roles where user_id = $1', [adm.id]);
      await q(`select private.audit('admin.role_revoked', 'user', $1, null, jsonb_build_object('role', 'admin', 'reason', $2::text))`, [adm.id, `End of resume go-live test run ${run}`]);
      report.cleanup_admin = (await admin.auth.admin.deleteUser(adm.id, true)).error ? 'auth delete failed' : 'role revoked, soft-deleted';
    }
    // Purge the QA files now instead of waiting for the next scheduled run.
    report.purge = worker().out;
    report.uploads_enabled_now = (await q(`select private.resume_uploads_enabled() v`))[0].v;
  } catch (e) { report.cleanup_error = String(e.message ?? e).slice(0, 300); }
  await db.end();
}
report.passed = pass;
console.log(JSON.stringify(report, null, 2));
process.exit(pass ? 0 : 1);
