// REAL end-to-end marketplace journey through the deployed user interface (no SQL).
// STATUS: written, NOT YET EXECUTED. It needs the v1.4.0 website deployed against a migrated database.
// Run:  LIVE_BASE_URL=https://www.getkaamsetu.in LIVE_ADMIN_EMAIL=... LIVE_ADMIN_PASSWORD=... npx playwright test e2e/live --config e2e/live/playwright.live.config.ts
// The admin account must already hold the admin role (granted by the owner). Passwords come from the environment only.
// Test accounts use qa+<run>-...@getkaamsetu.in and are deleted at the end through the product's own deletion flow.
import { expect, test, type Page } from '@playwright/test';

const base = process.env.LIVE_BASE_URL; const adminEmail = process.env.LIVE_ADMIN_EMAIL; const adminPassword = process.env.LIVE_ADMIN_PASSWORD;
test.skip(!base || !adminEmail || !adminPassword, 'LIVE_BASE_URL, LIVE_ADMIN_EMAIL and LIVE_ADMIN_PASSWORD are required');
test.describe.configure({ mode: 'serial' });

const run = `${Date.now().toString(36)}`;
const pw = `Qa-${run}-Strong9`;
const cand = { name: `QA Candidate ${run}`, email: `qa+${run}-c@getkaamsetu.in` };
const emp = { name: `QA Employer ${run}`, email: `qa+${run}-e@getkaamsetu.in`, company: `QA Test Co ${run}` };
const jobTitle = `QA Support Lead ${run}`;
const reason = (s: string) => `Automated QA run ${run}: ${s}`;

function minimalPdf(text: string) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${44 + text.length} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const btn = (p: Page, name: string | RegExp) => p.getByRole('button', { name }).last();
async function confirmDialog(p: Page, label: string, why?: string) {
  if (why) await p.getByRole('textbox', { name: /Reason/ }).last().fill(why);
  await btn(p, label).click();
}
async function signUp(p: Page, role: 'candidate' | 'employer', who: { name: string; email: string }) {
  await p.goto(`${base}/login?role=${role}`);
  await btn(p, 'Create account').click();
  await p.getByRole('textbox', { name: 'Full name' }).fill(who.name);
  await p.getByRole('textbox', { name: 'Email address' }).fill(who.email);
  await p.getByRole('textbox', { name: 'Password', exact: true }).fill(pw);
  await p.getByRole('textbox', { name: 'Confirm password' }).fill(pw);
  await p.getByRole('checkbox').click();
  await btn(p, 'Create my account').click();
  await expect(p).toHaveURL(new RegExp(`/${role}`), { timeout: 20_000 });
}
async function signIn(p: Page, role: 'candidate' | 'employer' | 'admin', email: string, password: string) {
  await p.goto(`${base}/login?role=${role}`);
  await p.getByRole('textbox', { name: 'Email address' }).fill(email);
  await p.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  await btn(p, 'Sign in securely').click();
  await expect(p).toHaveURL(new RegExp(`/${role}`), { timeout: 20_000 });
}

let c: Page, e: Page, a: Page;
test.beforeAll(async ({ browser }) => { c = await (await browser.newContext()).newPage(); e = await (await browser.newContext()).newPage(); a = await (await browser.newContext({ acceptDownloads: true })).newPage(); });

test('1-4. candidate registers, completes profile, uploads a resume that is quarantined until scanned', async () => {
  await signUp(c, 'candidate', cand);
  await c.goto(`${base}/candidate/profile`);
  await c.getByRole('textbox', { name: 'Professional headline' }).fill('Customer support specialist (QA test account)');
  await c.getByRole('button', { name: 'Employed' }).click();
  await c.getByRole('textbox', { name: 'Total experience (years)' }).fill('3');
  await c.getByRole('textbox', { name: 'Expected salary (₹)' }).fill('600000');
  await c.getByRole('button', { name: 'Thane', exact: true }).first().click();
  await btn(c, 'Save profile').click();
  await expect(c.getByText('Profile saved.')).toBeVisible();
  for (const s of ['CRM', 'Customer support']) await c.getByRole('button', { name: s, exact: true }).click();
  await btn(c, 'Save skills').click();
  await expect(c.getByText('Skills saved.')).toBeVisible();
  const chooser = c.waitForEvent('filechooser');
  await btn(c, /Upload resume|Replace resume/).click();
  await (await chooser).setFiles({ name: 'qa-resume.pdf', mimeType: 'application/pdf', buffer: minimalPdf('QA resume CRM Customer support') });
  await expect(c.getByText(/Quarantined|Security check: passed/)).toBeVisible({ timeout: 20_000 });
});

test('5-7. employer registers, creates a company and submits verification', async () => {
  await signUp(e, 'employer', emp);
  await e.getByRole('textbox', { name: 'Registered legal name' }).fill(`${emp.company} Pvt Ltd`);
  await e.getByRole('textbox', { name: 'Public brand name' }).fill(emp.company);
  await e.getByRole('textbox', { name: 'City' }).fill('Thane');
  await btn(e, 'Create workspace').click();
  await e.getByRole('button', { name: 'Website domain' }).click();
  await e.getByRole('textbox', { name: 'Website domain' }).fill('getkaamsetu.in');
  await btn(e, 'Submit for verification').click();
  await expect(e.getByText(/Verification in review/)).toBeVisible({ timeout: 20_000 });
});

test('8. admin approves the company with a written reason', async () => {
  await signIn(a, 'admin', adminEmail!, adminPassword!);
  await a.getByRole('button', { name: 'Companies', exact: true }).click();
  const card = a.getByText(emp.company, { exact: false }).first(); await expect(card).toBeVisible();
  await a.locator('div', { has: card }).getByRole('button', { name: 'Approve' }).last().click();
  await confirmDialog(a, 'Approve', reason('domain checked'));
  await expect(a.getByText(/recorded in the audit log/)).toBeVisible();
});

test('9-10. employer creates a job; admin approves it', async () => {
  await e.goto(`${base}/post-job`);
  await e.getByRole('textbox', { name: 'Job title' }).fill(jobTitle);
  await e.getByRole('textbox', { name: 'Description' }).fill('Lead a small customer support team. This is an automated QA listing and will be closed after the test.');
  await e.getByRole('button', { name: 'Hybrid' }).click();
  await e.getByRole('button', { name: 'Thane', exact: true }).first().click();
  for (const s of ['CRM', 'Customer support']) await e.getByRole('button', { name: s, exact: true }).click();
  await e.getByRole('textbox', { name: 'Minimum annual salary (₹)' }).fill('500000');
  await e.getByRole('textbox', { name: 'Maximum annual salary (₹)' }).fill('700000');
  await e.getByRole('textbox', { name: 'Minimum experience (years)' }).fill('1');
  await btn(e, 'Submit for review').click();
  await expect(e).toHaveURL(/\/employer\/jobs/);
  await a.goto(`${base}/admin`); await a.getByRole('button', { name: 'Jobs', exact: true }).click();
  await a.locator('div', { has: a.getByText(jobTitle) }).getByRole('button', { name: 'Approve and publish' }).last().click();
  await confirmDialog(a, 'Publish', reason('salary and description clear'));
});

test('11-12. candidate sees an explainable match and applies', async () => {
  await c.goto(`${base}/candidate`);
  await c.getByRole('textbox', { name: /Search title/ }).fill(jobTitle); await btn(c, 'Search').click();
  await c.locator('div', { has: c.getByText(jobTitle) }).getByRole('button', { name: 'View details' }).last().click();
  await expect(c.getByText(/Why this is a \d+% match/)).toBeVisible();
  await expect(c.getByText(/Matches 2 of 2 listed skills/)).toBeVisible();
  await btn(c, 'Apply with my profile').click(); await confirmDialog(c, 'Send application');
  await expect(c.getByText('Application sent.', { exact: false })).toBeVisible();
});

test('13-15. employer views and shortlists; contact stays hidden until the candidate consents', async () => {
  await e.goto(`${base}/employer/jobs`);
  await e.locator('div', { has: e.getByText(jobTitle) }).getByRole('button', { name: 'Applicants' }).last().click();
  await expect(e.getByText(cand.name)).toBeVisible();
  await btn(e, 'Mark viewed').click(); await btn(e, 'Shortlist').click();
  await btn(e, 'View contact details').click();
  await expect(e.getByText(/not agreed to share contact details/)).toBeVisible();
  await c.goto(`${base}/candidate/settings`);
  await c.locator('div', { has: c.getByText('Share my email and phone after I am shortlisted') }).getByRole('button', { name: /Turn on/ }).last().click();
  await e.reload(); await btn(e, 'View contact details').click();
  await expect(e.getByText(cand.email)).toBeVisible();
});

test('16-18. interview proposed, candidate asks to reschedule then confirms, employer makes an offer', async () => {
  const when = new Date(Date.now() + 3 * 86400e3); const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 15:30`;
  await btn(e, 'Propose interview').click();
  await e.getByRole('textbox', { name: /Date and time/ }).fill(fmt(when)); await confirmDialog(e, 'Send proposal');
  await c.goto(`${base}/candidate/applications`); await btn(c, 'Request another time').click(); await confirmDialog(c, 'Send request');
  await e.reload(); await btn(e, 'Reschedule interview').click();
  await e.getByRole('textbox', { name: /Date and time/ }).fill(fmt(new Date(when.getTime() + 86400e3))); await confirmDialog(e, 'Send proposal');
  await c.reload(); await btn(c, 'Confirm').click();
  await e.reload(); await btn(e, 'Make offer').click();
  await e.getByRole('textbox', { name: 'Offer details' }).fill('QA offer: role and salary as advertised (test only)'); await confirmDialog(e, 'Send offer');
});

test('19. candidate sees every status update', async () => {
  await c.goto(`${base}/candidate/applications`);
  for (const s of ['Applied', 'Viewed', 'Shortlisted', 'Interview', 'Offer']) await expect(c.getByText(new RegExp(`^${s} ·`)).first()).toBeVisible();
  await c.goto(`${base}/candidate/notifications`);
  await expect(c.getByText('You have an offer')).toBeVisible();
});

test('20-22. data export, deletion request, admin processes it', async () => {
  await c.goto(`${base}/candidate/settings`);
  const dl = c.waitForEvent('download'); await btn(c, 'Download my data').click();
  const file = await (await dl).path(); expect(file).toBeTruthy();
  await btn(c, 'Request account deletion').click(); await confirmDialog(c, 'Request deletion');
  await a.goto(`${base}/admin`); await a.getByRole('button', { name: 'Privacy', exact: true }).click();
  await a.locator('div', { has: a.getByText(cand.name) }).getByRole('button', { name: 'Process deletion' }).last().click();
  await confirmDialog(a, 'Delete account', reason('test account clean-up'));
});

test('23. clean-up: close the job, suspend the test company, delete the employer account', async () => {
  await e.goto(`${base}/employer/jobs`);
  await e.locator('div', { has: e.getByText(jobTitle) }).getByRole('button', { name: 'Close' }).last().click(); await confirmDialog(e, 'Close job');
  await e.goto(`${base}/employer/settings`); await btn(e, 'Request account deletion').click(); await confirmDialog(e, 'Request deletion');
  await a.goto(`${base}/admin`); await a.getByRole('button', { name: 'Companies', exact: true }).click();
  await a.getByRole('button', { name: 'Approved', exact: true }).click();
  await a.locator('div', { has: a.getByText(emp.company) }).getByRole('button', { name: 'Suspend' }).last().click(); await confirmDialog(a, 'Suspend', reason('test company clean-up'));
  await a.getByRole('button', { name: 'Privacy', exact: true }).click();
  await a.locator('div', { has: a.getByText(emp.name) }).getByRole('button', { name: 'Process deletion' }).last().click(); await confirmDialog(a, 'Delete account', reason('test account clean-up'));
  // Auth identities and files are then removed by the privacy worker (Background workers workflow), which must be checked separately.
});
