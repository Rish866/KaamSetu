// Optional-email unsubscribe. GET shows a confirmation page (mail scanners prefetch links, so GET changes nothing);
// POST performs it, which also serves RFC 8058 one-click unsubscribe.
import { createClient } from 'npm:@supabase/supabase-js@2';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const page = (body: string, status = 200) => new Response(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:Arial,sans-serif;max-width:480px;margin:40px auto">${body}</body>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" } });
Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!uuid.test(token)) return page('<p>This link is not valid.</p>', 400);
  if (req.method === 'GET') return page(`<h2>Stop optional KaamSetu emails?</h2><p>Security and interview emails are always sent.</p><form method="post"><button type="submit">Stop optional emails</button></form>`);
  if (req.method !== 'POST') return page('<p>Method not allowed.</p>', 405);
  const { data, error } = await db.rpc('unsubscribe_by_token', { p_token: token });
  return !error && data === true ? page('<p>Done. You will no longer receive optional update emails.</p>') : page('<p>This link is no longer valid.</p>', 404);
});
