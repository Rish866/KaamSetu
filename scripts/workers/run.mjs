#!/usr/bin/env node
// Trusted background workers for KaamSetu (replace the earlier Edge Function workers).
// Run by .github/workflows/workers.yml (production) and by CI against a local Supabase stack.
//   node --experimental-strip-types scripts/workers/run.mjs --task all|resumes|privacy|email|hiring
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (never printed), optional CLAMSCAN_CMD, EMAIL_PROVIDER/EMAIL_API_KEY/EMAIL_FROM,
//      SITE_URL. Logs contain only counts, task names and random IDs, never names, emails, phones or file contents.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { unzipSync } from 'fflate';
import { extractText, getDocumentProxy } from 'unpdf';
import { DOCX, extractDocxText, inspectResume, PDF, suggestSkills } from '../../supabase/functions/_shared/resume-core.ts';
import { providerFromEnv, renderEmail } from '../../supabase/functions/_shared/email-templates.ts';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const task = arg('task', 'all');
const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const summary = {};
const bump = (k, n = 1) => { summary[k] = (summary[k] ?? 0) + n; };
const must = async (p) => { const r = await p; if (r.error) throw r.error; return r.data; };
const unzip = (bytes, want) => {
  const entries = [];
  const files = unzipSync(bytes, { filter: (f) => { entries.push({ name: f.name, originalSize: f.originalSize }); return want(f.name) && f.originalSize < 20 * 1024 * 1024; } });
  return { entries, files };
};

/** Runs ClamAV on a directory. CLAMSCAN_CMD must print "<path>: OK" / "<path>: <sig> FOUND" lines (clamscan --no-summary). */
function clamscan(dir) {
  const cmd = process.env.CLAMSCAN_CMD; if (!cmd) return null;
  const r = spawnSync('bash', ['-c', `${cmd} "${dir}"`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0 && r.status !== 1) throw new Error(`clamscan_exit_${r.status}: ${(r.stderr || '').slice(0, 200)}`);
  const verdicts = {};
  for (const line of (r.stdout || '').split('\n')) {
    const m = /\/([0-9a-f-]{36})\.bin: (.+)$/.exec(line.trim()); if (!m) continue;
    verdicts[m[1]] = m[2] === 'OK' ? { verdict: 'clean' } : /FOUND$/.test(m[2]) ? { verdict: 'infected', detail: m[2].replace(/ FOUND$/, '').slice(0, 120) } : { verdict: 'error', detail: m[2].slice(0, 120) };
  }
  const version = spawnSync('bash', ['-c', `${process.env.CLAMSCAN_VERSION_CMD ?? 'true'}`], { encoding: 'utf8' }).stdout.trim().slice(0, 60) || 'clamav';
  return { verdicts, engine: version };
}

async function resumes() {
  bump('scan_timeouts', await must(db.rpc('resume_expire_stale_scans')));
  const work = await must(db.rpc('resume_work_claim', { p_limit: 25 }));
  const dir = mkdtempSync(join(tmpdir(), 'ks-scan-'));
  const toScan = [];
  let taxonomy = null;
  try {
    for (const w of work ?? []) {
      try {
        if (w.task === 'purge') {
          const { error } = await db.storage.from('resumes').remove([w.storage_path]);
          if (error && !/not found/i.test(error.message)) throw error;
          await must(db.rpc('resume_mark_purged', { p_resume: w.resume_id })); bump('purged'); continue;
        }
        const blob = await must(db.storage.from('resumes').download(w.storage_path));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (w.task === 'scan') {
          if (bytes.length !== w.byte_size) { await must(db.rpc('resume_scan_report', { p_resume: w.resume_id, p_verdict: 'rejected', p_engine: 'structure', p_detail: 'size_mismatch' })); bump('rejected'); continue; }
          const inspected = inspectResume(bytes, w.mime_type, unzip);
          if (!inspected.ok) { await must(db.rpc('resume_scan_report', { p_resume: w.resume_id, p_verdict: 'rejected', p_engine: 'structure', p_detail: inspected.reason })); bump('rejected'); continue; }
          writeFileSync(join(dir, `${w.resume_id}.bin`), bytes); toScan.push(w); continue;
        }
        if (w.task === 'parse') {
          if (!w.parsing_consent) { await must(db.rpc('resume_parse_report', { p_resume: w.resume_id, p_status: 'skipped' })); bump('parse_skipped'); continue; }
          let text = '';
          if (w.mime_type === DOCX) text = extractDocxText(bytes, unzip);
          else if (w.mime_type === PDF) text = String((await extractText(await getDocumentProxy(bytes), { mergePages: true })).text ?? '');
          if (!taxonomy) taxonomy = (await must(db.from('skills').select('name').eq('active', true))).map((s) => s.name);
          await must(db.rpc('resume_parse_report', { p_resume: w.resume_id, p_status: 'complete', p_data: { skills: suggestSkills(text, taxonomy), engine: 'keyword-v1' } }));
          bump('parsed');
        }
      } catch (e) {
        console.error(JSON.stringify({ resume: w.resume_id, task: w.task, error: String(e.message ?? e).slice(0, 120) }));
        if (w.task === 'scan') await db.rpc('resume_scan_report', { p_resume: w.resume_id, p_verdict: 'error', p_engine: 'worker', p_detail: String(e.message ?? e).slice(0, 200) });
        if (w.task === 'parse') await db.rpc('resume_parse_report', { p_resume: w.resume_id, p_status: 'failed' });
        bump('errors');
      }
    }
    if (toScan.length) {
      let result = null;
      try { result = clamscan(dir); } catch (e) { console.error(JSON.stringify({ scanner_error: String(e.message).slice(0, 200) })); }
      for (const w of toScan) {
        if (!result) { await must(db.rpc('resume_scan_report', { p_resume: w.resume_id, p_verdict: process.env.CLAMSCAN_CMD ? 'error' : 'unavailable', p_engine: 'none', p_detail: process.env.CLAMSCAN_CMD ? 'scanner_failed' : null })); bump(process.env.CLAMSCAN_CMD ? 'scan_errors' : 'awaiting_scanner'); continue; }
        const v = result.verdicts[w.resume_id] ?? { verdict: 'error', detail: 'no_verdict' };
        await must(db.rpc('resume_scan_report', { p_resume: w.resume_id, p_verdict: v.verdict, p_engine: result.engine, p_detail: v.detail ?? null }));
        bump(`scan_${v.verdict}`);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function purgePrefix(bucket, prefix) {
  let removed = 0;
  for (;;) {
    const files = (await must(db.storage.from(bucket).list(prefix, { limit: 100 }))).filter((f) => f.id).map((f) => `${prefix}/${f.name}`);
    if (!files.length) return removed;
    await must(db.storage.from(bucket).remove(files)); removed += files.length;
  }
}

async function privacy() {
  for (const p of (await must(db.rpc('privacy_deletions_pending'))) ?? []) {
    try {
      const { error } = await db.auth.admin.deleteUser(p.user_id, true); // soft delete: sign-in removed, email/phone freed, row kept for history
      if (error && !/not.?found/i.test(error.message)) throw error;
      await must(db.rpc('privacy_mark_processed', { p_request: p.request_id, p_step: 'auth_scrub' }));
      let files = 0; for (const b of ['resumes', 'profile-photos']) files += await purgePrefix(b, p.user_id);
      await must(db.rpc('privacy_mark_processed', { p_request: p.request_id, p_step: 'storage_purge' }));
      bump('accounts_cleaned'); bump('files_purged', files);
    } catch (e) { console.error(JSON.stringify({ request: p.request_id, error: String(e.message ?? e).slice(0, 120) })); bump('errors'); }
  }
}

async function email() {
  const provider = providerFromEnv((k) => process.env[k]);
  if (!provider) { bump('email_provider_missing'); return; } // nothing is claimed: messages stay pending and visible to admins
  const site = process.env.SITE_URL ?? 'https://www.getkaamsetu.in';
  for (const job of (await must(db.rpc('outbox_claim', { p_limit: 50 }))) ?? []) {
    try {
      if (!job.recipient_email) throw new Error('no_address');
      await provider.send(job.recipient_email, renderEmail({ kind: job.kind, category: job.category, subject: job.subject, siteUrl: site,
        unsubscribeUrl: job.unsubscribe_token ? `${url}/functions/v1/unsubscribe?token=${job.unsubscribe_token}` : undefined }));
      await must(db.rpc('outbox_report', { p_id: job.id, p_ok: true })); bump('emails_sent');
    } catch (e) { await db.rpc('outbox_report', { p_id: job.id, p_ok: false, p_error: String(e.message ?? e).slice(0, 300) }); bump('emails_failed'); }
  }
}

// Joining/retention reports the other side did not answer within 7 days become confirmed.
async function hiring() {
  bump('milestones_auto_confirmed', (await must(db.rpc('hiring_milestones_auto_confirm'))) ?? 0);
  // Published jobs not re-confirmed for 25 days get a reminder; after 30 days they are paused.
  const stale = (await must(db.rpc('jobs_stale_sweep'))) ?? {};
  bump('jobs_reminded', stale.reminded ?? 0); bump('jobs_auto_paused', stale.paused ?? 0);
}

const tasks = { resumes, privacy, email, hiring };
for (const [name, fn] of Object.entries(tasks)) {
  if (task !== 'all' && task !== name) continue;
  try { await fn(); } catch (e) { console.error(JSON.stringify({ task: name, error: String(e.message ?? e).slice(0, 200) })); bump(`${name}_failed`); }
}
console.log(JSON.stringify({ task, summary }));
process.exit(Object.keys(summary).some((k) => /_failed$|^errors$|scan_errors/.test(k)) ? 1 : 0);
