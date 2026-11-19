#!/usr/bin/env node
// Removes storage files of accounts whose deletion was processed.
// Run by the owner or a scheduled job with the SERVICE ROLE key in the environment. Never ship this key to the app.
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/purge-storage.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const { data: rows, error } = await db.from('privacy_requests').select('id, result').eq('kind', 'deletion').eq('status', 'completed');
if (error) throw error;
let purged = 0;
for (const row of rows ?? []) {
  const paths = row.result?.storage_paths_to_purge ?? [];
  if (!paths.length || row.result?.storage_purged_at) continue;
  const resumes = paths.filter((p) => !p.startsWith('photo:')); const photos = paths.filter((p) => p.startsWith('photo:')).map((p) => p.slice(6));
  if (resumes.length) { const r = await db.storage.from('resumes').remove(resumes); if (r.error) throw r.error; }
  if (photos.length) { const r = await db.storage.from('profile-photos').remove(photos); if (r.error) throw r.error; }
  const done = await db.from('privacy_requests').update({ result: { ...row.result, storage_purged_at: new Date().toISOString() } }).eq('id', row.id);
  if (done.error) throw done.error; purged += paths.length;
}
console.log(`Purged ${purged} file(s).`);
