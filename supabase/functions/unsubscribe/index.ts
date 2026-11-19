// Public, token-based unsubscribe for optional emails (no login required; token is a random UUID).
import { createClient } from 'npm:@supabase/supabase-js@2';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!uuid.test(token)) return new Response('Invalid link', { status: 400 });
  const { data, error } = await db.rpc('unsubscribe_by_token', { p_token: token });
  const ok = !error && data === true;
  return new Response(ok ? 'You will no longer receive optional update emails from KaamSetu.' : 'This link is no longer valid.', { status: ok ? 200 : 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
});
