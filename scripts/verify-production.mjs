#!/usr/bin/env node
// Read-only production verification. Uses only public information (the publishable key shipped in the website bundle).
// Never signs in, never writes. Prints a JSON report; exits non-zero if any REQUIRED check fails.
//   node scripts/verify-production.mjs [--expect-schema 202611200006] [--site https://www.getkaamsetu.in]
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const sites = (args.site ? [args.site] : ['https://www.getkaamsetu.in', 'https://getkaamsetu.in']);
const expectSchema = args['expect-schema'] ?? null;
const report = { started_at: new Date().toISOString(), checks: [] };
const check = (name, ok, detail, required = true) => report.checks.push({ name, ok, required, detail });

async function bundleOf(site) {
  const html = await (await fetch(site, { redirect: 'follow' })).text();
  const scripts = [...new Set(html.match(/\/_expo\/static\/js\/web\/[^"]+\.js/g) ?? [])];
  const js = (await Promise.all(scripts.map(async (s) => (await fetch(new URL(s, site))).text()))).join('\n');
  return { html, js, scripts };
}

for (const site of sites) {
  const res = await fetch(site, { redirect: 'follow' });
  check(`${site} responds 200`, res.status === 200, { status: res.status, final_url: res.url });
}
const { html, js, scripts } = await bundleOf(sites[0]);
const url = (js.match(/https:\/\/[a-z0-9]{20}\.supabase\.co/) ?? [])[0];
const key = (js.match(/sb_publishable_[A-Za-z0-9_-]{10,}/) ?? [])[0];
check('bundle points at production Supabase project zrexqtzhdkkupyxmfqxd', url === 'https://zrexqtzhdkkupyxmfqxd.supabase.co', { url, scripts: scripts.length });
check('bundle contains no service-role or secret key material', !/sb_secret_[A-Za-z0-9_-]{20,}|c2VydmljZV9yb2xl/.test(js), {});
const demo = ['HarbourCloud', 'KiteRoute', 'BlueMango', 'Private prototype', 'Candidate demo', 'Employer demo', 'Admin demo'].filter((s) => js.includes(s) || html.includes(s));
check('deployed website contains no demo data strings', demo.length === 0, { found: demo });
// Every static asset referenced by the entry bundles (icon fonts, images) must actually be served. On 2026-11-21 the
// host dropped assets/node_modules/** and every icon font returned 404.
const assets = [...new Set(js.match(/\/assets\/[^"'\s]+\.(?:ttf|otf|woff2?|png|jpe?g|svg|gif|webp)/g) ?? [])];
const missing = [];
for (const a of assets) { const r = await fetch(new URL(a, sites[0])); if (r.status !== 200) missing.push(`${r.status} ${a}`); await r.arrayBuffer().catch(() => null); }
check('every asset referenced by the website bundle is served', assets.length > 0 && missing.length === 0, { referenced: assets.length, missing: missing.slice(0, 10) });
check('page has a <title>', /<title>[^<]+<\/title>/.test(html), {}, false);
check('page has a Content-Security-Policy meta tag', /Content-Security-Policy/.test(html), {}, false);

if (url && key) {
  const h = { apikey: key, 'Content-Type': 'application/json' };
  const rpc = async (fn, body = {}) => { const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const get = async (path) => { const r = await fetch(`${url}/rest/v1/${path}`, { headers: h }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const sv = await rpc('schema_version');
  const schema = sv.status === 200 ? sv.body : null;
  check('database schema version', expectSchema ? schema === expectSchema : true, { schema: schema ?? `missing (${sv.body?.code ?? sv.status})`, expected: expectSchema });
  // Anonymous callers must be refused by protected RPCs. On an old schema these report "missing", which is also not exposed.
  for (const fn of ['apply_to_job', 'job_feed', 'admin_dashboard', 'outbox_claim', 'resume_work_claim', 'current_user_access']) {
    const r = await rpc(fn, fn === 'apply_to_job' ? { p_job: '00000000-0000-0000-0000-000000000000' } : {});
    const code = r.body?.code;
    check(`anon cannot execute ${fn}`, code === '42501' || code === 'PGRST202' || r.status === 401, { status: r.status, code });
  }
  for (const t of ['profiles', 'candidate_profiles', 'applications', 'resumes', 'notifications', 'consent_records', 'job_invitations', 'interviews', 'contact_disclosures']) {
    const r = await get(`${t}?select=*&limit=1`);
    check(`anon cannot read ${t}`, r.status === 401 || r.status === 403 || r.status === 404 || (Array.isArray(r.body) && r.body.length === 0), { status: r.status, code: r.body?.code });
  }
  if (schema) {
    const cb = await get('jobs?select=created_by&limit=1'); check('anon cannot read jobs.created_by', cb.status >= 400, { status: cb.status, code: cb.body?.code });
    const ln = await get('companies?select=legal_name&limit=1'); check('anon cannot read companies.legal_name', ln.status >= 400, { status: ln.status, code: ln.body?.code });
  }
  const st = await fetch(`${url}/storage/v1/object/list/resumes`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: '', limit: 5 }) });
  const stBody = await st.json().catch(() => null);
  check('anon cannot list resume files', st.status >= 400 || (Array.isArray(stBody) && stBody.length === 0), { status: st.status });
  const pub = await get('jobs?select=id,title,salary_min,salary_max&status=eq.published&limit=50');
  check('public published jobs readable (count is informational)', pub.status === 200, { status: pub.status, published_jobs_visible: Array.isArray(pub.body) ? pub.body.length : null }, false);
}
report.finished_at = new Date().toISOString();
report.passed = report.checks.filter((c) => c.required).every((c) => c.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
