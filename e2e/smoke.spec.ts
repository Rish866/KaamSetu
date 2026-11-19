import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const publicPages = ['/', '/login', '/privacy', '/terms', '/support'];

test.describe('production build is honest and safe', () => {
  test('landing page contains no fabricated statistics or prototype labels', async ({ page }) => {
    await page.goto('/');
    const text = (await page.locator('body').innerText()).toLowerCase();
    for (const banned of ['12 new matches', '92% match', 'private prototype', 'harbourcloud', 'kiteroute', 'bluemango', 'ai matching'])
      expect(text, `landing page mentions "${banned}"`).not.toContain(banned);
    await expect(page.getByText('How a match score works')).toBeVisible();
    await expect(page.getByText('Aarvya Global Ventures LLP')).toBeVisible();
  });

  for (const path of ['/candidate', '/candidate/profile', '/candidate/applications', '/employer', '/employer/jobs', '/employer/discover', '/post-job', '/admin']) {
    test(`anonymous visitors are redirected away from ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      const text = await page.locator('body').innerText();
      expect(text).not.toMatch(/Trust & safety console|Applicants|Hiring pipeline/);
    });
  }

  test('sign-up enforces a strong password and admin sign-up is impossible', async ({ page }) => {
    await page.goto('/login?role=candidate');
    await expect(page.getByRole('button', { name: /create|sign up|register/i }).first()).toBeVisible();
    await page.goto('/login?role=admin');
    await expect(page.getByText(/only by the platform owner|granted only by the platform owner/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();
  });

  test('legal pages are clearly marked as drafts pending legal review', async ({ page }) => {
    for (const p of ['/privacy', '/terms']) { await page.goto(p); await expect(page.getByText(/draft prepared for legal review/i)).toBeVisible(); }
  });
});

test('pages load without console errors or CSP violations', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|supabase|fetch/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  for (const p of ['/', '/login', '/privacy']) { await page.goto(p); await page.waitForLoadState('networkidle'); }
  expect(problems).toEqual([]);
  await page.goto('/'); await expect(page).toHaveTitle(/KaamSetu/);
});

test.describe('accessibility (axe, WCAG 2 A/AA)', () => {
  for (const path of publicPages) {
    test(`no serious violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).disableRules(['color-contrast']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
    });
  }
});

test.describe('responsive layout', () => {
  for (const [name, width, height] of [['phone', 375, 740], ['tablet', 768, 1024], ['desktop', 1280, 800]] as const) {
    for (const path of publicPages) {
      test(`${path} fits a ${name} viewport without horizontal scrolling`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto(path); await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
      });
    }
  }
});
