// Shared helpers for live specs (deployed site or a local Supabase stack). Never log passwords or tokens.
import { expect, type Page } from '@playwright/test';

export const env = {
  base: process.env.LIVE_BASE_URL ?? '',
  adminEmail: process.env.LIVE_ADMIN_EMAIL ?? '',
  adminPassword: process.env.LIVE_ADMIN_PASSWORD ?? '',
  supabaseUrl: process.env.LIVE_SUPABASE_URL ?? '',
  anonKey: process.env.LIVE_SUPABASE_ANON_KEY ?? '',
  mailpit: process.env.LIVE_MAILPIT_URL ?? '',            // local stack only
  dbUrl: process.env.LIVE_DB_URL ?? '',                   // local stack only, never production
  qaDomain: process.env.LIVE_QA_EMAIL_DOMAIN ?? 'getkaamsetu.in',
};
export const configured = Boolean(env.base && env.adminEmail && env.adminPassword);
export const run = Date.now().toString(36);
export const password = `Qa-${run}-Strong9`;
export const qaEmail = (tag: string) => `qa+${run}-${tag}@${env.qaDomain}`;
export const reason = (s: string) => `Automated QA run ${run}: ${s}`;

/** Exact-name button, last in DOM order (dialogs render after the page). */
export const btn = (p: Page, name: string | RegExp) => p.getByRole('button', typeof name === 'string' ? { name, exact: true } : { name }).last();

/** The innermost element that contains `text` and a button named `button`, i.e. the card for that item. */
export function card(p: Page, text: string, button: string | RegExp) {
  const b = p.getByRole('button', typeof button === 'string' ? { name: button, exact: true } : { name: button });
  return p.locator('div').filter({ has: p.getByText(text, { exact: false }) }).filter({ has: b }).last();
}
export async function inCard(p: Page, text: string, button: string | RegExp) {
  const c = card(p, text, button);
  await c.getByRole('button', typeof button === 'string' ? { name: button, exact: true } : { name: button }).last().click();
}
export async function confirmDialog(p: Page, label: string, why?: string) {
  if (why) await p.getByRole('textbox', { name: /Reason/ }).last().fill(why);
  await btn(p, label).click();
}

export async function signUp(p: Page, role: 'candidate' | 'employer', who: { name: string; email?: string; phone?: string }, pw = password) {
  await p.goto(`${env.base}/login?role=${role}`);
  await btn(p, 'Create account').click();
  await p.getByRole('textbox', { name: 'Full name' }).fill(who.name);
  if (who.phone) { await btn(p, 'Mobile number').click(); await p.getByRole('textbox', { name: 'Indian mobile number' }).fill(who.phone); }
  else await p.getByRole('textbox', { name: 'Email address' }).fill(who.email!);
  await p.getByRole('textbox', { name: 'Password', exact: true }).fill(pw);
  await p.getByRole('textbox', { name: 'Confirm password' }).fill(pw);
  await p.getByRole('checkbox').click();
  await btn(p, 'Create my account').click();
}
export async function signIn(p: Page, role: 'candidate' | 'employer' | 'admin', id: { email?: string; phone?: string }, pw = password) {
  await p.goto(`${env.base}/login?role=${role}`);
  if (id.phone) { await btn(p, 'Mobile number').click(); await p.getByRole('textbox', { name: 'Indian mobile number' }).fill(id.phone); }
  else await p.getByRole('textbox', { name: 'Email address' }).fill(id.email!);
  await p.getByRole('textbox', { name: 'Password', exact: true }).fill(pw);
  await btn(p, 'Sign in securely').click();
}
export async function expectPortal(p: Page, role: 'candidate' | 'employer' | 'admin') {
  await expect(p).toHaveURL(new RegExp(`/${role}(/|$|\\?)`), { timeout: 30_000 });
}

/** Reads the supabase-js session from localStorage (to call the API as that user from the test runner). */
export async function sessionOf(p: Page): Promise<{ access_token: string; refresh_token: string; user: { id: string } }> {
  return p.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (/^sb-.*-auth-token$/.test(k)) return JSON.parse(localStorage.getItem(k)!);
    }
    throw new Error('no session');
  });
}

export function minimalPdf(text: string) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${44 + text.length} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
export async function uploadResume(p: Page, text = 'QA resume CRM Customer support') {
  await p.goto(`${env.base}/candidate/profile`);
  const chooser = p.waitForEvent('filechooser');
  await btn(p, /^(Upload resume|Replace resume)$/).click();
  await (await chooser).setFiles({ name: 'qa-resume.pdf', mimeType: 'application/pdf', buffer: minimalPdf(text) });
  await expect(p.getByText(/Resume uploaded|Quarantined|Security check: passed/).first()).toBeVisible({ timeout: 30_000 });
}
