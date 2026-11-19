// Trusted worker that finishes processed account deletions:
//  1. Soft-deletes the Supabase Auth user (auth.admin.deleteUser(id, true)): sign-in stops, identities and sessions are removed,
//     and email/phone are obfuscated so they can be registered again. The auth row is kept, so audit/consent foreign keys stay valid.
//  2. Removes every stored file under the user's folder in the private buckets (catches files that were never registered).
// Invoke from Supabase Cron with header `x-worker-secret: <WORKER_SECRET>`.
// Status: written against the documented supabase-js Admin API; NOT yet verified against a real project.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { safeEqual } from '../_shared/email-templates.ts';

const env = (k: string) => Deno.env.get(k);
const db = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

async function purgePrefix(bucket: string, prefix: string) {
  let removed = 0;
  for (;;) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 100 });
    if (error) throw error;
    const files = (data ?? []).filter((f) => f.id).map((f) => `${prefix}/${f.name}`);
    if (!files.length) return removed;
    const { error: e } = await db.storage.from(bucket).remove(files); if (e) throw e;
    removed += files.length;
  }
}

Deno.serve(async (req) => {
  if (!safeEqual(req.headers.get('x-worker-secret') ?? '', env('WORKER_SECRET') ?? '')) return new Response('Forbidden', { status: 403 });
  const { data: pending, error } = await db.rpc('privacy_deletions_pending');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const results: { request: string; auth: string; files: number | string }[] = [];
  for (const p of pending ?? []) {
    const r = { request: p.request_id, auth: 'pending', files: 0 as number | string };
    try {
      const { error: de } = await db.auth.admin.deleteUser(p.user_id, true);
      if (de && !/not.?found/i.test(de.message)) throw de;
      await db.rpc('privacy_mark_processed', { p_request: p.request_id, p_step: 'auth_scrub' }); r.auth = 'done';
      let files = 0;
      for (const bucket of ['resumes', 'profile-photos']) files += await purgePrefix(bucket, p.user_id);
      await db.rpc('privacy_mark_processed', { p_request: p.request_id, p_step: 'storage_purge' }); r.files = files;
    } catch (e) {
      console.error(JSON.stringify({ request: p.request_id, error: String((e as Error).message).slice(0, 120) }));
      r.files = 'error';
    }
    results.push(r);
  }
  return new Response(JSON.stringify({ processed: results.length, results }), { headers: { 'Content-Type': 'application/json' } });
});
