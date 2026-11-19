// Supabase Edge Function: delivers queued emails from private.email_outbox.
// Provider-agnostic: today it talks to any HTTP email API with a Resend-compatible JSON shape.
// Secrets (set with `supabase secrets set`, never in code): EMAIL_API_URL, EMAIL_API_KEY, EMAIL_FROM, SITE_URL.
// Schedule: call every minute from Supabase Cron (see docs/OPERATIONS.md).
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const apiUrl = Deno.env.get('EMAIL_API_URL'); const apiKey = Deno.env.get('EMAIL_API_KEY');
const from = Deno.env.get('EMAIL_FROM') ?? 'KaamSetu <no-reply@getkaamsetu.in>'; const site = Deno.env.get('SITE_URL') ?? 'https://www.getkaamsetu.in';
const fnBase = `${Deno.env.get('SUPABASE_URL')}/functions/v1`;

// Subjects come from notification titles, which never contain candidate-identifying data (enforced by tests).
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function body(subject: string, token: string) {
  const unsubscribe = `${fnBase}/unsubscribe?token=${encodeURIComponent(token)}`;
  return `<p>${escape(subject)}.</p><p><a href="${site}">Open KaamSetu</a> to see the details. For your privacy, we never put application details in email.</p>`
    + `<p style="color:#667085;font-size:12px">Aarvya Global Ventures LLP. <a href="${unsubscribe}">Stop optional update emails</a>. Security and interview emails are always sent.</p>`;
}

Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) return new Response('Forbidden', { status: 403 });
  if (!apiUrl || !apiKey) return new Response(JSON.stringify({ skipped: 'email provider not configured' }), { status: 200 });
  const { data: jobs, error } = await db.rpc('outbox_claim', { p_limit: 50 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  let sent = 0; let failed = 0;
  for (const job of jobs ?? []) {
    try {
      const res = await fetch(apiUrl, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [job.recipient_email], subject: job.subject, html: body(job.subject, job.unsubscribe_token), headers: { 'List-Unsubscribe': `<${fnBase}/unsubscribe?token=${job.unsubscribe_token}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }) });
      if (!res.ok) throw new Error(`provider ${res.status}`);
      await db.rpc('outbox_report', { p_id: job.id, p_ok: true }); sent++;
    } catch (e) {
      // Log only the job id and error class, never the recipient address.
      console.error(JSON.stringify({ job: job.id, error: String((e as Error).message).slice(0, 120) }));
      await db.rpc('outbox_report', { p_id: job.id, p_ok: false, p_error: String((e as Error).message).slice(0, 300) }); failed++;
    }
  }
  return new Response(JSON.stringify({ sent, failed }), { headers: { 'Content-Type': 'application/json' } });
});
