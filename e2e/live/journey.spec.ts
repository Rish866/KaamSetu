// REAL end-to-end marketplace journey through the user interface of a running KaamSetu (no SQL).
// Targets LIVE_BASE_URL: either the deployed site (production Supabase) or a local build against a local Supabase stack (CI).
// Accounts are qa+<run>-...; the candidate and employer are deleted at the end through the product's own deletion flow.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { btn, card, configured, confirmDialog, env, expectPortal, inCard, password, qaEmail, reason, signIn, signUp, uploadResume } from './helpers';

test.skip(!configured, 'LIVE_BASE_URL, LIVE_ADMIN_EMAIL and LIVE_ADMIN_PASSWORD are required');
test.describe.configure({ mode: 'serial' });

const tag = Date.now().toString(36);
const cand = { name: `QA Candidate ${tag}`, email: qaEmail('cand') };
const emp = { name: `QA Employer ${tag}`, email: qaEmail('emp'), company: `QA Test Co ${tag}` };
const jobTitle = `QA Support Lead ${tag}`;
let c: Page, e: Page, a: Page;

test.beforeAll(async ({ browser }) => {
  c = await (await browser.newContext({ acceptDownloads: true })).newPage();
  e = await (await browser.newContext()).newPage();
  a = await (await browser.newContext()).newPage();
});

test('1. candidate registers', async () => {
  await signUp(c, 'candidate', cand);
  await expectPortal(c, 'candidate');
});

test('2. candidate completes the profile', async () => {
  await c.goto(`${env.base}/candidate/profile`);
  await c.getByRole('textbox', { name: 'Professional headline' }).fill('Customer support specialist (QA test account)');
  await btn(c, 'Employed').click();
  await c.getByRole('textbox', { name: 'Total experience (years)' }).fill('3');
  await c.getByRole('textbox', { name: 'Expected salary (₹)' }).fill('600000');
  await c.getByRole('button', { name: 'Thane', exact: true }).first().click();
  await btn(c, 'Save profile').click();
  await expect(c.getByText('Profile saved.')).toBeVisible();
  for (const s of ['CRM', 'Customer support', 'English']) await c.getByRole('button', { name: s, exact: true }).last().click();
  await btn(c, 'Save skills').click();
  await expect(c.getByText('Skills saved.')).toBeVisible();
});

test('3-4. candidate uploads a resume; it is quarantined until a scanner marks it clean', async () => {
  await uploadResume(c);
  await expect(c.getByText(/Quarantined: this resume is waiting for a security scan/)).toBeVisible();
  await expect(btn(c, 'Download')).toBeDisabled();
});

test('5-7. employer registers, creates a company and submits verification evidence', async () => {
  await signUp(e, 'employer', emp);
  await expectPortal(e, 'employer');
  await e.getByRole('textbox', { name: 'Registered legal name' }).fill(`${emp.company} Pvt Ltd`);
  await e.getByRole('textbox', { name: 'Public brand name' }).fill(emp.company);
  await e.getByRole('textbox', { name: 'City' }).fill('Thane');
  await btn(e, 'Create workspace').click();
  await btn(e, 'Website domain').click();
  await e.getByRole('textbox', { name: 'Website domain' }).fill('qa.getkaamsetu.in');
  await btn(e, 'Submit for verification').click();
  await expect(e.getByText('Verification in review')).toBeVisible({ timeout: 20_000 });
});

test('8. admin approves the company with a mandatory written reason', async () => {
  await signIn(a, 'admin', { email: env.adminEmail }, env.adminPassword);
  await expectPortal(a, 'admin');
  await btn(a, 'Companies').click();
  await inCard(a, emp.company, 'Approve');
  await expect(btn(a, 'Approve')).toBeDisabled(); // no reason yet
  await confirmDialog(a, 'Approve', reason('domain checked'));
  await expect(a.getByText(/recorded in the audit log/)).toBeVisible();
  await btn(a, 'Audit').click();
  await expect(a.getByText('company.approve').first()).toBeVisible();
});

test('9-10. employer creates a job; admin approves it', async () => {
  await e.goto(`${env.base}/post-job`);
  await e.getByRole('textbox', { name: 'Job title' }).fill(jobTitle);
  await e.getByRole('textbox', { name: 'Description' }).fill('Lead a small customer support team. This is an automated QA listing and will be closed after the test.');
  await btn(e, 'Hybrid').click();
  await e.getByRole('button', { name: 'Thane', exact: true }).first().click();
  for (const s of ['CRM', 'Customer support']) await btn(e, s).click();
  await e.getByRole('textbox', { name: 'Minimum annual salary (₹)' }).fill('500000');
  await e.getByRole('textbox', { name: 'Maximum annual salary (₹)' }).fill('700000');
  await e.getByRole('textbox', { name: 'Minimum experience (years)' }).fill('1');
  await btn(e, 'Submit for review').click();
  await expect(e).toHaveURL(/\/employer\/jobs/, { timeout: 20_000 });
  await expect(card(e, jobTitle, 'Applicants').getByText('Pending review')).toBeVisible();
  await a.goto(`${env.base}/admin`); await btn(a, 'Jobs').click();
  await inCard(a, jobTitle, 'Approve and publish');
  await confirmDialog(a, 'Publish', reason('salary and description clear'));
  await expect(a.getByText(/recorded in the audit log/)).toBeVisible();
});

test('11-12. candidate searches, sees an explainable match and applies', async () => {
  await c.goto(`${env.base}/candidate`);
  await c.getByRole('textbox', { name: /Search title/ }).fill(jobTitle);
  await btn(c, 'Search').click();
  await inCard(c, jobTitle, 'View details');
  await expect(c.getByText(/Why this is a \d+% match/)).toBeVisible({ timeout: 20_000 });
  await expect(c.getByText(/Matches 2 of 2 listed skills/)).toBeVisible();
  await btn(c, 'Apply with my profile').click();
  await confirmDialog(c, 'Send application');
  await expect(c.getByText(/Application sent/)).toBeVisible();
  await c.reload();
  await expect(btn(c, 'Track application')).toBeVisible({ timeout: 20_000 });
});

test('13-15. employer views and shortlists; contact stays hidden until the candidate consents', async () => {
  await e.goto(`${env.base}/employer/jobs`);
  await inCard(e, jobTitle, 'Applicants');
  await expect(e.getByText(cand.name)).toBeVisible({ timeout: 20_000 });
  await btn(e, 'Mark viewed').click();
  await btn(e, 'Shortlist').click();
  await expect(e.getByText(/moved to Shortlisted/)).toBeVisible();
  await btn(e, 'View contact details').click();
  await expect(e.getByText(/not agreed to share contact details/)).toBeVisible();
  await c.goto(`${env.base}/candidate/settings`);
  await inCard(c, 'Share my email and phone after I am shortlisted', 'Off · Turn on');
  await expect(c.getByText(/You can withdraw this at any time/)).toBeVisible();
  await e.reload();
  await btn(e, 'View contact details').click();
  await expect(e.getByText(cand.email, { exact: false })).toBeVisible();
});

test('16-17. interview proposed, candidate asks to reschedule, then confirms the new time', async () => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 15:30`;
  const when = new Date(Date.now() + 3 * 86400e3);
  await btn(e, 'Propose interview').click();
  await e.getByRole('textbox', { name: /Date and time/ }).fill(fmt(when));
  await e.getByRole('textbox', { name: 'Meeting link or address' }).fill('Video link will be shared (QA)');
  await confirmDialog(e, 'Send proposal');
  await expect(e.getByText(/Interview proposed/)).toBeVisible();
  await c.goto(`${env.base}/candidate/applications`);
  await btn(c, 'Request another time').click();
  await c.getByRole('textbox', { name: /Preferred times/ }).fill('Any evening (QA)');
  await confirmDialog(c, 'Send request');
  await expect(c.getByText(/Request sent to the employer/)).toBeVisible();
  await e.reload();
  await expect(e.getByText(/Reschedule requested/)).toBeVisible({ timeout: 20_000 });
  await btn(e, 'Reschedule interview').click();
  await e.getByRole('textbox', { name: /Date and time/ }).fill(fmt(new Date(when.getTime() + 86400e3)));
  await confirmDialog(e, 'Send proposal');
  await c.reload();
  await btn(c, 'Confirm').click();
  await expect(c.getByText('Interview confirmed.')).toBeVisible();
});

test('18. employer records an offer', async () => {
  await e.reload();
  await btn(e, 'Make offer').click();
  await e.getByRole('textbox', { name: 'Offer details' }).fill('QA offer: role and salary as advertised (test only)');
  await confirmDialog(e, 'Send offer');
  await expect(e.getByText(/moved to Offer/)).toBeVisible();
});

test('19. candidate sees every status update', async () => {
  await c.goto(`${env.base}/candidate/applications`);
  for (const s of ['Applied', 'Viewed', 'Shortlisted', 'Interview', 'Offer']) await expect(c.getByText(new RegExp(`^${s} · `)).first()).toBeVisible({ timeout: 20_000 });
  await expect(c.getByText('QA offer: role and salary as advertised (test only)')).toBeVisible();
  await c.goto(`${env.base}/candidate/notifications`);
  for (const t of ['You have an offer', 'You were shortlisted', 'Interview changed']) await expect(c.getByText(t).first()).toBeVisible();
});

test('20. candidate downloads a personal-data export', async () => {
  await c.goto(`${env.base}/candidate/settings`);
  const dl = c.waitForEvent('download');
  await btn(c, 'Download my data').click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^kaamsetu-my-data-\d{4}-\d{2}-\d{2}\.json$/);
  const body = JSON.parse(readFileSync(await file.path(), 'utf8'));
  expect(body.account.email).toBe(cand.email);
  expect(body.applications[0].stage).toBe('offer');
  expect(JSON.stringify(body)).not.toContain(emp.email);
});

test('21-22. candidate requests deletion; admin processes the privacy request', async () => {
  await btn(c, 'Request account deletion').click();
  await confirmDialog(c, 'Request deletion');
  await expect(c.getByText(/Deletion requested on/)).toBeVisible();
  await a.goto(`${env.base}/admin`); await btn(a, 'Privacy').click();
  await inCard(a, cand.name, 'Process deletion');
  await confirmDialog(a, 'Delete account', reason('test account clean-up'));
  await expect(a.getByText(/Processed\./)).toBeVisible();
  await c.reload();
  await expect(c).not.toHaveURL(/\/candidate\/settings$/, { timeout: 20_000 });
});

test('23. clean-up: close the job, suspend the test company, delete the employer account', async () => {
  await e.goto(`${env.base}/employer/jobs`);
  await inCard(e, jobTitle, 'Close');
  await confirmDialog(e, 'Close job');
  await expect(e.getByText('Job closed.')).toBeVisible();
  await e.goto(`${env.base}/employer/settings`);
  await btn(e, 'Request account deletion').click();
  await confirmDialog(e, 'Request deletion');
  await a.goto(`${env.base}/admin`); await btn(a, 'Companies').click(); await btn(a, 'Approved').click();
  await inCard(a, emp.company, 'Suspend');
  await confirmDialog(a, 'Suspend', reason('test company clean-up'));
  await btn(a, 'Privacy').click();
  await inCard(a, emp.name, 'Process deletion');
  await confirmDialog(a, 'Delete account', reason('test account clean-up'));
  await expect(a.getByText(/Processed\./)).toBeVisible();
  // The sign-in identities and files are removed afterwards by the privacy worker; that is verified separately.
  void password;
});
