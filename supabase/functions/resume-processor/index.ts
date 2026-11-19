// Trusted worker: scans, parses and purges resumes. Invoke every few minutes from Supabase Cron with header
// `x-worker-secret: <WORKER_SECRET>`. Uses the service role internally; never exposed to clients.
// Secrets: WORKER_SECRET, SCANNER, SCANNER_URL, (SCANNER_TOKEN). Without a scanner, files stay quarantined.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { unzipSync } from 'npm:fflate@0.8.2';
import { extractText, getDocumentProxy } from 'npm:unpdf@1';
import { DOCX, extractDocxText, inspectResume, PDF, suggestSkills, type Unzip } from '../_shared/resume-core.ts';
import { scannerFromEnv } from '../_shared/scanner.ts';
import { safeEqual } from '../_shared/email-templates.ts';

const env = (k: string) => Deno.env.get(k);
const db = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const unzip: Unzip = (bytes, want) => {
  const entries: { name: string; originalSize: number }[] = [];
  const files = unzipSync(bytes, { filter: (f) => { entries.push({ name: f.name, originalSize: f.originalSize }); return want(f.name) && f.originalSize < 20 * 1024 * 1024; } });
  return { entries, files };
};
const log = (o: Record<string, unknown>) => console.log(JSON.stringify(o)); // ids and states only, never file contents or names

Deno.serve(async (req) => {
  if (!safeEqual(req.headers.get('x-worker-secret') ?? '', env('WORKER_SECRET') ?? '')) return new Response('Forbidden', { status: 403 });
  const scanner = scannerFromEnv(env);
  const { data: work, error } = await db.rpc('resume_work_claim', { p_limit: 10 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const summary: Record<string, number> = {};
  const bump = (k: string) => { summary[k] = (summary[k] ?? 0) + 1; };
  let taxonomy: string[] | null = null;
  for (const w of work ?? []) {
    try {
      if (w.task === 'purge') {
        const { error: e } = await db.storage.from('resumes').remove([w.storage_path]);
        if (e && !/not found/i.test(e.message)) throw e;
        await db.rpc('resume_mark_purged', { p_resume: w.resume_id }); bump('purged'); continue;
      }
      const { data: blob, error: dl } = await db.storage.from('resumes').download(w.storage_path);
      if (dl || !blob) throw dl ?? new Error('download_failed');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (w.task === 'scan') {
        if (bytes.length !== w.byte_size) { await db.rpc('resume_scan_report', { p_resume: w.resume_id, p_verdict: 'rejected', p_engine: 'structure', p_detail: 'size_mismatch' }); bump('rejected'); continue; }
        const inspected = inspectResume(bytes, w.mime_type, unzip);
        if (!inspected.ok) { await db.rpc('resume_scan_report', { p_resume: w.resume_id, p_verdict: 'rejected', p_engine: 'structure', p_detail: inspected.reason }); bump('rejected'); continue; }
        if (!scanner) { await db.rpc('resume_scan_report', { p_resume: w.resume_id, p_verdict: 'unavailable', p_engine: 'none' }); bump('awaiting_scanner'); continue; }
        const v = await scanner.scan(bytes, w.mime_type === PDF ? 'resume.pdf' : 'resume.docx');
        await db.rpc('resume_scan_report', { p_resume: w.resume_id, p_verdict: v.verdict, p_engine: v.engine, p_detail: v.detail ?? null }); bump(v.verdict); continue;
      }
      if (w.task === 'parse') {
        if (!w.parsing_consent) { await db.rpc('resume_parse_report', { p_resume: w.resume_id, p_status: 'skipped' }); bump('parse_skipped'); continue; }
        let text = '';
        if (w.mime_type === DOCX) text = extractDocxText(bytes, unzip);
        else { const pdf = await getDocumentProxy(bytes); text = String((await extractText(pdf, { mergePages: true })).text ?? ''); }
        if (!taxonomy) { const { data } = await db.from('skills').select('name').eq('active', true); taxonomy = (data ?? []).map((s) => s.name); }
        const skills = suggestSkills(text, taxonomy);
        await db.rpc('resume_parse_report', { p_resume: w.resume_id, p_status: 'complete', p_data: { skills, engine: 'keyword-v1' } }); bump('parsed');
      }
    } catch (e) {
      log({ resume: w.resume_id, task: w.task, error: String((e as Error).message).slice(0, 120) });
      if (w.task === 'scan') await db.rpc('resume_scan_report', { p_resume: w.resume_id, p_verdict: 'error', p_engine: scanner?.name ?? 'none', p_detail: String((e as Error).message).slice(0, 200) });
      if (w.task === 'parse') await db.rpc('resume_parse_report', { p_resume: w.resume_id, p_status: 'failed' });
      bump('errors');
    }
  }
  log({ summary, scanner: scanner?.name ?? 'none' });
  return new Response(JSON.stringify({ processed: (work ?? []).length, summary, scanner_configured: Boolean(scanner) }), { headers: { 'Content-Type': 'application/json' } });
});
