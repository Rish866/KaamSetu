// Resume storage security against a REAL Supabase Storage API (local stack in CI).
// The scanner verdict is SIMULATED by calling the service-only RPC from the test database connection, because no
// malware scanner is deployed. Everything else goes through the real UI or the real Storage HTTP API with real user JWTs.
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { btn, configured, env, expectPortal, qaEmail, run, sessionOf, signUp, uploadResume } from './helpers';

test.skip(!configured || !env.dbUrl || !env.supabaseUrl, 'local stack only (needs LIVE_DB_URL; never production)');
test.describe.configure({ mode: 'serial' });

const db = new pg.Pool({ connectionString: env.dbUrl, max: 2, allowExitOnIdle: true });
const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
const api = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${env.supabaseUrl}/storage/v1/${path}`, { ...init, headers: { apikey: env.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
const sign = (path: string, token: string, expiresIn = 60) => api(`object/sign/resumes/${path}`, token, { method: 'POST', body: JSON.stringify({ expiresIn }) });
async function asUser(uid: string, sql: string, p: unknown[] = []) {
  const c = await db.connect();
  try {
    await c.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', json_build_object('sub', $1, 'role', 'authenticated')::text, false)`, [uid]);
    await c.query('set role authenticated');
    return (await c.query(sql, p)).rows;
  } finally {
    await c.query(`reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`).catch(() => undefined);
    c.release();
  }
}

let owner: Page, other: Page, employer: Page, ownerToken = '', otherToken = '', employerToken = '', ownerId = '', employerId = '', path = '', resumeId = '';

test.beforeAll(async ({ browser }) => {
  owner = await (await browser.newContext()).newPage(); other = await (await browser.newContext()).newPage(); employer = await (await browser.newContext()).newPage();
  await signUp(owner, 'candidate', { name: `QA Storage ${run}`, email: qaEmail('st-owner') }); await expectPortal(owner, 'candidate');
  await signUp(other, 'candidate', { name: `QA Other ${run}`, email: qaEmail('st-other') }); await expectPortal(other, 'candidate');
  await signUp(employer, 'employer', { name: `QA Storage Employer ${run}`, email: qaEmail('st-emp') }); await expectPortal(employer, 'employer');
  const [s1, s2, s3] = await Promise.all([sessionOf(owner), sessionOf(other), sessionOf(employer)]);
  ownerToken = s1.access_token; otherToken = s2.access_token; employerToken = s3.access_token; ownerId = s1.user.id; employerId = s3.user.id;
});

test('uploaded resume is quarantined: nobody, including the owner, can get a download URL', async () => {
  await uploadResume(owner);
  const [r] = await q('select id, storage_path, scan_status from public.resumes where candidate_id = $1 and active', [ownerId]);
  expect(r.scan_status).toBe('pending'); path = r.storage_path; resumeId = r.id;
  for (const t of [ownerToken, otherToken, employerToken]) expect((await sign(path, t)).status).toBeGreaterThanOrEqual(400);
  await expect(btn(owner, 'Download')).toBeDisabled();
});

test('storage paths are not publicly reachable', async () => {
  expect((await fetch(`${env.supabaseUrl}/storage/v1/object/public/resumes/${path}`)).status).toBeGreaterThanOrEqual(400);
  const list = await api('object/list/resumes', env.anonKey, { method: 'POST', body: JSON.stringify({ prefix: ownerId, limit: 10 }) });
  const body = await list.json().catch(() => null);
  expect(list.status >= 400 || (Array.isArray(body) && body.length === 0)).toBe(true);
});

test('after a (simulated) clean scan: owner gets a working 60-second link; other users still cannot', async () => {
  await q(`select public.resume_scan_report($1, 'clean', 'qa-simulated', 'test')`, [resumeId]);
  const res = await sign(path, ownerToken);
  expect(res.status).toBe(200);
  const { signedURL } = await res.json() as { signedURL: string };
  const file = await fetch(`${env.supabaseUrl}/storage/v1${signedURL}`);
  expect(file.status).toBe(200);
  expect(Buffer.from(await file.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  const token = new URL(`http://x${signedURL}`).searchParams.get('token')!;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  expect(claims.exp - claims.iat).toBe(60);
  expect((await sign(path, otherToken)).status).toBeGreaterThanOrEqual(400);
  expect((await sign(path, employerToken)).status).toBeGreaterThanOrEqual(400);
  // The owner's own UI download button uses the same 60-second link.
  await owner.reload();
  const request = owner.context().waitForEvent('request', (r) => r.url().includes('/storage/v1/object/sign/resumes/') && r.method() === 'GET');
  await btn(owner, 'Download').click();
  const opened = await request; // the new tab requests the signed URL (Chromium then treats the PDF as a download)
  expect(new URL(opened.url()).searchParams.get('token')).toBeTruthy();
});

test('signed URLs stop working after they expire', async () => {
  const res = await sign(path, ownerToken, 3);
  const { signedURL } = await res.json() as { signedURL: string };
  expect((await fetch(`${env.supabaseUrl}/storage/v1${signedURL}`)).status).toBe(200);
  await new Promise((r) => setTimeout(r, 5000));
  expect((await fetch(`${env.supabaseUrl}/storage/v1${signedURL}`)).status).toBeGreaterThanOrEqual(400);
});

test('an employer the candidate applied to can open the clean resume; access ends when the application is withdrawn', async () => {
  // Fixture through the real RPCs as each user (company verification and job approval are covered in journey.spec).
  const [adm] = await q(`select user_id from private.app_roles where role = 'admin' limit 1`);
  const companyId = (await asUser(employerId, `select public.create_employer_company('QA Storage Pvt Ltd','QA Storage','Thane',null) id`))[0].id;
  await asUser(employerId, `select public.submit_company_verification($1,'domain','qa.getkaamsetu.in')`, [companyId]);
  await asUser(adm.user_id, `select public.admin_review_company($1,'approve','QA storage test')`, [companyId]);
  const [loc] = await q(`select id from public.locations where city = 'Thane' and locality is null`);
  const jobId = (await asUser(employerId, `insert into public.jobs (company_id,title,description,salary_min,salary_max,work_mode,employment_type,location_id,created_by)
    values ($1,'QA storage job','A test job used only by the storage access test and closed afterwards.',100000,200000,'hybrid','full_time',$2,$3) returning id`, [companyId, loc.id, employerId]))[0].id;
  await asUser(employerId, `insert into public.job_skills (job_id, skill_id) select $1, id from public.skills where name = 'CRM'`, [jobId]);
  await asUser(employerId, 'select public.submit_job_for_review($1)', [jobId]);
  await asUser(adm.user_id, `select public.admin_review_job($1,'approve','QA storage test')`, [jobId]);
  const appId = (await asUser(ownerId, 'select public.apply_to_job($1) id', [jobId]))[0].id;
  expect((await sign(path, employerToken)).status).toBe(200);
  expect((await sign(path, otherToken)).status).toBeGreaterThanOrEqual(400);
  await asUser(ownerId, 'select public.withdraw_application($1)', [appId]);
  expect((await sign(path, employerToken)).status).toBeGreaterThanOrEqual(400);
});

test('infected and failed files can never be downloaded', async () => {
  await uploadResume(owner, 'second file CRM');
  const [r2] = await q(`select id, storage_path from public.resumes where candidate_id = $1 and active and id <> $2`, [ownerId, resumeId]);
  await q(`select public.resume_scan_report($1, 'infected', 'qa-simulated', 'EICAR')`, [r2.id]);
  expect((await sign(r2.storage_path, ownerToken)).status).toBeGreaterThanOrEqual(400);
  await owner.reload();
  await expect(owner.getByText(/was not accepted: our virus scanner flagged it/)).toBeVisible();
});
