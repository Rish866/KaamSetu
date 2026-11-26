// End-to-end demo walkthrough over the seeded demo story (scripts/demo/demo-story.mjs). Local stack only.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { btn, card, env, inCard, signIn } from '../live/helpers';

const pw = process.env.DEMO_PASSWORD ?? 'Demo-KaamSetu-2026';
const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.base);
test.skip(!local, 'The demo walkthrough runs only against a local site (LIVE_BASE_URL=http://localhost:...)');
test.describe.configure({ mode: 'serial' });
const dir = 'test-results/demo'; mkdirSync(dir, { recursive: true });
let n = 0;
const shot = async (p: Page, name: string) => { await p.waitForLoadState('networkidle'); await p.screenshot({ path: `${dir}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true }); };

test('candidate: verified job with commitment, zero-fee notice and the full hiring timeline', async ({ page }) => {
  await signIn(page, 'candidate', { email: 'demo-asha@example.com' }, pw);
  await expect(page).toHaveURL(/\/candidate/, { timeout: 30_000 });
  await shot(page, 'candidate-feed');
  await page.goto(`${env.base}/candidate/applications`);
  await expect(page.getByText(/Working at day 30|Still working at day 30|day 30/).first()).toBeVisible({ timeout: 20_000 });
  await shot(page, 'candidate-hired-timeline');
  await page.goto(`${env.base}/candidate/settings`);
  await expect(page.getByText('Who used your data')).toBeVisible({ timeout: 20_000 });
  await btn(page, /^Show full log/).click();
  await shot(page, 'candidate-access-log');
});

test('relocating candidate: found in discovery and invited', async ({ page }) => {
  await signIn(page, 'candidate', { email: 'demo-kabir@example.com' }, pw);
  await expect(page).toHaveURL(/\/candidate/, { timeout: 30_000 });
  await page.goto(`${env.base}/candidate/applications`);
  await expect(page.getByText('Employer invitations')).toBeVisible({ timeout: 20_000 });
  await shot(page, 'relocator-invitation');
  await inCard(page, 'Customer Success Executive', 'View job');
  await expect(page.getByText(/KaamSetu is free for candidates/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Verified by GSTIN')).toBeVisible();
  await expect(page.getByText('Replies within 3 days')).toBeVisible();
  await shot(page, 'job-detail-trust');
  await btn(page, 'Apply with my profile').click();
  await expect(page.getByText('Can you work alternate Saturdays?')).toBeVisible();
  await shot(page, 'apply-readiness-questions');
});

test('employer: applicants with answers, preferences and reasons; review commitment', async ({ page }) => {
  await signIn(page, 'employer', { email: 'demo-employer@example.com' }, pw);
  await expect(page).toHaveURL(/\/employer/, { timeout: 30_000 });
  await page.goto(`${env.base}/employer/jobs`);
  await inCard(page, 'Customer Success Executive', 'Applicants');
  await expect(page.getByText('Asha Patil')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Can you work alternate Saturdays?').first()).toBeVisible();
  await shot(page, 'employer-applicants');
  await page.goto(`${env.base}/employer/team`);
  await expect(page.getByText('Review commitment')).toBeVisible({ timeout: 20_000 });
  await shot(page, 'employer-review-commitment');
  await expect(card(page, 'Review commitment', '3 days')).toBeVisible();
});

test('admin: pilot funnel and hiring ledger', async ({ page }) => {
  await signIn(page, 'admin', { email: 'demo-admin@example.com' }, pw);
  await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
  await btn(page, 'Pilot funnel').click();
  await expect(page.getByText('Working at day 30')).toBeVisible({ timeout: 20_000 });
  await shot(page, 'admin-pilot-funnel');
  await btn(page, 'Hiring fees').click();
  await shot(page, 'admin-hiring-ledger');
});
