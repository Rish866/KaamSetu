import { expect, test } from '@playwright/test';

// Deploy-first release: the v1.4.0 website goes live before the database migration. While the database is still on
// v1.3.0 (schema_version() does not exist, PostgREST answers PGRST202) or on an older v1.4 schema, everything that needs
// the new database must show the maintenance screen, and the public pages must keep working.
const missingFunction = { status: 404, json: { code: 'PGRST202', details: null, hint: null, message: 'Could not find the function public.schema_version without parameters in the schema cache' } };
const gated = ['/login', '/login?role=employer', '/reset-password', '/candidate', '/candidate/profile', '/employer', '/post-job', '/admin'];
const open = ['/', '/privacy', '/terms', '/support'];

for (const [label, reply] of [['v1.3.0 database (function missing)', missingFunction], ['older v1.4 schema', { json: '202611200005' }]] as const) {
  test.describe(`with a ${label}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.route('**/rest/v1/rpc/schema_version', (route) => route.fulfill(reply));
    });

    for (const path of gated) {
      test(`${path} shows the maintenance screen`, async ({ page }) => {
        await page.goto(path);
        await expect(page).toHaveURL(/\/maintenance$/);
        await expect(page.getByRole('heading', { name: 'KaamSetu is being updated' })).toBeVisible();
      });
    }

    test('public pages stay available', async ({ page }) => {
      for (const path of open) {
        await page.goto(path);
        await page.waitForTimeout(1500);
        await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/$' : path}`));
        await expect(page.getByText('KaamSetu is being updated')).toHaveCount(0);
      }
    });
  });
}

test('with the required schema, sign-in is reachable and the maintenance page is not forced', async ({ page }) => {
  await page.route('**/rest/v1/rpc/schema_version', (route) => route.fulfill({ json: '202611270004' }));
  await page.goto('/login?role=candidate');
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: 'Sign in securely' })).toBeVisible();
});

test('a network failure on the version check does not lock users out', async ({ page }) => {
  await page.route('**/rest/v1/rpc/schema_version', (route) => route.abort('connectionfailed'));
  await page.goto('/login?role=candidate');
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/login/);
});
