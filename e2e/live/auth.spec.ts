// Real authentication behaviour through the UI and the Supabase Auth API of a running KaamSetu.
import { expect, test } from '@playwright/test';
import { btn, configured, confirmDialog, env, expectPortal, inCard, password, qaEmail, reason, run, sessionOf, signIn, signUp } from './helpers';

test.skip(!configured || !env.supabaseUrl || !env.anonKey, 'LIVE_* variables required');
test.describe.configure({ mode: 'serial' });

const email = qaEmail('auth');
const phone = `9${String(Date.now()).slice(-9)}`;
const created: { email?: string; phone?: string; kind: 'candidate' | 'employer' }[] = [];

test('email/password sign-up creates a candidate session; session persists across reloads', async ({ page }) => {
  await signUp(page, 'candidate', { name: `QA Auth ${run}`, email });
  created.push({ email, kind: 'candidate' });
  await expectPortal(page, 'candidate');
  await page.reload();
  await expectPortal(page, 'candidate');
  await expect(page.getByText('Find your next job')).toBeVisible();
});

test('mobile/password sign-up works and the number can be used to sign in', async ({ page }) => {
  await signUp(page, 'employer', { name: `QA Phone ${run}`, phone });
  created.push({ phone, kind: 'employer' });
  await expectPortal(page, 'employer');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  await signIn(page, 'employer', { phone });
  await expectPortal(page, 'employer');
});

test('duplicate email and duplicate phone are refused with a neutral message', async ({ page }) => {
  await signUp(page, 'candidate', { name: 'QA Duplicate', email });
  await expect(page.getByRole('alert')).toContainText(/could not create an account with these details|Check your inbox/);
  await expect(page).toHaveURL(/\/login/);
  await signUp(page, 'candidate', { name: 'QA Duplicate', phone });
  await expect(page.getByRole('alert')).toContainText(/could not create an account with these details|Check your inbox/);
  await expect(page).toHaveURL(/\/login/);
});

test('wrong password and unknown account give the same message', async ({ page }) => {
  await signIn(page, 'candidate', { email }, 'Wrong-Password-1');
  await expect(page.getByRole('alert')).toHaveText('The email/mobile number or password is incorrect.');
  await signIn(page, 'candidate', { email: qaEmail('nobody') }, 'Wrong-Password-1');
  await expect(page.getByRole('alert')).toHaveText('The email/mobile number or password is incorrect.');
});

test('route isolation: a candidate cannot open employer or admin areas', async ({ page }) => {
  await signIn(page, 'candidate', { email });
  await expectPortal(page, 'candidate');
  for (const path of ['/employer', '/employer/jobs', '/post-job', '/admin']) {
    await page.goto(`${env.base}${path}`);
    await expect(page).not.toHaveURL(new RegExp(`${path}$`), { timeout: 15_000 });
    await expect(page.getByText(/hiring desk|Trust & safety console/)).toHaveCount(0);
  }
  // Signing in through the admin door does not grant admin access.
  await page.goto(`${env.base}/login?role=admin`);
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  await btn(page, 'Sign in securely').click();
  await expect(page.getByRole('alert')).toContainText('does not have administrator access');
});

test('logout from all devices revokes the other device refresh token', async ({ browser }) => {
  const one = await (await browser.newContext()).newPage(); const two = await (await browser.newContext()).newPage();
  await signIn(one, 'candidate', { email }); await expectPortal(one, 'candidate');
  await signIn(two, 'candidate', { email }); await expectPortal(two, 'candidate');
  const other = await sessionOf(two);
  await one.goto(`${env.base}/candidate/settings`);
  await btn(one, 'Sign out of all devices').click();
  await confirmDialog(one, 'Sign out of all devices');
  await expect(one).toHaveURL(/\/login/, { timeout: 20_000 });
  const r = await fetch(`${env.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: env.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: other.refresh_token }) });
  expect(r.status, 'revoked refresh token must be rejected').toBeGreaterThanOrEqual(400);
});

test('logout from this device ends the session', async ({ page }) => {
  await signIn(page, 'candidate', { email }); await expectPortal(page, 'candidate');
  await page.goto(`${env.base}/candidate/settings`);
  await btn(page, 'Sign out of this device').click();
  await page.goto(`${env.base}/candidate`);
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
});

test('password reset email works end to end (local stack: read from Mailpit)', async ({ page }) => {
  test.skip(!env.mailpit, 'Mailpit is only available on the local stack; production delivery depends on SMTP');
  await page.goto(`${env.base}/login?role=candidate`);
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('alert')).toContainText('If this email is registered');
  let link = '';
  for (let i = 0; i < 20 && !link; i++) {
    const list = await (await fetch(`${env.mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json() as { messages: { ID: string }[] };
    if (list.messages?.length) {
      const msg = await (await fetch(`${env.mailpit}/api/v1/message/${list.messages[0].ID}`)).json() as { HTML: string; Text: string };
      link = ((msg.HTML || msg.Text).match(/https?:\/\/[^"'\s<>]+verify[^"'\s<>]+/) ?? [''])[0].replace(/&amp;/g, '&');
    }
    if (!link) await page.waitForTimeout(1000);
  }
  expect(link, 'reset email received').not.toBe('');
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password/, { timeout: 20_000 });
  const next = `${password}X`;
  await page.getByRole('textbox', { name: 'New password' }).fill(next);
  await page.getByRole('textbox', { name: 'Confirm new password' }).fill(next);
  await btn(page, 'Update password').click();
  await expect(page.getByRole('alert')).toContainText('Your password has been updated');
  await signIn(page, 'candidate', { email }, next); await expectPortal(page, 'candidate');
  // Restore so later specs can sign in.
  await page.goto(`${env.base}/candidate/settings`);
  await page.getByRole('textbox', { name: 'Current password' }).fill(next);
  await page.getByRole('textbox', { name: 'New password' }).fill(password);
  await page.getByRole('textbox', { name: 'Repeat new password' }).fill(password);
  await btn(page, 'Change password').click();
  await expect(page.getByText(/Password changed/)).toBeVisible();
});

test('password change requires the current password', async ({ page }) => {
  await signIn(page, 'candidate', { email }); await expectPortal(page, 'candidate');
  await page.goto(`${env.base}/candidate/settings`);
  await page.getByRole('textbox', { name: 'Current password' }).fill('Not-The-Password-1');
  await page.getByRole('textbox', { name: 'New password' }).fill(`${password}Y`);
  await page.getByRole('textbox', { name: 'Repeat new password' }).fill(`${password}Y`);
  await btn(page, 'Change password').click();
  await expect(page.getByText('Your current password is incorrect.')).toBeVisible();
});

test('suspended accounts lose access; restoring brings it back', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage(); const user = await (await browser.newContext()).newPage();
  await signIn(admin, 'admin', { email: env.adminEmail }, env.adminPassword); await expectPortal(admin, 'admin');
  await btn(admin, 'Users').click();
  await admin.getByRole('textbox', { name: /Find a user/ }).fill(email);
  await btn(admin, 'Search').click();
  await inCard(admin, email, 'Suspend account');
  await confirmDialog(admin, 'Suspend', reason('suspension test'));
  await signIn(user, 'candidate', { email });
  await expect(user.getByRole('alert')).toContainText('This account is unavailable');
  await expect(user).toHaveURL(/\/login/);
  await btn(admin, 'Search').click();
  await inCard(admin, email, 'Restore account');
  await confirmDialog(admin, 'Restore', reason('suspension test finished'));
  await signIn(user, 'candidate', { email }); await expectPortal(user, 'candidate');
});

test('clean-up: test accounts request deletion and the admin processes it', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  for (const acct of created) {
    const p = await (await browser.newContext()).newPage();
    await signIn(p, acct.kind, acct.email ? { email: acct.email } : { phone: acct.phone }); await expectPortal(p, acct.kind);
    await p.goto(`${env.base}/${acct.kind}/settings`);
    await btn(p, 'Request account deletion').click(); await confirmDialog(p, 'Request deletion');
    await expect(p.getByText(/Deletion requested on/)).toBeVisible();
  }
  await signIn(admin, 'admin', { email: env.adminEmail }, env.adminPassword); await expectPortal(admin, 'admin');
  await btn(admin, 'Privacy').click();
  for (const name of [`QA Auth ${run}`, `QA Phone ${run}`]) {
    await inCard(admin, name, 'Process deletion');
    await confirmDialog(admin, 'Delete account', reason('test account clean-up'));
    await expect(admin.getByText(/Processed\./)).toBeVisible();
  }
});
