#!/usr/bin/env node
// Classifies `supabase db diff` output (production vs. the migrations it has applied).
//  * privilege statements: environment differences in Supabase default privileges (reported, not failing)
//  * Supabase-managed objects: public.rls_auto_enable() (reported, not failing)
//  * known and resolved by migration 202611200005: RLS on private tables, private.is_admin / is_company_member
//  * anything else: structural drift -> exit 1
import { readFileSync } from 'node:fs';
const text = readFileSync(process.argv[2] ?? 'drift.sql', 'utf8');
const body = text.slice(Math.max(0, text.indexOf('SET local check_function_bodies')));
// Split on statement-terminating semicolons, ignoring those inside $tag$ ... $tag$ function bodies.
const statements = []; let cur = []; let inDollar = false;
for (const line of body.split('\n')) {
  cur.push(line);
  const tags = line.match(/\$[A-Za-z_]*\$/g) ?? [];
  if (tags.length % 2 === 1) inDollar = !inDollar;
  if (!inDollar && /;\s*$/.test(line)) { statements.push(cur.join('\n').trim()); cur = []; }
}
if (cur.join('').trim()) statements.push(cur.join('\n').trim());
const filtered = statements.filter((s) => s && !/^SET local/i.test(s));
const out = { privilege: [], managed: [], known: [], structural: [] };
for (const s of filtered) {
  const head = s.split('\n')[0].slice(0, 160);
  if (/^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES)\b/.test(s)) out.privilege.push(head);
  else if (/rls_auto_enable/.test(s)) out.managed.push(head);
  else if (/^ALTER TABLE "private"\."(app_roles|audit_events|company_verifications|email_outbox)"\s+ENABLE ROW LEVEL SECURITY/.test(s)
        || /^CREATE OR REPLACE FUNCTION private\.(is_admin|is_company_member) \(/.test(s)) out.known.push(head.replace(/\s+$/, '') + (s.includes('ENABLE ROW LEVEL SECURITY') ? ' ENABLE ROW LEVEL SECURITY' : ''));
  else out.structural.push(head);
}
console.log(`privilege statements (environment defaults, informational): ${out.privilege.length}`);
console.log(`Supabase-managed objects (informational): ${out.managed.length}${out.managed.length ? `\n  ${out.managed.join('\n  ')}` : ''}`);
console.log(`known differences resolved by 202611200005: ${out.known.length}${out.known.length ? `\n  ${out.known.join('\n  ')}` : ''}`);
console.log(`STRUCTURAL drift: ${out.structural.length}${out.structural.length ? `\n  ${out.structural.join('\n  ')}` : ''}`);
process.exit(out.structural.length ? 1 : 0);
