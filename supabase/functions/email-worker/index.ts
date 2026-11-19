// Trusted worker: delivers queued email from private.email_outbox. Invoke every minute from Supabase Cron with
// header `x-worker-secret: <WORKER_SECRET>`. Secrets: WORKER_SECRET, EMAIL_PROVIDER (resend|postmark), EMAIL_API_KEY,
// EMAIL_FROM, SITE_URL. Without a provider it does NOT claim messages: they stay "pending" and appear in the admin console.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { providerFromEnv, renderEmail, safeEqual, type Category } from '../_shared/email-templates.ts';

const env = (k: string) => Deno.env.get(k);
const db = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const site = env('SITE_URL') ?? 'https://www.getkaamsetu.in';
const fnBase = `${env('SUPABASE_URL')}/functions/v1`;

Deno.serve(async (req) => {
  if (!safeEqual(req.headers.get('x-worker-secret') ?? '', env('WORKER_SECRET') ?? '')) return new Response('Forbidden', { status: 403 });
  const provider = providerFromEnv(env);
  if (!provider) return new Response(JSON.stringify({ configured: false, sent: 0 }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  const { data: jobs, error } = await db.rpc('outbox_claim', { p_limit: 50 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  let sent = 0; let failed = 0;
  for (const job of jobs ?? []) {
    try {
      if (!job.recipient_email) throw new Error('no_address');
      const email = renderEmail({ kind: job.kind, category: job.category as Category, subject: job.subject, siteUrl: site,
        unsubscribeUrl: job.unsubscribe_token ? `${fnBase}/unsubscribe?token=${job.unsubscribe_token}` : undefined });
      await provider.send(job.recipient_email, email);
      await db.rpc('outbox_report', { p_id: job.id, p_ok: true }); sent++;
    } catch (e) {
      console.error(JSON.stringify({ job: job.id, error: String((e as Error).message).slice(0, 120) })); // never log addresses
      await db.rpc('outbox_report', { p_id: job.id, p_ok: false, p_error: String((e as Error).message).slice(0, 300) }); failed++;
    }
  }
  return new Response(JSON.stringify({ configured: true, provider: provider.name, sent, failed }), { headers: { 'Content-Type': 'application/json' } });
});
